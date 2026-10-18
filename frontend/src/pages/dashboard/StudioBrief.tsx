import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

export function StudioBrief({ onProject, onActivity }: { onProject: (project: any) => void; onActivity?:(events:any[])=>void }) {
 const [topic,setTopic]=useState(""),[seconds,setSeconds]=useState(60),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [job,setJob]=useState<any>(()=>{const id=localStorage.getItem("drex-studio-script");return id?{_id:id,status:"queued",logs:[]}:null;});
 const requestId=useRef(crypto.randomUUID());
 const active=job && !["completed","failed","needs_review"].includes(job.status);
 useEffect(()=>{
  if(!active)return;let alive=true;
  const poll=async()=>{try{const data=await api<any>(`/api/ai/scripts/jobs/${job._id}`);if(!alive)return;setJob(data.job);onActivity?.((data.job.logs||[]).map((l:any,i:number)=>({_id:data.job._id+":"+i,createdAt:l.at||data.job.updatedAt,level:l.stage==="error"?"failure":"processing",stepKey:l.stage,message:l.message})));if(["completed","failed","needs_review"].includes(data.job.status)){localStorage.removeItem("drex-studio-script");if(data.project)onProject(data.project);if(data.job.error)setError(data.job.error);window.dispatchEvent(new Event("wallet:refresh"));}}catch(e:any){if(alive)setError("Reconnecting to saved script: "+e.message);}};
  void poll();const timer=setInterval(()=>void poll(),4000);return()=>{alive=false;clearInterval(timer);};
 },[job?._id,active]);
 async function send(){setBusy(true);setError("");try{
  const settings={storyTopic:topic,targetDuration:`${seconds} seconds`,modelMode:"auto",type:"Video production"};
  const {quote}=await api<any>("/api/ai/scripts/quote",{method:"POST",body:JSON.stringify({settings})});if(!quote.allowed)throw new Error(quote.reason);
  if(quote.credits>0&&!window.confirm(`Create this script for ${quote.credits} credits? Media generation will require a separate approval.`))return;
  const data=await api<any>("/api/ai/scripts/generate",{method:"POST",body:JSON.stringify({settings,approvedCredits:quote.credits,requestId:requestId.current})});setJob(data.job);localStorage.setItem("drex-studio-script",data.job._id);requestId.current=crypto.randomUUID();
 }catch(e:any){setError(e.message);}finally{setBusy(false);}}
 return <section className="studio-start-brief"><h3>Create directly in AI Studio</h3><label>Describe your video<textarea aria-label="Studio video brief" rows={3} value={topic} disabled={busy||active} onChange={e=>setTopic(e.target.value)} placeholder="A short story, explainer, product idea or video concept"/></label><label>Target seconds<input type="number" min={1} max={1800} value={seconds} disabled={busy||active} onChange={e=>setSeconds(Number(e.target.value))}/></label><button disabled={busy||active||topic.trim().length<2} onClick={()=>void send()}>{active?"Writing your saved scenes":busy?"Starting":"Create script"}</button>{error&&<p role="alert">{error}</p>}</section>;
}
