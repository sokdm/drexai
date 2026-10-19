import {needsNarration} from './sceneAudio.js';
import {imageModels} from './imageGeneration.js';
import {videoModels} from './videoGeneration.js';
import {ttsModels} from './textToSpeech.js';
import {configuredModels} from './platformControl.js';
import {buildStudioSteps,studioSettingsSchema} from './studioPlan.js';
import {priceStudioSteps} from './studioPricing.js';
export async function affordableStudioSettings(snapshot:any,input:any){
 // MongoDB can omit empty objects in older Mixed settings. Restore validated defaults.
 let settings=studioSettingsSchema.parse(input);
 if(!snapshot.scenes.some((scene:any)=>needsNarration(scene)))settings.narration=false;const selections:any[]=[];
 for(const [kind,key,models] of [['image','imageModel',imageModels],['video','videoModel',videoModels],['voice','voiceModel',ttsModels]] as const){
  if(kind==='video'&&!settings.video||kind==='voice'&&!settings.narration)continue;
  const candidates=(await configuredModels(kind,models as any)).filter((m:any)=>m.id.startsWith('openrouter/')&&!/google\/|gemini|veo/i.test(m.id));
  let best:any;const options:any[]=[];const reasons:string[]=[];
  for(const candidate of candidates as any[]){try{
   if(kind==='image'&&(!candidate.resolutions.includes(settings.resolution)||!candidate.aspectRatios.includes(settings.aspectRatio)))continue;
   if(kind==='video'&&(!candidate.qualities.includes(settings.quality)||!candidate.aspectRatios.includes(settings.aspectRatio)||!candidate.nativeAudio)){reasons.push(`${candidate.label}: selected quality/aspect ratio is unsupported`);continue;}
   if(kind==='voice'&&!candidate.languages.includes(settings.language))continue;
   const proposed={...settings,[key]:candidate.id,...(kind==='voice'?{voiceId:candidate.voices.includes(settings.voiceId)?settings.voiceId:candidate.voices[0],characterVoices:{}}:{})};
   const steps=buildStudioSteps(snapshot,{...proposed,narration:kind==='voice'&&proposed.narration,video:kind==='video'&&proposed.video}).filter(s=>s.kind===(kind==='voice'?'audio':kind));
   const quote=await priceStudioSteps(steps);if(quote.credits==null||quote.missingPricing.length){reasons.push(`${candidate.label}: verified pricing is temporarily unavailable`);continue;}
   options.push({settings:proposed,credits:quote.credits,model:candidate.id,steps});
   if(!best||quote.credits<best.credits)best={settings:proposed,credits:quote.credits,model:candidate.id};
  }catch(error){const message=error instanceof Error?error.message:'Unsupported configuration';reasons.push(message);console.warn('Studio model candidate rejected',{kind,model:candidate.id,reason:error instanceof Error?error.message:'Unsupported configuration'});}}
  if(best){settings=best.settings;selections.push({kind,model:best.model,credits:best.credits,alternatives:options.filter(o=>o.model!==best.model&&o.credits<=best.credits).map(o=>({model:o.model,steps:o.steps}))});}
  else {const sceneIssue=reasons.find(r=>/^Scene \d+ needs|^Every scene|^Scene orders|^Production requires/.test(r));throw Object.assign(new Error(sceneIssue?sceneIssue+' No credits were reserved.':candidates.length?'Could not prepare '+kind+' generation: '+[...new Set(reasons)].slice(0,2).join('; ')+'. Your saved script is unchanged; no credits were reserved.':'Video service model discovery is temporarily unavailable or no models are enabled. Your script is saved. Retry preparing the plan; no credits were reserved.'),{code:'APPROVAL_STATE',statusCode:409});}
 }
 return {settings,selections};
}
