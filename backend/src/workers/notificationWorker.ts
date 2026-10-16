import mongoose from "mongoose";
import { NotificationCursor } from "../models/Notification.js";
import { ImageGenerationJob } from "../models/ImageGenerationJob.js";
import { VideoGenerationJob } from "../models/VideoGenerationJob.js";
import { AudioGenerationJob } from "../models/AudioGenerationJob.js";
import { StudioProduction } from "../models/StudioProduction.js";
import { VideoExport } from "../models/VideoEdit.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { notify } from "../services/notifications.js";
import { deliverSupportEmails } from "../services/supportEmail.js";

const sources: any[] = [
  ["image", ImageGenerationJob, "/dashboard/text-to-image"], ["video", VideoGenerationJob, "/dashboard/image-to-video"],
  ["voice", AudioGenerationJob, "/dashboard/voice-studio"], ["studio", StudioProduction, "/dashboard/ai-studio"], ["export", VideoExport, "/dashboard/video-editor"],
  ["purchase", LedgerEntry, "/dashboard/credit-wallet"]
];
export async function captureNotifications() {
  for (const [kind, model, href] of sources) {
    let cursor = await NotificationCursor.findById(kind);
    if (!cursor) cursor = await NotificationCursor.findOneAndUpdate({ _id: kind }, { $setOnInsert: { at: new Date(Date.now() - 86400000), lastId: new mongoose.Types.ObjectId("000000000000000000000000") } }, { upsert: true, new: true });
    const timeField = kind === "purchase" ? "createdAt" : "updatedAt";
    const query = { ...(kind === "purchase" ? { type: "purchase" } : { status: { $in: ["completed", "failed"] } }), $or: [{ [timeField]: { $gt: cursor!.at } }, { [timeField]: cursor!.at, _id: { $gt: cursor!.lastId } }] };
    const rows = await model.find(query).sort({ [timeField]: 1, _id: 1 }).limit(100).lean();
    for (const row of rows) {
      const purchase = kind === "purchase", success = row.status === "completed";
      await notify({ userId: row.userId, eventKey: `${kind}:${row._id}:${purchase ? "confirmed" : row.status}`, type: purchase ? "purchase" : "generation", title: purchase ? "Credit purchase confirmed" : `${kind === "export" ? "Video export" : kind.charAt(0).toUpperCase() + kind.slice(1) + " generation"} ${success ? "completed" : "failed"}`, content: purchase ? `${row.amountCredits} credits were added to your wallet.` : success ? "Your result is ready to review." : "Open the workspace to review the error and available recovery options.", href });
      // Advance only after durable notification creation. Duplicate workers are harmless due to unique event keys.
      await NotificationCursor.updateOne({ _id: kind, $or: [{ at: { $lt: row[timeField] } }, { at: row[timeField], lastId: { $lte: row._id } }] }, { $set: { at: row[timeField], lastId: row._id } });
    }
  }
}
export function startNotificationWorker() {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await captureNotifications(); await deliverSupportEmails(); } catch (e) { console.error("Notification worker:", e instanceof Error ? e.message : "Failed"); } finally { running = false; } };
  const timer = setInterval(() => void tick(), 15000); timer.unref(); void tick(); return () => clearInterval(timer);
}
