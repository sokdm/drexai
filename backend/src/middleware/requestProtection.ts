import type {RequestHandler} from 'express';import {env} from '../config/env.js';
// CORS alone prevents reading responses; reject foreign state-changing requests too.
export const requestProtection:RequestHandler=(req,res,next)=>{
 const allowed=[env.APP_URL,env.CLIENT_ORIGIN].flatMap(value=>{try{return [new URL(value).origin];}catch{return [];}});
 if(!['GET','HEAD','OPTIONS'].includes(req.method)){
  const origin=req.get('origin');if(origin&&!allowed.includes(origin)||!origin&&req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'This request is not permitted from that website.'});
 }
 const pending:any[]=[req.body,req.query];let visited=0;
 while(pending.length){const item=pending.pop();if(!item||typeof item!=='object'||Buffer.isBuffer(item))continue;if(++visited>50000)return res.status(400).json({error:'Request structure is too complex.'});for(const key of Object.keys(item)){if(key.startsWith('$')||['__proto__','constructor','prototype'].includes(key))return res.status(400).json({error:'Invalid request field.'});pending.push(item[key]);}}
 next();
};
