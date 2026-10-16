import { Schema, model } from "mongoose";
const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  projectId: Schema.Types.ObjectId, exportId: Schema.Types.ObjectId,
  brief: String, name: { type: String, required: true }, platform: { type: String, default: "youtube" },
  metadata: { type: Schema.Types.Mixed, default: {} }, revision: { type: Number, default: 0 },
  thumbnailJobId: Schema.Types.ObjectId,
}, { timestamps: true });
export const PublishingDraft = model("PublishingDraft", schema);
