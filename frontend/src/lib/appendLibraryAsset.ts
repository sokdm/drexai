import { EditorTimeline, timelineDuration, timelineSchema } from "@drex/shared";
export function appendLibraryAsset(timeline: EditorTimeline, asset: any): EditorTimeline {
 if (asset.type === "audio") {
  const duration = Math.min(asset.durationSeconds || 0, timelineDuration(timeline));
  if (duration < .1) throw new Error("Add visual clips before adding music.");
  if (!asset.metadata?.licenseConfirmed) throw new Error("Asset usage permission has not been confirmed.");
  return timelineSchema.parse({ ...timeline, musicDecision: "added", audio: [...timeline.audio, { id:crypto.randomUUID(),assetId:asset._id,label:asset.metadata?.name || "Music",role:"music",start:0,sourceIn:0,duration,volume:.2,muted:false,fadeIn:Math.min(.5,duration/3),fadeOut:Math.min(.5,duration/3) }] });
 }
 return timelineSchema.parse({ ...timeline,clips:[...timeline.clips,{ id:crypto.randomUUID(),assetId:asset._id,label:asset.metadata?.name || "Library image",kind:asset.type,sourceIn:0,duration:asset.type === "video" ? Math.min(600,asset.durationSeconds || 4) : 4,transition:"cut",fit:"contain",text:"",textStyle:{} }] });
}
