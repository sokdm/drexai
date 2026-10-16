import { Schema, model } from "mongoose";

const youtubeConnectionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  googleSub: String,
  channelId: String,
  channelTitle: String,
  channelThumbnail: String,
  scopes: [String],
  accessTokenEncrypted: { type: String, required: true },
  refreshTokenEncrypted: String,
  expiresAt: Date,
  disconnectedAt: Date
}, { timestamps: true });

export const YouTubeConnection = model("YouTubeConnection", youtubeConnectionSchema);
