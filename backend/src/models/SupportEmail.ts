import { Schema, model } from "mongoose";
const schema = new Schema({
  eventKey: { type: String, required: true, unique: true }, userId: { type: Schema.Types.ObjectId, required: true },
  ticketId: Schema.Types.ObjectId, subject: String, text: String,
  status: { type: String, enum: ["pending", "sending", "sent", "skipped", "failed"], default: "pending", index: true },
  attempts: { type: Number, default: 0 }, nextAttemptAt: { type: Date, default: Date.now }, leaseUntil: Date,
  firstAttemptAt: Date, sentAt: Date, providerId: String, error: String,
}, { timestamps: true });
export const SupportEmail = model("SupportEmail", schema);
