import { Schema, model } from "mongoose";

const productionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, required: true, index: true },
  sourceProductionId: String,
  title: String,
  attempts: { type: Number, default: 0 },
  status: { type: String, enum: ["draft", "queued", "running", "paused", "failed", "needs_review", "cancelled", "completed"], default: "draft", index: true },
  control: { type: String, enum: ["run", "pause", "cancel"], default: "pause" },
  snapshot: { type: Schema.Types.Mixed, required: true },
  settings: { type: Schema.Types.Mixed, required: true },
  steps: { type: [Schema.Types.Mixed], default: [] },
  estimate: { type: Schema.Types.Mixed, required: true },
  timeline: { type: [Schema.Types.Mixed], default: [] },
  expiresAt: Date,
  approvedAt: Date,
  maxCredits: { type: Number, default: 0 },
  reservationId: { type: Schema.Types.ObjectId },
  leaseToken: String,
  leaseUntil: Date,
  queueRevision: { type: Number, default: 0 },
  error: String,
  completedAt: Date
}, { timestamps: true });

export const StudioProduction = model("StudioProduction", productionSchema);

const eventSchema = new Schema({
  productionId: { type: Schema.Types.ObjectId, required: true, index: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  level: { type: String, enum: ["waiting", "processing", "success", "failure", "cancelled"], required: true },
  message: { type: String, required: true },
  stepKey: String
}, { timestamps: true });
export const StudioEvent = model("StudioEvent", eventSchema);
