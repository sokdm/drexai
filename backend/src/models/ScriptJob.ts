import { Schema, model } from "mongoose";
const schema = new Schema({ userId: { type: Schema.Types.ObjectId, required: true }, requestId: { type: String, required: true }, status: { type: String, default: "processing" }, projectId: Schema.Types.ObjectId, error: String, outputFailure: Schema.Types.Mixed, input: Schema.Types.Mixed, quote: Schema.Types.Mixed, plan: Schema.Types.Mixed, logs: { type: [Schema.Types.Mixed], default: [] }, cursor: { type: Number, default: 0 }, leaseUntil: Date, inFlight: Boolean, resultProjectId: Schema.Types.ObjectId, baseUpdatedAt: Date, reservationId: Schema.Types.ObjectId }, { timestamps: true });
schema.add({ pendingBatch: Schema.Types.Mixed });
schema.index({ userId: 1, requestId: 1 }, { unique: true });
export const ScriptJob = model("ScriptJob", schema);
