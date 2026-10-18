import {test} from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {MongoMemoryReplSet} from "mongodb-memory-server";
import {fileURLToPath} from "node:url";
import {env} from "../dist/config/env.js";
import {RenderWorker} from "../dist/models/VideoEdit.js";
import {startRenderFallback} from "../dist/services/renderFallback.js";
test("web rendering publishes readiness only after FFmpeg verification",{timeout:60000},async()=>{
 const db=await MongoMemoryReplSet.create({replSet:{count:1},binary:{downloadDir:fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server",import.meta.url))}});let stop;
 try{await mongoose.connect(db.getUri("render_fallback"));Object.assign(env,{RENDER_QUEUE_ENABLED:true,R2_ACCOUNT_ID:"fixture",R2_ACCESS_KEY_ID:"fixture",R2_SECRET_ACCESS_KEY:"fixture",R2_BUCKET:"fixture"});stop=startRenderFallback();let worker;for(let i=0;i<120;i++){worker=await RenderWorker.findById("ffmpeg-web");if(worker)break;await new Promise(r=>setTimeout(r,250));}assert.ok(worker);assert.ok(worker.expiresAt>new Date());assert.ok(worker.capabilities.formats.includes("mp4"));}finally{stop?.();await mongoose.disconnect();await db.stop();}
});
