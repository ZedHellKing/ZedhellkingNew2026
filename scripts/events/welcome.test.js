"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const axios = require("axios");
const canvas = require("canvas");

const backgroundPath = path.join(__dirname, "assets", "zed-welcome-background.jpeg");
const backgroundLoads = [];
const drawnText = [];
const blockedRequests = [];

const originalLoadImage = canvas.loadImage;
const originalFillText = canvas.CanvasRenderingContext2D.prototype.fillText;
const originalHttpAdapter = axios.defaults.adapter;

canvas.loadImage = async (source, ...args) => {
  if (typeof source === "string") backgroundLoads.push(source);
  return originalLoadImage(source, ...args);
};
canvas.CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
  drawnText.push(String(text));
  return originalFillText.call(this, text, ...args);
};

axios.defaults.adapter = async config => {
  blockedRequests.push(config.url);
  throw new Error("HTTP is disabled in the welcome-card test");
};

global.utils = {
  drive: { getFile() { throw new Error("No saved attachment is expected"); } },
  getPrefix: () => "/"
};
global.GoatBot = { config: { nickNameBot: null } };

const welcome = require("./welcome");

test("creates and sends the Zed welcome PNG without profile photos or Facebook login", async () => {
  const sentMessages = [];
  const requestedUsers = [];
  let attachmentPath;

  try {
    await welcome.onStart({
      threadsData: {
        get: async threadID => {
          assert.equal(threadID, "fake-thread");
          return {
            threadName: "Sample Group",
            settings: { sendWelcomeMessage: true },
            data: {}
          };
        }
      },
      message: { send: form => sentMessages.push(form) },
      event: {
        logMessageType: "log:subscribe",
        logMessageData: {
          addedParticipants: [{ userFbId: "fake-member", fullName: "New Member" }]
        },
        participantIDs: ["fake-inviter", "fake-member"],
        author: "fake-inviter",
        threadID: "fake-thread"
      },
      api: {
        getCurrentUserID: () => "fake-bot",
        getUserInfo: async userIDs => {
          requestedUsers.push(...userIDs);
          return {};
        },
        getThreadInfo: async () => ({})
      },
      usersData: { getName: async () => "Group Inviter" },
      getLang: key => welcome.langs.en[key]
    });

    assert.equal(sentMessages.length, 1, "the welcome message should be sent");
    const [form] = sentMessages;
    assert.ok(form.body.includes("New Member"), "the member's name should be included in the message");
    assert.deepEqual(form.mentions, [{ tag: "New Member", id: "fake-member" }]);
    assert.ok(form.attachment, "the generated card should be attached without profile photos");

    attachmentPath = form.attachment.path;
    const chunks = [];
    for await (const chunk of form.attachment) chunks.push(chunk);
    const png = Buffer.concat(chunks);

    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "attachment should be a PNG");
    assert.equal(png.readUInt32BE(16), 1200, "PNG width should be 1200 pixels");
    assert.equal(png.readUInt32BE(20), 630, "PNG height should be 630 pixels");
    assert.deepEqual(backgroundLoads, [backgroundPath], "the local Zed background should be loaded");
    assert.ok(drawnText.includes("Welcome to Zed's Realm"), "the card title should name Zed");
    assert.ok(drawnText.includes("By ZedHellking"), "the card signature should name Zed");
    assert.deepEqual(requestedUsers.sort(), ["fake-inviter", "fake-member"]);
    assert.equal(blockedRequests.length, 2, "profile lookups should be blocked instead of reaching Facebook");
  } finally {
    if (attachmentPath) fs.rmSync(attachmentPath, { force: true });
    canvas.loadImage = originalLoadImage;
    canvas.CanvasRenderingContext2D.prototype.fillText = originalFillText;
    axios.defaults.adapter = originalHttpAdapter;
  }
});
