import { Schema, model } from "mongoose";
const schema = new Schema({ userId: { type: Schema.Types.ObjectId, required: true }, requestId: { type: String, required: true }, status: { type: String, default: "processing" }, projectId: Schema.Types.ObjectId, error: String, reservationId: Schema.Types.ObjectId }, { timestamps: true });
schema.index({ userId: 1, requestId: 1 }, { unique: true });
export const ScriptJob = model("ScriptJob", schema);
