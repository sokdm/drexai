export async function readProviderStream(response: Response, onDelta: (text: string) => void) {
 if (!response.body) throw new Error("Provider stream is empty");
 const reader = response.body.getReader(), decoder = new TextDecoder();
 let buffer = "", text = "", usage: any, id = "", finished = false, reason = "";
 try {
  while (true) {
   const part = await reader.read(); buffer += decoder.decode(part.value, { stream: !part.done }).replaceAll("\r\n", "\n");
   let end;
   while ((end = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
    for (const line of frame.split("\n")) if (line.startsWith("data:")) {
     const data = line.slice(5).trim(); if (data === "[DONE]") { finished = true; continue; } if (!data) continue;
     const value = JSON.parse(data); if (value.error) throw new Error("Provider streaming response failed");
     id = value.id || id; usage = value.usage || usage;
     const delta = value.choices?.[0]?.delta?.content;
     if (typeof delta === "string") { text += delta; onDelta(delta); }
     reason = value.choices?.[0]?.finish_reason || reason;
    }
   }
   if (part.done) break;
  }
 } finally { reader.releaseLock(); }
 if ((!finished && !reason) || !text.trim() || ["length", "content_filter"].includes(reason)) throw new Error("The response was interrupted. Your partial result is preserved; retry with a new approval.");
 return { id, usage, text };
}
