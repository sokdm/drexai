import { test } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { env } from "../dist/config/env.js";
import { sendTransactionalEmail } from "../dist/services/email.js";
test("SMTP handles transactional email ahead of optional Resend and checks recipient acceptance", async () => {
  const previous = { host: env.SMTP_HOST, user: env.SMTP_USER, pass: env.SMTP_PASS }, original = nodemailer.createTransport;
  let mail, accepted = true;
  try {
    env.SMTP_HOST = "smtp.example.test"; env.SMTP_USER = "sender"; env.SMTP_PASS = "test-only";
    nodemailer.createTransport = () => ({ sendMail: async input => { mail = input; return { messageId: "mock-smtp-id", accepted: accepted ? [input.to] : [], rejected: accepted ? [] : [input.to] }; } });
    const result = await sendTransactionalEmail("admin@example.test", "Sign-in code", "Your code is 123456", "admin-login-test");
    assert.equal(result.provider, "smtp"); assert.equal(result.messageId, "mock-smtp-id"); assert.equal(mail.text, "Your code is 123456"); assert.equal(mail.messageId, "<admin-login-test@drex.mail>");
    accepted = false; await assert.rejects(() => sendTransactionalEmail("admin@example.test", "Code", "test", "event"), /did not accept/);
  } finally { nodemailer.createTransport = original; env.SMTP_HOST = previous.host; env.SMTP_USER = previous.user; env.SMTP_PASS = previous.pass; }
});
