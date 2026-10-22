import {AIProject} from '../models/AIProject.js';
import {AIConversation} from '../models/AIConversation.js';
import {AgentTask} from '../models/AgentTask.js';
import {CharacterProfile} from '../models/CharacterProfile.js';
import {VideoExport} from '../models/VideoEdit.js';
export function seriesRequest(message:string,id:string){const match=message.match(/(?:seasons?|episodes?|parts?)\s*1\s*[-\u2013]\s*(\d{1,2})/i)||message.match(/(\d{1,2})\s*(?:seasons?|episodes?|parts?)/i);if(!match)return undefined;const total=Number(match[1]);if(total<2||total>24)throw new Error('Choose a series of 2 to 24 parts. Each part is quoted and approved separately.');return{id,part:1,total,bible:message.slice(0,4000),previousSummary:'',characters:[]};}
export async function nextSeriesTask(userId:string,projectId:string){
 const project=await AIProject.findOne({_id:projectId,userId});if(!project)throw Object.assign(new Error('Project not found'),{statusCode:404,code:'APPROVAL_STATE'});
 const source:any=project.prompts?.sourceSettings,series=source?.series;if(!series||series.part>=series.total)throw Object.assign(new Error('This project has no remaining series parts.'),{statusCode:409,code:'APPROVAL_STATE'});
 const requestId='series:'+series.id+':'+(series.part+1);const existing=await AgentTask.findOne({userId,requestId});if(existing)return existing;
 if(!await VideoExport.exists({userId,projectId,status:'completed',purpose:{$ne:'preview'}}))throw Object.assign(new Error('Complete an export of this part before continuing the series.'),{statusCode:409,code:'APPROVAL_STATE'});
 const characters=await CharacterProfile.find({userId,projectId}).lean();const next={...series,part:series.part+1,previousSummary:JSON.stringify({summary:project.summary,ending:project.scenes.at(-1),characters}).slice(0,7000),characters:characters.map(c=>({name:c.name,appearance:c.appearance,clothing:c.clothing,personality:c.personality,voicePreference:c.voicePreference,referenceAssetId:c.referenceAssetId?String(c.referenceAssetId):undefined,referenceImageUrl:c.referenceImageUrl}))};
 const conversation=await AIConversation.create({userId,projectId,title:'Part '+next.part+' of '+next.total,messages:[]});
 const {createStoryTask}=await import('./agentStory.js');
 return createStoryTask(userId,String(conversation._id),'Create the next original film part. Preserve continuity and continue the unresolved ending.',requestId,undefined,{...source,series:next});
}
