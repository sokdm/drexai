import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { timelineSchema } from "@drex/shared";
import { renderTimeline, runMedia } from "../dist/services/ffmpeg.js";
import { applyPackPreset } from "../dist/routes/assetPacks.js";

test("real FFmpeg composites timed muted video overlays with animation and motion templates",async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),"drex-overlay-test-"));
 try {
  const source=path.join(directory,"red.mp4");
  await runMedia("ffmpeg",["-hide_banner","-loglevel","error","-y","-f","lavfi","-i","color=c=red:s=160x160:r=30:d=2","-c:v","libx264","-pix_fmt","yuv420p",source]);
  const assetId="a11111111111111111111111";
  const base={clips:[{id:"base",kind:"title",label:"Base",text:"",duration:2}],audio:[],captions:[],overlays:[{id:"overlay",assetId,kind:"video",label:"Red layer",start:.5,sourceIn:0,duration:1,x:.5,y:.5,width:.4,height:.4,opacity:1,rotation:0,animation:"slide-left"}],aspectRatio:"1:1",musicDecision:"none"};
  const timeline=timelineSchema.parse(base);
  const rendered=await renderTimeline(timeline,{format:"mp4",resolution:"480p",quality:"draft",filename:"overlay"},new Map([[assetId,source]]),directory);
  assert.ok(Math.abs(rendered.duration-2)<.15);
  for(const [time,name] of [[.2,"before"],[1,"during"],[1.8,"after"]]) {
   const file=path.join(directory,name+".png");await runMedia("ffmpeg",["-hide_banner","-loglevel","error","-y","-ss",String(time),"-i",rendered.file,"-frames:v","1",file]);
   const pixel=await sharp(await readFile(file)).extract({left:239,top:239,width:1,height:1}).removeAlpha().raw().toBuffer();
   if(name==="during")assert.ok(pixel[0]>180&&pixel[1]<60,"overlay must be visibly red");else assert.ok(pixel[0]<80,"overlay must not appear outside its interval");
  }
  for (const animation of ["fade","zoom-in"]) {
   const sub=path.join(directory,animation);await (await import("node:fs/promises")).mkdir(sub);
   const variant=timelineSchema.parse({...base,overlays:[{...base.overlays[0],animation,rotation:15,opacity:.7}]});
   const output=await renderTimeline(variant,{format:"mp4",resolution:"480p",quality:"draft",filename:animation},new Map([[assetId,source]]),sub);assert.ok(output.sizeBytes>100);
  }
  const animated=applyPackPreset(timeline,{motion:"gentle-push"});assert.equal(animated.clips[0].keyframes[1].zoom,1.12);
  const title=applyPackPreset(timeline,{motion:"title-reveal",title:"Original product"});assert.equal(title.captions[0].text,"Original product");assert.equal(title.captions[0].style.animation,"pop");
  assert.equal(timelineSchema.safeParse({...base,overlays:[{...base.overlays[0],duration:3}]}).success,false);
 } finally {await rm(directory,{recursive:true,force:true});}
});
