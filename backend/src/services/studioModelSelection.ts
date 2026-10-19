import {imageModels} from './imageGeneration.js';
import {videoModels} from './videoGeneration.js';
import {ttsModels} from './textToSpeech.js';
import {configuredModels} from './platformControl.js';
import {buildStudioSteps} from './studioPlan.js';
import {priceStudioSteps} from './studioPricing.js';
export async function affordableStudioSettings(snapshot:any,input:any){
 let settings={...input};const selections:any[]=[];
 for(const [kind,key,models] of [['image','imageModel',imageModels],['video','videoModel',videoModels],['voice','voiceModel',ttsModels]] as const){
  if(kind==='video'&&!settings.video||kind==='voice'&&!settings.narration)continue;
  const candidates=(await configuredModels(kind,models as any)).filter((m:any)=>m.id.startsWith('openrouter/')&&!/google\/|gemini|veo/i.test(m.id));
  let best:any;
  for(const candidate of candidates as any[]){try{
   if(kind==='image'&&(!candidate.resolutions.includes(settings.resolution)||!candidate.aspectRatios.includes(settings.aspectRatio)))continue;
   if(kind==='video'&&(!candidate.qualities.includes(settings.quality)||!candidate.aspectRatios.includes(settings.aspectRatio)||!candidate.nativeAudio))continue;
   if(kind==='voice'&&!candidate.languages.includes(settings.language))continue;
   const proposed={...settings,[key]:candidate.id,...(kind==='voice'?{voiceId:candidate.voices.includes(settings.voiceId)?settings.voiceId:candidate.voices[0],characterVoices:{}}:{})};
   const steps=buildStudioSteps(snapshot,proposed).filter(s=>s.kind===(kind==='voice'?'audio':kind));
   const quote=await priceStudioSteps(steps);if(quote.credits==null||quote.missingPricing.length)continue;
   if(!best||quote.credits<best.credits)best={settings:proposed,credits:quote.credits,model:candidate.id};
  }catch{/* Unsupported or unpriced candidates cannot authorize spending. */}}
  if(best){settings=best.settings;selections.push({kind,model:best.model,credits:best.credits});}
  else throw new Error('No supported, priced non-Gemini '+kind+' model is available for these settings. Change the quality/settings or reconnect model discovery; no credits were reserved.');
 }
 return {settings,selections};
}
