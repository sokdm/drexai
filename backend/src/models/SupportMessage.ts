import { Schema, model } from "mongoose";
const schema = new Schema({
  ticketId: { type: Schema.Types.ObjectId, required: true, index: true }, senderId: { type: Schema.Types.ObjectId, required: true },
  senderName: String, senderRole: { type: String, enum: ["user", "admin", "support"], required: true },
  content: { type: String, required: true }, attachments: [{ type: Schema.Types.ObjectId, ref: "SupportAttachment" }],
  requestId: { type: String, required: true }, readByUserAt: Date, readBySupportAt: Date,
}, { timestamps: true });
schema.index({ ticketId: 1, senderId: 1, requestId: 1 }, { unique: true }); schema.index({ ticketId: 1, _id: -1 });
export const SupportMessage = model("SupportMessage", schema);
