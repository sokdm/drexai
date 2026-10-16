import { Schema, model } from "mongoose";
const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true }, requestId: { type: String, required: true },
  type: { type: String, enum: ["bug", "feature", "general", "experience"], required: true },
  subject: String, content: String, rating: { type: Number, min: 1, max: 5 },
  category: { type: String, default: "Uncategorized" }, status: { type: String, enum: ["new", "reviewed", "planned", "closed"], default: "new" }, adminNote: String,
}, { timestamps: true });
schema.index({ userId: 1, requestId: 1 }, { unique: true });
export const Feedback = model("Feedback", schema);
