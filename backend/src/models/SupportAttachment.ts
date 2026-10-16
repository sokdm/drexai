import { Schema, model } from "mongoose";
const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true }, ticketId: { type: Schema.Types.ObjectId, index: true },
  messageId: Schema.Types.ObjectId, name: String, contentType: String, size: Number, data: { type: Buffer, required: true, select: false },
  expiresAt: { type: Date, index: { expires: 0 } },
}, { timestamps: true });
export const SupportAttachment = model("SupportAttachment", schema);
