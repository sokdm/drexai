import type {ErrorRequestHandler} from 'express';import {randomUUID} from 'node:crypto';
export const errorHandler:ErrorRequestHandler=(error,_req,res,_next)=>{
 const requestId=randomUUID();const status=error?.code===11000?409:error?.name==='CastError'||error?.name==='ZodError'||error?.type==='entity.parse.failed'?400:Number(error?.statusCode||error?.status||500);const safeStatus=Number.isInteger(status)&&status>=400&&status<=599?status:500;
 console.error('Request failed',{requestId,name:error?.name,code:error?.code,status:safeStatus});
 let message=error?.name==='ZodError'?error.errors?.[0]?.message||'Invalid request':error?.code===11000?'This request conflicts with an existing record. Refresh and try again.':error?.name==='CastError'?'Invalid record identifier.':error?.type==='entity.parse.failed'?'Invalid JSON request.':safeStatus===413?'The uploaded request is too large.':safeStatus===500||safeStatus>=500&&process.env.NODE_ENV==='production'?'This service is temporarily unavailable. Please retry shortly.':error?.message||'Could not complete this request.';
 res.status(safeStatus).json({error:message,requestId});
};
