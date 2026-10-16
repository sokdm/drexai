import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { emitUserEvent } from "../realtime.js";

export async function notify(input: { userId: any; eventKey: string; type: string; title: string; content: string; href: string }, session?: any) {
  if (input.type === "generation") { const user = await User.findById(input.userId).session(session || null); if (user?.preferences?.generationNotifications === false) return; }
  const result = await Notification.updateOne({ eventKey: input.eventKey }, { $setOnInsert: input }, { upsert: true, session });
  if (!session && result.upsertedCount) emitUserEvent(String(input.userId), "notifications:changed", {});
}
