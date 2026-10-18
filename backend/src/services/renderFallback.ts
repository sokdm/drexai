import mongoose from "mongoose";
import { env } from "../config/env.js";
import { RenderWorker } from "../models/VideoEdit.js";
import { persistentStorageConfigured } from "./mediaStorage.js";
import { renderCapabilities } from "./ffmpeg.js";
import { processVideoExport } from "./videoExport.js";

export function startRenderFallback() {
 if (!env.RENDER_QUEUE_ENABLED || !persistentStorageConfigured()) return;
 let busy=false, capabilities: any;
 const tick=async()=>{
  if(busy || mongoose.connection.readyState !== 1)return;busy=true;
  try {
   if(await RenderWorker.exists({_id:"ffmpeg",expiresAt:{$gt:new Date()}}))return;
   capabilities ||= await renderCapabilities();
   await RenderWorker.updateOne({_id:"ffmpeg-web"},{$set:{expiresAt:new Date(Date.now()+30000),capabilities}},{upsert:true});
   const heartbeat=setInterval(()=>void RenderWorker.updateOne({_id:"ffmpeg-web"},{$set:{expiresAt:new Date(Date.now()+30000)}}).catch(()=>{}),10000);
   try{await processVideoExport();}finally{clearInterval(heartbeat);}
  }catch(e:any){console.warn("Local render worker:",e.message);}finally{busy=false;}
 };
 void tick();const timer=setInterval(()=>void tick(),5000);timer.unref();return ()=>clearInterval(timer);
}
