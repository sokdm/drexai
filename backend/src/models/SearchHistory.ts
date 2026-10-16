import { Schema, model } from "mongoose";

const searchHistorySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  kind: { type: String, enum: ["video", "channel", "popular"], required: true },
  query: { type: Schema.Types.Mixed, required: true },
  resultCount: { type: Number, default: 0 }
}, { timestamps: true });

export const SearchHistory = model("SearchHistory", searchHistorySchema);
