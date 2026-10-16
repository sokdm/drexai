import { Schema, model } from "mongoose";

const emailVerificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  resendAvailableAt: { type: Date, required: true },
  consumedAt: Date
}, { timestamps: true });

export const EmailVerification = model("EmailVerification", emailVerificationSchema);
