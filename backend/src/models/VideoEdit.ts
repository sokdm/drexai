import { Schema, model } from "mongoose";

const editSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true }, projectId: { type: Schema.Types.ObjectId, required: true, index: true },
  assistantMessages:{type:[String],default:[]},
  productionId: { type: Schema.Types.ObjectId, required: true }, title: { type: String, required: true },
  timeline: { type: Schema.Types.Mixed, required: true, set: (value: any) => value == null ? value : JSON.parse(JSON.stringify(value)) }, revision: { type: Number, default: 0 },
}, { timestamps: true });
editSchema.index({ userId: 1, productionId: 1 }, { unique: true });
export const VideoEdit = model("VideoEdit", editSchema);

const exportSchema = new Schema({
  purpose:{type:String,enum:["export","preview"],default:"export"},sourceAssetId:Schema.Types.ObjectId,
  userId: { type: Schema.Types.ObjectId, required: true, index: true }, editId: { type: Schema.Types.ObjectId, required: true, index: true }, projectId: { type: Schema.Types.ObjectId, required: true },
  revision: { type: Number, required: true }, timeline: { type: Schema.Types.Mixed, required: true }, settings: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ["queued", "rendering", "uploading", "completed", "failed"], default: "queued", index: true }, progress: { type: Number, default: 0 }, phase:String,
  reservationId: Schema.Types.ObjectId,
  productionId: Schema.Types.ObjectId, budgetCredits:Number,
  leaseToken: String, leaseUntil: Date, attempts: { type: Number, default: 0 }, error: String,
  key: String, bucket: String, duration: Number, width: Number, height: Number, sizeBytes: Number,
  completedAt: Date, savedToProjectAt: Date,
}, { timestamps: true });
exportSchema.index({productionId:1,revision:1},{unique:true,partialFilterExpression:{productionId:{$type:"objectId"}}});
exportSchema.index({userId:1,sourceAssetId:1,purpose:1},{unique:true,partialFilterExpression:{purpose:"preview"}});
export const VideoExport = model("VideoExport", exportSchema);

const workerSchema = new Schema({ _id: String, expiresAt: Date, capabilities: Schema.Types.Mixed }, { timestamps: true });
export const RenderWorker = model("RenderWorker", workerSchema);
