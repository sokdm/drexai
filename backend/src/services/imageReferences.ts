import { MediaAsset } from "../models/MediaAsset.js";
import { CharacterProfile } from "../models/CharacterProfile.js";
import { AIProject } from "../models/AIProject.js";
import { readMediaObject } from "./mediaStorage.js";
import { verifiedRouterModel, checkCapability, isOpenRouter } from "./openrouter.js";
export async function imageReferences(userId: any, settings: any, bytes = false) {
  if (settings.projectId && !await AIProject.exists({ _id: settings.projectId, userId })) throw new Error("Project not found");
  if (["editor", "variations", "product", "style", "background"].includes(settings.tool) && !settings.sourceAssetIds?.length) throw new Error("Select a source image for this tool");
  if (settings.background) {
    if (!isOpenRouter(settings.model)) throw new Error("Transparent background removal requires a verified OpenRouter model");
    checkCapability(await verifiedRouterModel(settings.model, "image"), "background", settings.background);
  }
  const characters = await CharacterProfile.find({ _id: { $in: settings.characterReferenceIds || [] }, userId });
  if (characters.length !== (settings.characterReferenceIds || []).length) throw new Error("Character not found");
  const ids = [...new Set([...(settings.sourceAssetIds || []), ...characters.map(c => String(c.referenceAssetId || "")).filter(Boolean)])];
  if (ids.length > 4) throw new Error("Choose at most four reference images");
  const assets = await MediaAsset.find({ _id: { $in: ids }, userId, type: "image", deletedAt: null });
  if (assets.length !== ids.length) throw new Error("Reference image not found");
  if (assets.some(a => (a.sizeBytes || 0) > 15 * 1024 * 1024)) throw new Error("Each reference must be smaller than 15 MB");
  if (ids.length && isOpenRouter(settings.model)) checkCapability(await verifiedRouterModel(settings.model, "image"), "input_references", ids.length);
  const referenceImages = [];
  if (bytes) for (const asset of assets) {
    const object = asset.url?.startsWith("data:") ? { buffer: Buffer.from(asset.url.split(",")[1], "base64"), contentType: asset.contentType } : await readMediaObject(asset.key);
    if (!object || object.buffer.length > 15 * 1024 * 1024) throw new Error("Reference image unavailable or too large");
    referenceImages.push({ data: object.buffer.toString("base64"), contentType: object.contentType });
  }
  return { referenceImages, characterDescription: characters.map(c => `${c.name}: ${c.appearance || ""}; ${c.clothing || ""}`).join("\n") };
}
