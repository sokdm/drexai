import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { imagesRouter } from "../dist/routes/images.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { MediaAsset } from "../dist/models/MediaAsset.js";
import { ImageGenerationJob } from "../dist/models/ImageGenerationJob.js";
import { CharacterProfile } from "../dist/models/CharacterProfile.js";
import { LedgerEntry } from "../dist/models/LedgerEntry.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
import { imageReferences } from "../dist/services/imageReferences.js";
import { processImageJob } from "../dist/workers/processImageJob.js";
import { env } from "../dist/config/env.js";
let db, server, base, user, other, image, headers, bytes;
const originalFetch = globalThis.fetch;
before(async () => {
 db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(db.getUri("image_studio"));
 Object.assign(env, { R2_ACCOUNT_ID: undefined, R2_ACCESS_KEY_ID: undefined, R2_SECRET_ACCESS_KEY: undefined, R2_BUCKET: undefined, GEMINI_API_KEY: "mock-only" });
 user = await User.create({ email: "image@example.test", displayName: "Image", passwordHash: "fixture" }); other = await User.create({ email: "other@example.test", displayName: "Other", passwordHash: "fixture" });
 await Session.create({ userId: user._id, tokenHash: hashSecret("image-session"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now()+3600000) }); headers = { Cookie: "drex_session=image-session", "x-csrf-token": "csrf", "Content-Type": "application/json" };
 bytes = await sharp({ create: { width: 128, height: 96, channels: 3, background: "red" } }).png().toBuffer();
 image = await MediaAsset.create({ userId: user._id, provider: "upload", key: "fixture.png", contentType: "image/png", sizeBytes: bytes.length, url: "data:image/png;base64," + bytes.toString("base64") });
 const app = express(); app.use(express.json(), cookieParser()); app.use("/api/images", imagesRouter); app.use(errorHandler); server = await new Promise(r => { const s = app.listen(0,"127.0.0.1",()=>r(s)); }); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { globalThis.fetch = originalFetch; server?.closeAllConnections(); await new Promise(r=>server.close(r)); await mongoose.disconnect(); await db.stop(); });
async function request(path, body, method="POST") { const r = await originalFetch(base+"/api/images"+path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status:r.status, data:await r.json() }; }
test("workspace settings persist and owned characters use the shared asset library", async () => {
 const state = { tool:"editor", prompt:"Improve lighting", model:"gemini-nano-banana-2.1", stylePreset:"Cinematic", aspectRatio:"16:9", resolution:"1K", numberOfImages:1, selectedId:String(image._id), sourceAssetIds:[String(image._id)], characterReferenceIds:[] };
 assert.equal((await request("/studio/state",state,"PUT")).status,200);
 assert.equal((await request("/studio/state",null,"GET")).data.state.prompt,"Improve lighting");
 const saved = await request("/studio/characters",{name:"Hero",appearance:"Red clothing",assetId:String(image._id)}); assert.equal(saved.status,201);
 const refs = await imageReferences(user._id,{characterReferenceIds:[saved.data.character._id],sourceAssetIds:[],model:"gemini-nano-banana-2.1"},true);
 assert.equal(refs.referenceImages.length,1); assert.match(refs.characterDescription,/Red clothing/);
 await assert.rejects(imageReferences(other._id,{sourceAssetIds:[String(image._id)]}),/not found/);
});
test("manual transforms save an original-preserving asset without wallet charges",async()=>{
 const ledgerBefore = await LedgerEntry.countDocuments();
 const result = await request(`/studio/assets/${image._id}/transform`,{rotate:"90",width:64,height:64}); assert.equal(result.status,201);
 assert.equal(result.data.asset.metadata.creditsCharged,0); assert.equal(result.data.asset.metadata.parentAssetId,String(image._id));
 assert.equal(await LedgerEntry.countDocuments(),ledgerBefore); assert.ok(await MediaAsset.findById(image._id));
 const info = await sharp(Buffer.from(result.data.asset.url.split(",")[1],"base64")).metadata(); assert.equal(info.height,64);
});
test("completed image request IDs are returned without a second provider call or charge",async()=>{
 const requestId = "12345678-1234-4234-8234-123456789012";
 const job = await ImageGenerationJob.create({ userId:user._id, model:"gemini-nano-banana-2.1",prompt:"A tree",requestId,status:"completed" });
 const result = await request("/generate",{prompt:"A tree",model:job.model,aspectRatio:"16:9",resolution:"1K",numberOfImages:1,requestId,approvedCredits:5});
 assert.equal(result.status,202); assert.equal(result.data.job._id,String(job._id)); assert.equal(await ImageGenerationJob.countDocuments({requestId}),1);
});
test("image worker sends real reference bytes and processing the completed job again is a no-op",async()=>{
 let calls=0;
 globalThis.fetch = async(url,options)=>{ assert.equal(String(url),"https://generativelanguage.googleapis.com/v1beta/interactions"); const body=JSON.parse(options.body); assert.equal(body.input[1].data,bytes.toString("base64")); calls++; return Response.json({outputs:[{type:"image",mime_type:"image/png",data:bytes.toString("base64")}]}); };
 const job = await ImageGenerationJob.create({userId:user._id,model:"gemini-nano-banana-2.1",prompt:"Relight the source",tool:"editor",sourceAssetIds:[String(image._id)],aspectRatio:"16:9",resolution:"1K",numberOfImages:1,status:"queued"});
 await processImageJob(String(job._id)); await processImageJob(String(job._id)); assert.equal(calls,1); assert.equal((await ImageGenerationJob.findById(job._id)).status,"completed");
 globalThis.fetch=originalFetch;
});
