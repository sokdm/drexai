import { Schema, model } from "mongoose";
const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true }, channelId: { type: String, required: true },
  fileName: String, fileSize: { type: Number, required: true }, contentType: String, title: String, description: String,
  privacy: { type: String, enum: ["private", "unlisted", "public"], default: "private" },
  madeForKids: Boolean, syntheticMedia: Boolean, tags: [String], publishAt: Date, channelTitle: String,
  projectId: Schema.Types.ObjectId, exportId: Schema.Types.ObjectId, draftId: Schema.Types.ObjectId, confirmedAt: { type: Date, default: Date.now },
  uploadUrlEncrypted: { type: String, required: function(this: any) { return this.status !== "failed"; } }, uploadedBytes: { type: Number, default: 0 },
  status: { type: String, enum: ["uploading", "completed", "expired", "failed"], default: "uploading", index: true },
  videoId: String, videoUrl: String, error: String, completedAt: Date,
  leaseToken: String, leaseUntil: Date,
}, { timestamps: true });
export const YouTubeUpload = model("YouTubeUpload", schema);
