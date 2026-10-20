import { Schema, model } from "mongoose";
export const supportCategories = ["Payment issue", "Missing credits", "AI generation issue", "Account issue", "YouTube connection problem", "Video rendering issue", "Technical bug", "General inquiry"] as const;
const schema = new Schema({
  channel:{type:String,enum:['ticket','chat'],default:'ticket'},supportStage:{type:String,enum:['bot','waiting_agent','agent'],default:'agent'},botLeaseUntil:Date,
  userId: { type: Schema.Types.ObjectId, required: true, index: true }, requestId: { type: String, required: true },
  category: { type: String, enum: supportCategories, required: true }, subject: { type: String, required: true },
  status: { type: String, enum: ["open", "waiting", "resolved", "closed"], default: "open" },
  priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" }, assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  resolvedAt: Date, lastMessageAt: { type: Date, default: Date.now }, revision: { type: Number, default: 0 },
  history: [{ actorId: Schema.Types.ObjectId, action: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });
schema.index({ userId: 1, requestId: 1 }, { unique: true }); schema.index({ status: 1, lastMessageAt: -1 });
export const SupportTicket = model("SupportTicket", schema);
