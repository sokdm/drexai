import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
if (!process.stdin.isTTY) throw new Error("Run this command in your own interactive terminal. Passwords are read without echo.");
async function password(prompt) {
  process.stdout.write(prompt); readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => { let value = ""; const onKey = (text, key) => { if (key?.ctrl && key.name === "c") { cleanup(); reject(new Error("Cancelled")); } else if (key?.name === "return") { cleanup(); process.stdout.write("\n"); resolve(value); } else if (key?.name === "backspace") value = value.slice(0, -1); else if (text && !key?.ctrl) value += text; }; const cleanup = () => { process.stdin.off("keypress", onKey); process.stdin.setRawMode(false); process.stdin.pause(); }; process.stdin.on("keypress", onKey); });
}
const first = await password("Administrator password (hidden): "), confirm = await password("Confirm password (hidden): ");
if (first !== confirm || first.length < 14) throw new Error("Use matching passwords of at least 14 characters.");
const hash = await argon2.hash(first, { type: argon2.argon2id });
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const bits = [...randomBytes(20)].map(b => b.toString(2).padStart(8, "0")).join(""); const secret = bits.match(/.{5}/g).map(b => alphabet[parseInt(b, 2)]).join("");
console.log("Store these only in your private Render environment settings:");
console.log(`ADMIN_BOOTSTRAP_PASSWORD_HASH=${hash}`);
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log("Add the TOTP secret to your authenticator as a SHA1, 6-digit, 30-second account. Store recovery access securely. Never commit this output.");
