import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { API_URL } from "./api";
import { useAuth } from "./auth";
let socket: Socket | undefined, subscribers = 0;
const csrf = () => decodeURIComponent(document.cookie.split("; ").find(v => v.startsWith("drex_csrf="))?.split("=")[1] || "");
export function useRealtime(events: Record<string, () => void>) {
  const { user } = useAuth(), handlers = useRef(events); handlers.current = events;
  useEffect(() => {
    if (!user || !csrf()) return;
    socket ||= io(API_URL, { withCredentials: true, auth: cb => cb({ csrf: csrf() }), reconnection: true }); subscribers++;
    const client = socket; const listeners = Object.keys(handlers.current).map(event => { const fn = () => handlers.current[event]?.(); client.on(event, fn); return { event, fn }; });
    return () => { listeners.forEach(({ event, fn }) => client.off(event, fn)); if (--subscribers === 0) { client.disconnect(); socket = undefined; } };
  }, [user?.id]);
}
