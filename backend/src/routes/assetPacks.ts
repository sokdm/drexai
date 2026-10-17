import { Router, raw } from "express";
import mongoose, { Schema, model } from "mongoose";
import { z } from "zod";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { captionStyleSchema, timelineSchema, timelineDuration } from "@drex/shared";
import { MediaAsset } from "../models/MediaAsset.js";
import { VideoEdit } from "../models/VideoEdit.js";
import { AdminAudit } from "../models/Admin.js";
import { StudioEvent } from "../models/StudioProduction.js";
import { readMediaObject, uploadImage } from "../services/mediaStorage.js";
import { uploadEditorAudio, validateTimelineAssets } from "../services/videoEditing.js";

export const AssetPack = model("AssetPack", new Schema({ name: String, kind: String, license: String, active: Boolean, assetId: Schema.Types.ObjectId, preset: Schema.Types.Mixed, createdBy: Schema.Types.ObjectId }, { timestamps: true }));
export const assetPackRouter = Router();
const wrap = (f: any) => (req: any,res: any,next: any) => Promise.resolve(f(req,res)).catch(next);
const id = z.string().regex(/^[a-f0-9]{24}$/i), reason = z.string().trim().min(10).max(1000);
export const packSchema = z.object({ name: z.string().trim().min(2).max(100), kind: z.enum(["music", "brand", "template", "effect", "caption", "transition"]), license: z.string().trim().min(10).max(2000), active: z.boolean(), assetId: id.optional(), preset: z.object({ motion: z.enum(["gentle-push", "title-reveal"]).optional(), title: z.string().trim().min(1).max(150).optional(), look: z.enum(["original","cinematic","vivid","monochrome","warm","cool"]).optional(), transition: z.enum(["cut","fade"]).optional(), captionStyle: captionStyleSchema.optional() }).default({}) });
function actor(req: any) { return req.adminUser?._id || req.user._id; }
function admin(req: any) { if (!req.adminUser) throw Object.assign(new Error("Administrator access required"), { statusCode: 403 }); }
export function applyPackPreset(timeline: any, preset: any) {
 const motionCaptions = preset.motion === "title-reveal" && timelineDuration(timeline) >= .1 ? [{ id:randomUUID(),text:preset.title || timeline.clips[0]?.label || "",start:0,end:Math.min(3,timelineDuration(timeline)),verification:"manual",style:{font:"Arial",size:48,position:"center",preset:"bold",animation:"pop"} }] : [];
 const next = timelineSchema.parse({ ...timeline, clips: timeline.clips.map((c: any) => ({ ...c, ...(preset.motion === "gentle-push" ? {keyframes:[{time:0,zoom:1,x:.5,y:.5},{time:c.duration,zoom:1.12,x:.5,y:.5}]} : {}), ...(preset.look ? { look: preset.look } : {}), ...(preset.transition ? { transition: preset.transition } : {}) })), captions: [...timeline.captions.map((c: any) => ({ ...c, ...(preset.captionStyle ? { style: preset.captionStyle } : {}) })),...motionCaptions] });
 if (JSON.stringify(next) === JSON.stringify(timelineSchema.parse(timeline))) throw new Error("This preset would not change the timeline. Add applicable clips or captions first.");
 return next;
}
assetPackRouter.get("/asset-packs", wrap(async (req: any,res: any) => {
 res.json({ packs: await AssetPack.find(req.adminUser ? {} : { active: true }).sort({ updatedAt: -1 }).limit(200), assets: await MediaAsset.find({ userId: actor(req), provider: "upload", deletedAt: null }).select("type metadata durationSeconds").sort({ createdAt: -1 }).limit(200) });
}));
assetPackRouter.post("/asset-library/upload", raw({ type: ["image/png","image/jpeg","image/webp","audio/*"], limit: "100mb" }), wrap(async (req: any,res: any) => {
 const category = z.enum(["music","logo","product","overlay","brand"]).parse(req.query.category);
 if (req.headers["x-license-confirmed"] !== "true") throw new Error("Confirm ownership or permission before uploading this asset");
 if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error("Upload a supported image or audio file");
 const name = String(req.headers["x-file-name"] || "Uploaded asset").slice(0,150);
 let asset: any;
 if (category === "music") asset = await uploadEditorAudio(String(actor(req)), undefined as any, req.body, name, String(req.headers["content-type"]), "music", true);
 else {
  if (req.body.length > 15 * 1024 * 1024) throw new Error("Images must be 15MB or smaller");
  const bytes = await sharp(req.body, { limitInputPixels: 16000000 }).rotate().png().toBuffer(), info = await sharp(bytes).metadata();
  const stored = await uploadImage(bytes, `${actor(req)}/library/${randomUUID()}.png`);
  asset = await MediaAsset.create({ userId: actor(req), provider: "upload", type: "image", ...stored, width: info.width, height: info.height, contentType: "image/png", sizeBytes: bytes.length, metadata: { name, category, licenseConfirmed: true } });
 }
 res.status(201).json({ asset });
}));
async function validatePack(req: any, input: any) {
 if (["music","brand"].includes(input.kind)) {
  if (!input.assetId || !await MediaAsset.exists({ _id: input.assetId, userId: actor(req), deletedAt: null, type: input.kind === "music" ? "audio" : "image" })) throw new Error("Choose an available asset you own");
 } else if (!Object.keys(input.preset).length) throw new Error("Select at least one supported preset setting");
}
assetPackRouter.post("/asset-packs", wrap(async (req: any,res: any) => {
 admin(req); const input = packSchema.parse(req.body), why = reason.parse(req.body.reason); await validatePack(req,input);
 let pack: any; const session = await mongoose.startSession();
 try { await session.withTransaction(async () => { [pack] = await AssetPack.create([{ ...input, createdBy: actor(req) }], { session }); await AdminAudit.create([{ actorId: actor(req), action: "asset-pack-create", target: String(pack._id), reason: why, after: input }], { session }); }); } finally { await session.endSession(); }
 res.status(201).json({ pack });
}));
assetPackRouter.put("/asset-packs/:id", wrap(async (req: any,res: any) => {
 admin(req); const input = packSchema.parse(req.body), why = reason.parse(req.body.reason); await validatePack(req,input);
 let pack: any; const session = await mongoose.startSession();
 try { await session.withTransaction(async () => { const before = await AssetPack.findById(id.parse(req.params.id)).session(session); if (!before) throw new Error("Pack not found"); pack = await AssetPack.findByIdAndUpdate(before._id,input,{ new: true,session }); await AdminAudit.create([{ actorId: actor(req), action: "asset-pack-update", target: String(before._id), reason: why, before: before.toObject(), after: input }],{session}); }); } finally { await session.endSession(); }
 res.json({ pack });
}));
assetPackRouter.post("/asset-packs/:id/import", wrap(async (req: any,res: any) => {
 const pack = await AssetPack.findOne({ _id: id.parse(req.params.id), active: true }); if (!pack?.assetId) throw new Error("This pack does not contain media");
 const source = await MediaAsset.findOne({ _id: pack.assetId, userId: pack.createdBy, deletedAt: null }); if (!source) throw new Error("Pack media is unavailable");
 const bytes = source.url?.startsWith("data:") ? Buffer.from(source.url.split(",")[1],"base64") : (await readMediaObject(source.key))?.buffer; if (!bytes) throw new Error("Pack file is unavailable");
 const stored = await uploadImage(bytes, `${actor(req)}/library/${randomUUID()}`, source.contentType);
 const asset = await MediaAsset.create({ userId: actor(req), provider: "upload", type: source.type, ...stored, contentType: source.contentType, sizeBytes: bytes.length, width: source.width, height: source.height, durationSeconds: source.durationSeconds, metadata: { ...source.metadata, name: pack.name, packId: String(pack._id), licenseUrl: pack.license, licenseConfirmed: true } });
 res.status(201).json({ asset });
}));
assetPackRouter.post("/asset-packs/:id/apply", wrap(async (req: any,res: any) => {
 const input = z.object({ editId: id, revision: z.number().int().nonnegative() }).parse(req.body);
 const pack = await AssetPack.findOne({ _id: id.parse(req.params.id), active: true }); if (!pack || ["music","brand"].includes(pack.kind!)) throw new Error("Choose an available editing preset");
 const edit = await VideoEdit.findOne({ _id: input.editId,userId: actor(req),revision: input.revision }); if (!edit) throw Object.assign(new Error("Timeline changed. Save and refresh before applying this preset"),{statusCode:409});
 const timeline = applyPackPreset(edit.timeline,pack.preset); await validateTimelineAssets(timeline,String(actor(req)));
 const saved = await VideoEdit.findOneAndUpdate({ _id: edit._id,userId: actor(req),revision: input.revision },{ $set:{timeline},$inc:{revision:1} },{new:true}); if (!saved) throw Object.assign(new Error("Timeline changed. Refresh and retry"),{statusCode:409});
 if (edit.productionId) await StudioEvent.create({ productionId: edit.productionId,userId: actor(req),level:"success",message:`Free editing preset applied: ${pack.name}, revision ${saved.revision}` });
 res.json({ edit:saved, creditsCharged:0 });
}));
