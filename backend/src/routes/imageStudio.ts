import { Router, raw } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { ImageStudio } from "../models/ImageStudio.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { CharacterProfile } from "../models/CharacterProfile.js";
import { AIProject } from "../models/AIProject.js";
import { readMediaObject, uploadImage } from "../services/mediaStorage.js";
import { verifiedRouterModel } from "../services/openrouter.js";
export const imageStudioRouter = Router();
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
const id = z.string().regex(/^[a-f0-9]{24}$/i);
imageStudioRouter.use("/studio", rateLimit({ windowMs: 60000, limit: 40 }));
imageStudioRouter.get("/studio/state", wrap(async (req: any, res: any) => res.json({ state: (await ImageStudio.findOne({ userId: req.user._id }))?.state || {}, projects: await AIProject.find({ userId: req.user._id }).select("title").sort({ updatedAt: -1 }).limit(100) })));
imageStudioRouter.put("/studio/state", wrap(async (req: any, res: any) => {
 const state = z.object({ tool: z.string().max(30), prompt: z.string().max(4000), model: z.string().max(150), stylePreset: z.string().max(80), aspectRatio: z.string().max(10), resolution: z.string().max(10), numberOfImages: z.number().int().min(1).max(10), projectId: id.optional(), sceneId: id.optional(), selectedId: z.string().max(24), past: z.array(id).max(100).default([]), future: z.array(id).max(100).default([]), sourceAssetIds: z.array(id).max(4), characterReferenceIds: z.array(id).max(4) }).parse(req.body);
 await ImageStudio.updateOne({ userId: req.user._id }, { state }, { upsert: true }); res.json({ ok: true });
}));
imageStudioRouter.get("/studio/capabilities", wrap(async (req: any, res: any) => {
 const model = z.string().max(150).parse(req.query.model);
 if (!model.startsWith("openrouter/")) return res.json({ references: !model.includes("lite"), backgroundRemoval: false, quality: false });
 const record: any = await verifiedRouterModel(model, "image");
 const params = record.supported_parameters || record.capabilities || {};
 res.json({ references: Boolean(params.input_references), backgroundRemoval: Boolean(params.input_references && params.background?.values?.includes("transparent")), quality: false, parameters: params });
}));
imageStudioRouter.post("/studio/characters", wrap(async (req: any, res: any) => {
 const input = z.object({ name: z.string().trim().min(1).max(100), appearance: z.string().max(2000), assetId: id, projectId: id.optional() }).parse(req.body);
 const asset = await MediaAsset.findOne({ _id: input.assetId, userId: req.user._id, type: "image", deletedAt: null });
 if (!asset) return res.status(404).json({ error: "Image not found" });
 if (input.projectId && !await AIProject.exists({ _id: input.projectId, userId: req.user._id })) return res.status(404).json({ error: "Project not found" });
 res.status(201).json({ character: await CharacterProfile.create({ userId: req.user._id, name: input.name, appearance: input.appearance, referenceAssetId: asset._id, projectId: input.projectId }) });
}));
async function store(req: any, buffer: Buffer, metadata: any, projectId?: any) {
 const key = `${req.user._id}/images/manual-${randomUUID()}.png`, stored = await uploadImage(buffer, key, "image/png"), info = await sharp(buffer).metadata();
 return MediaAsset.create({ userId: req.user._id, projectId, provider: "upload", model: "manual-edit", key: stored.key, bucket: stored.bucket, url: stored.url, type: "image", contentType: "image/png", sizeBytes: buffer.length, width: info.width, height: info.height, metadata });
}
imageStudioRouter.post("/studio/upload", raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "15mb" }), wrap(async (req: any, res: any) => {
 if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Upload a PNG, JPEG or WebP image" });
 const buffer = await sharp(req.body, { limitInputPixels: 40000000 }).rotate().png().toBuffer();
 res.status(201).json({ asset: await store(req, buffer, { name: "Uploaded image", tool: "upload" }) });
}));
imageStudioRouter.post("/studio/assets/:id/transform", wrap(async (req: any, res: any) => {
 const input = z.object({ rotate: z.enum(["0", "90", "180", "270"]).default("0"), flip: z.boolean().default(false), width: z.number().int().min(64).max(4096).optional(), height: z.number().int().min(64).max(4096).optional(), crop: z.object({ left: z.number().int().nonnegative(), top: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).optional() }).parse(req.body);
 const asset = await MediaAsset.findOne({ _id: id.parse(req.params.id), userId: req.user._id, type: "image", deletedAt: null });
 if (!asset) return res.status(404).json({ error: "Image not found" });
 if ((asset.sizeBytes || 0) > 15 * 1024 * 1024) throw new Error("Source exceeds manual editor limit");
 const source = asset.url?.startsWith("data:") ? Buffer.from(asset.url.split(",")[1], "base64") : (await readMediaObject(asset.key))?.buffer;
 if (!source) throw new Error("Source unavailable");
 let image = sharp(source, { limitInputPixels: 40000000 });
 if (input.crop) image = image.extract(input.crop);
 if (input.flip) image = image.flop();
 image = image.rotate(Number(input.rotate));
 if (input.width || input.height) image = image.resize(input.width, input.height, { fit: "inside" });
 const output = await image.png().toBuffer();
 res.status(201).json({ asset: await store(req, output, { tool: "manual", parentAssetId: String(asset._id), operations: input, creditsCharged: 0 }, asset.projectId) });
}));

imageStudioRouter.post("/studio/assets/:id/remove-background", wrap(async (req: any, res: any) => {
 const input = z.object({ color: z.string().regex(/^#[a-f0-9]{6}$/i), tolerance: z.number().int().min(0).max(150).default(30) }).parse(req.body);
 const asset = await MediaAsset.findOne({ _id: id.parse(req.params.id), userId: req.user._id, type: "image", deletedAt: null });
 if (!asset) return res.status(404).json({ error: "Image not found" });
 if ((asset.sizeBytes || 0) > 15 * 1024 * 1024) throw new Error("Source exceeds the 15MB editor limit");
 const source = asset.url?.startsWith("data:") ? Buffer.from(asset.url.split(",")[1], "base64") : (await readMediaObject(asset.key))?.buffer;
 if (!source) throw new Error("Source unavailable");
 const { removeSolidBackground } = await import("../services/backgroundRemoval.js");
 const result = await removeSolidBackground(source, input.color, input.tolerance);
 res.status(201).json({ asset: await store(req, result.buffer, { tool: "background", parentAssetId: String(asset._id), method: "border-connected-solid-color", removedPixels: result.removedPixels, creditsCharged: 0 }, asset.projectId) });
}));
