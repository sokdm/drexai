import { Schema, model } from "mongoose";

const sessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  csrfTokenHash: { type: String, required: true },
  userAgent: String,
  ip: String,
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: Date
}, { timestamps: true });

export const Session = model("Session", sessionSchema);
