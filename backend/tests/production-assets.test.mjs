import { env } from "../dist/config/env.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { fileURLToPath } from "node:url";
import express from "express";
import sharp from "sharp";
import { assetPackRouter, AssetPack, packSchema } from "../dist/routes/assetPacks.js";
import { MediaAsset } from "../dist/models/MediaAsset.js";
import { VideoEdit } from "../dist/models/VideoEdit.js";
import { LedgerEntry } from "../dist/models/LedgerEntry.js";
import { AdminAudit } from "../dist/models/Admin.js";
import { removeSolidBackground } from "../dist/services/backgroundRemoval.js";
import { buildStudioSteps, studioSettingsSchema } from "../dist/services/studioPlan.js";
let db, server, base, source, pack, edit;
const user = new mongoose.Types.ObjectId(), admin = new mongoose.Types.ObjectId();
before(async()=>{
 Object.assign(env,{ R2_ACCOUNT_ID:undefined,R2_ACCESS_KEY_ID:undefined,R2_SECRET_ACCESS_KEY:undefined,R2_BUCKET:undefined });
 db=await MongoMemoryReplSet.create({replSet:{count:1},binary:{downloadDir:fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server",import.meta.url))}});await mongoose.connect(db.getUri("production_assets"));
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={_id:user};if(req.headers["x-test-admin"]==="true")req.adminUser={_id:admin};next();});app.use(assetPackRouter);app.use((e,req,res,next)=>res.status(e.statusCode||400).json({error:e.message}));
 server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;
 const bytes=await sharp({create:{width:10,height:10,channels:4,background:"blue"}}).png().toBuffer();
 source=await MediaAsset.create({userId:admin,provider:"upload",type:"image",key:"fixture",url:`data:image/png;base64,${bytes.toString("base64")}`,width:10,height:10,sizeBytes:bytes.length,metadata:{name:"Original brand image",licenseConfirmed:true}});
});
after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await mongoose.disconnect();await db.stop();});
const headers={"Content-Type":"application/json","x-test-admin":"true"};
test("solid-background removal preserves enclosed matching colors and returns actual alpha",async()=>{
 const pixels=Buffer.alloc(9*9*4,255);for(let y=2;y<=6;y++)for(let x=2;x<=6;x++){if(x===2||x===6||y===2||y===6){const p=(y*9+x)*4;pixels[p]=pixels[p+1]=pixels[p+2]=0;}}
 const image=await sharp(pixels,{raw:{width:9,height:9,channels:4}}).png().toBuffer();const result=await removeSolidBackground(image,"#ffffff",0);
 const raw=await sharp(result.buffer).ensureAlpha().raw().toBuffer();assert.equal(raw[3],0);assert.equal(raw[(4*9+4)*4+3],255);assert.equal(raw[(2*9+2)*4+3],255);assert.ok(result.removedPixels>0);
 await assert.rejects(removeSolidBackground(image,"#ff0000",0),/No matching background/);
});
test("only administrators can publish packs and changes persist with audit records",async()=>{
 const body={name:"Licensed brand pack",kind:"brand",license:"Original artwork licensed for use in Drex productions",active:true,assetId:String(source._id),reason:"Publish our original brand artwork"};
 assert.equal((await fetch(base+"/asset-packs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})).status,403);
 const response=await fetch(base+"/asset-packs",{method:"POST",headers,body:JSON.stringify(body)});assert.equal(response.status,201);pack=(await response.json()).pack;
 assert.ok(await AdminAudit.exists({action:"asset-pack-create",target:pack._id}));assert.ok(await AssetPack.exists({_id:pack._id,active:true}));
});
test("licensed imports create a distinct owned media asset without wallet charges",async()=>{
 const response=await fetch(base+`/asset-packs/${pack._id}/import`,{method:"POST"});assert.equal(response.status,201,await response.clone().text());const {asset}=await response.json();
 assert.equal(asset.userId,String(user));assert.notEqual(asset.key,source.key);assert.equal(asset.metadata.licenseConfirmed,true);assert.equal(await LedgerEntry.countDocuments(),0);
 assert.equal(await MediaAsset.countDocuments({_id:source._id,userId:admin}),1);
});
test("presets update the existing shared edit and reject stale revisions without billing",async()=>{
 const timeline={clips:[{id:"title",kind:"title",label:"Title",text:"Brand",sourceIn:0,duration:3,transition:"cut",fit:"contain",textStyle:{}}],audio:[],captions:[],aspectRatio:"16:9",musicDecision:"none"};
 edit=await VideoEdit.create({userId:user,projectId:new mongoose.Types.ObjectId(),productionId:new mongoose.Types.ObjectId(),title:"Shared production",timeline,revision:0});
 const response=await fetch(base+"/asset-packs",{method:"POST",headers,body:JSON.stringify({name:"Cinematic preset",kind:"template",license:"Original preset configuration for platform users",active:true,preset:{look:"cinematic",transition:"fade"},reason:"Publish supported editing configuration"})});
 const preset=(await response.json()).pack;
 const apply=()=>fetch(base+`/asset-packs/${preset._id}/apply`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({editId:String(edit._id),revision:0})});
 const result=await apply();assert.equal(result.status,200);const saved=(await result.json()).edit;assert.equal(saved._id,String(edit._id));assert.equal(saved.revision,1);assert.equal(saved.timeline.clips[0].look,"cinematic");assert.equal(saved.timeline.clips[0].transition,"fade");assert.equal((await apply()).status,409);assert.equal(await LedgerEntry.countDocuments(),0);assert.equal(await VideoEdit.countDocuments(),1);
 assert.equal(packSchema.safeParse({name:"Invalid",kind:"effect",license:"Original configuration",active:true,preset:{transition:"invented"}}).success,false);
});
test("product references are passed to every commercial image step",()=>{
 const settings=studioSettingsSchema.parse({imageModel:"gemini-nano-banana-2.1",videoModel:"veo-3.1-generate-preview",voiceModel:"gemini-3.8-flash-tts",video:false,narration:false});
 const snapshot={title:"Brand",characters:[],product:{name:"Coffee maker",benefits:"Easy cleaning",assetIds:[String(source._id)]},scenes:[{_id:String(new mongoose.Types.ObjectId()),order:1,approved:true,imagePrompt:"A real product on a table"}]};
 const steps=buildStudioSteps(snapshot,settings);assert.equal(steps.length,1);assert.deepEqual(steps[0].input.characterReferenceIds,[String(source._id)]);assert.match(steps[0].input.prompt,/Coffee maker/);assert.match(steps[0].input.prompt,/Do not invent claims/);
});
