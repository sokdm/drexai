import { Schema, model } from "mongoose";

const messageSchema = new Schema({
  role: { type: String, enum: ["user", "assistant", "system"], required: true },
  content: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const aiConversationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, default: "AI Research Chat" },
  projectId: { type: Schema.Types.ObjectId, ref: "AIProject" },
  nicheId: { type: Schema.Types.ObjectId, ref: "Niche" },
  savedResearchIds: [String],
  messages: [messageSchema]
}, { timestamps: true });

export const AIConversation = model("AIConversation", aiConversationSchema);
