import {safeTextModel} from "./modelPolicy.js";
import {defaultModel,assertProviderBudget} from "./platformControl.js";
import {routerCatalog} from "./openrouter.js";
import {env} from "../config/env.js";
// Saved legacy modes remain readable, but never select free endpoints.
export async function assistantModel(feature:string, mode="configured", _userId?:string, _requests=1){
 const configured=safeTextModel(await defaultModel(feature,await defaultModel("text","openrouter/"+env.OPENROUTER_TEXT_MODEL)));
 const preferred=mode==='paid'?safeTextModel('openrouter/'+env.OPENROUTER_TEXT_FALLBACK_MODEL):configured;
 const records=(await routerCatalog('text')).filter((r:any)=>r.architecture?.output_modalities?.includes('text')&&r.supported_parameters?.includes('response_format')&&r.supported_parameters?.includes('max_tokens')&&r.context_length>=32000&&(Number(r.pricing?.prompt)>0||Number(r.pricing?.completion)>0));
 records.sort((a:any,b:any)=>Number('openrouter/'+b.id===preferred)-Number('openrouter/'+a.id===preferred)||(Number(a.pricing?.prompt)+Number(a.pricing?.completion))-(Number(b.pricing?.prompt)+Number(b.pricing?.completion)));
 for(const record of records)try{const model='openrouter/'+record.id;await assertProviderBudget(model,0);return model;}catch{}
 throw new Error('No compatible text service is currently available. No credits were reserved.');
}
