export function blockedModel(id:string){return /gemini|(?:^|\/)google\/|^veo-|(?:^|\/)veo-/i.test(id||'') || /(?:^|\/)free$|:free$/i.test(id||'');}
export function assertAllowedModel(id:string){if(blockedModel(id))throw Object.assign(new Error('This retired AI route is disabled. Prepare a new operation quote with an available model.'),{code:'MODEL_RETIRED',providerRejected:true,status:404});}
export const safeTextModel=(id:string)=>blockedModel(id)?'openrouter/openai/gpt-4.1-mini':id;

export async function approvedMediaFallback(input:any,alternatives:any[],ceiling:{credits:number;providerCostUsd:number},run:()=>Promise<any>,onSwitch:(alternative:any)=>Promise<void>){
 const allowed=alternatives.filter(a=>!blockedModel(a.input?.model)&&Number.isFinite(a.providerCostUsd)&&a.credits<=ceiling.credits&&a.providerCostUsd<=ceiling.providerCostUsd);let next=0;
 for(;;){try{return await run();}catch(error:any){if(!error.providerRejected||![403,404,429,503].includes(error.status)||next>=allowed.length)throw error;const alternative=allowed[next++];Object.assign(input,alternative.input);await onSwitch(alternative);}}
}
