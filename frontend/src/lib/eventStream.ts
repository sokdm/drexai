import { API_URL } from "./api";
export async function eventStream(path: string, body: any, receive: (event: string, data: any) => void) {
 const csrf = decodeURIComponent(document.cookie.split("; ").find(c => c.startsWith("drex_csrf="))?.split("=")[1] || "");
 const response = await fetch(API_URL + path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
 if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Request failed"); }
 if (!response.body) throw new Error("Streaming is not available");
 const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "", done = false;
 try { while (true) { const part = await reader.read(); pending += decoder.decode(part.value, { stream: !part.done }); let end;
  while ((end = pending.indexOf("\n\n")) >= 0) { const frame = pending.slice(0, end); pending = pending.slice(end + 2); const lines = frame.split("\n"), event = lines.find(v => v.startsWith("event:"))?.slice(6).trim() || "message", data = lines.filter(v => v.startsWith("data:")).map(v => v.slice(5).trim()).join("\n"); if (!data) continue; const parsed = JSON.parse(data); if (event === "error") throw new Error(parsed.message); if (event === "done") done = true; receive(event, parsed); }
  if (part.done) break;
 } } finally { reader.releaseLock(); }
 if (!done) throw new Error("Connection interrupted. Reopen the conversation to recover its saved response before retrying.");
}
