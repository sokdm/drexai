import { FormEvent, useState } from "react";
import { Bot, Send } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { quote } from "./aiShared";
import { ReadableContent } from "../../components/ui/ReadableContent";

export function AIAssistantPage() {
  const [message, setMessage] = useState("Give me original niche ideas for a faceless YouTube channel.");
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError("");
    try {
      const approvedCredits = await quote("ai_research_chat");
      const data = await api<any>("/api/ai/chat", { method: "POST", body: JSON.stringify({ conversationId: conversationId || undefined, message, approvedCredits }) });
      setConversationId(data.conversation._id);
      setMessages(data.conversation.messages);
      setMessage("");
    } catch (err) { setError(err instanceof Error ? err.message : "AI chat failed"); }
    finally { setLoading(false); }
  }

  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"><section className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-3"><Bot className="text-brand" /><div><h2 className="text-3xl font-black">AI Research Assistant</h2><p className="text-slate-600 dark:text-slate-300">Ask for channel analysis, niche ideas, story concepts, titles, and content strategy.</p></div></div>{error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}<div className="mt-6 space-y-4">{messages.map((m) => <div className={`rounded-md p-4 ${m.role === "user" ? "bg-brand text-white" : "bg-cloud dark:bg-slate-950"}`} key={m._id ?? `${m.role}-${m.createdAt}`}><ReadableContent value={m.content} /></div>)}</div><form className="mt-6 flex gap-2" onSubmit={send}><input value={message} onChange={(e) => setMessage(e.target.value)} className="h-12 min-w-0 flex-1 rounded-md border border-line bg-transparent px-4 dark:border-slate-700" /><Button disabled={loading}><Send size={17} /> {loading ? "Thinking..." : "Send"}</Button></form></section><aside className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-black">Try prompts</h3>{["Analyze this channel.", "Suggest 20 story ideas.", "Create a faceless content strategy.", "Generate a movie concept."].map((prompt) => <button className="mt-3 block w-full rounded-md border border-line p-3 text-left text-sm hover:border-brand dark:border-slate-700" onClick={() => setMessage(prompt)} key={prompt}>{prompt}</button>)}</aside></div>;
}
