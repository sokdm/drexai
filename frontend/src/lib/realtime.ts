import {useEffect,useRef} from "react";
import {io,Socket} from "socket.io-client";
import {API_URL} from "./api";
import {useAuth} from "./auth";
let socket:Socket|undefined,subscribers=0,owner:string|undefined;
let connectTimer:ReturnType<typeof setTimeout>|undefined,disposeTimer:ReturnType<typeof setTimeout>|undefined;
const csrf=(admin=false)=>decodeURIComponent(document.cookie.split("; ").find(v=>v.startsWith(admin?"drex_admin_csrf=":"drex_csrf="))?.split("=")[1]||"");
export function useRealtime(events:Record<string,()=>void>,administrative=false){
 const {user}=useAuth(),handlers=useRef(events);handlers.current=events;
 useEffect(()=>{
  if((!administrative&&!user)||!csrf(administrative))return;
  const identity=administrative?"admin":user!.id;
  clearTimeout(disposeTimer);
  if(socket&&owner!==identity){clearTimeout(connectTimer);socket.disconnect();socket=undefined;}owner=identity;
  // A single WebSocket avoids polling sessions being sent to another Render instance.
  socket ||=io(API_URL,{autoConnect:false,transports:["websocket"],withCredentials:true,auth:cb=>cb({csrf:csrf(administrative),scope:administrative?"admin":"user"}),reconnection:true,reconnectionAttempts:8,reconnectionDelay:1000,reconnectionDelayMax:15000});subscribers++;
  const client=socket;
  clearTimeout(connectTimer);connectTimer=setTimeout(()=>{if(subscribers&&!client.connected)client.connect();},0);
  const listeners=Object.keys(handlers.current).map(event=>{const fn=()=>handlers.current[event]?.();client.on(event,fn);return{event,fn}});
  return()=>{
   listeners.forEach(({event,fn})=>client.off(event,fn));
   if(--subscribers===0){clearTimeout(connectTimer);disposeTimer=setTimeout(()=>{if(!subscribers){client.disconnect();if(socket===client)socket=undefined;}},250);}
  };
 },[user?.id,administrative]);
}
