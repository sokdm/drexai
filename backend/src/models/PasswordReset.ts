import { Schema, model } from "mongoose";

const passwordResetSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  consumedAt: Date
}, { timestamps: true });

export const PasswordReset = model("PasswordReset", passwordResetSchema);
