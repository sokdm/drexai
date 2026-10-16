import { z } from "zod";
import { YouTubeConnection } from "../models/YouTubeConnection.js";
import { authorizedGet } from "./youtube.js";

export const platformAdapters = [
  { id: "youtube", label: "YouTube", mode: "oauth", ratio: "16:9", advice: "Use a clear searchable title, a useful description and an original thumbnail." },
  { id: "shorts", label: "YouTube Shorts", mode: "oauth", ratio: "9:16", advice: "Open with a clear hook and check vertical composition. YouTube determines Shorts eligibility." },
  { id: "tiktok", label: "TikTok", mode: "manual", ratio: "9:16", advice: "Export a vertical video, prepare a short caption and review AI disclosure in TikTok before posting. Direct posting needs API approval." },
  { id: "facebook", label: "Facebook", mode: "manual", ratio: "16:9 or 9:16", advice: "Use a readable caption and review audience and AI disclosure in Facebook. Direct posting needs Meta permissions and approval." }
];
export const metadataSchema = z.object({
  title: z.string().max(100).default(""), description: z.string().max(5000).default(""),
  titles: z.array(z.string().max(100)).max(10).default([]), keywords: z.array(z.string().max(100)).max(50).default([]),
  hashtags: z.array(z.string().max(100)).max(30).default([]), summary: z.string().max(3000).default(""),
  thumbnailConcepts: z.array(z.string().max(2000)).max(6).default([]), callsToAction: z.array(z.string().max(500)).max(10).default([]),
  captions: z.object({ youtube: z.string().max(3000), shorts: z.string().max(3000), tiktok: z.string().max(3000), facebook: z.string().max(3000) }).default({ youtube: "", shorts: "", tiktok: "", facebook: "" }),
});
export function scheduleSummary(rows: any[], columns: any[]) {
  const day = columns.findIndex(c => c.name === "day"), views = columns.findIndex(c => c.name === "views");
  const totals = new Map<number, { views: number; days: number }>();
  if (day >= 0 && views >= 0) for (const row of rows) { const d = new Date(`${row[day]}T12:00:00Z`); if (isNaN(d.getTime()) || !Number.isFinite(Number(row[views]))) continue; const n = d.getUTCDay(), old = totals.get(n) || { views: 0, days: 0 }; totals.set(n, { views: old.views + Number(row[views]), days: old.days + 1 }); }
  if (rows.length < 14 || totals.size < 7 || ![...totals.values()].some(x => x.views > 0)) return null;
  const best = [...totals].sort((a, b) => b[1].views / b[1].days - a[1].views / a[1].days)[0];
  return { weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][best[0]], averageViews: Math.round(best[1].views / best[1].days), days: rows.length };
}
export async function postingRecommendations(userId: string, timezone: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw Object.assign(new Error("Choose a valid timezone."), { statusCode: 400 }); }
  let signal: ReturnType<typeof scheduleSummary> = null, limitation = "No authorized audience activity data is available. These are general test windows, not predictions of your audience.";
  const connection = await YouTubeConnection.findOne({ userId, disconnectedAt: null });
  if (connection?.scopes.includes("https://www.googleapis.com/auth/yt-analytics.readonly")) {
    try {
      const end = new Date(Date.now() - 3 * 86400000), start = new Date(end.getTime() - 27 * 86400000);
      const query = new URLSearchParams({ ids: "channel==MINE", startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), metrics: "views", dimensions: "day" });
      const data = await authorizedGet(connection, `https://youtubeanalytics.googleapis.com/v2/reports?${query}`); signal = scheduleSummary(data.rows || [], data.columnHeaders || []);
      limitation = signal ? "Day suggestions use your authorized daily views, not audience-online or hourly data. Views can reflect older uploads; this does not establish the best time to publish. Hour suggestions remain general experiments. YouTube daily analytics use Pacific Time; the test windows below use your selected timezone." : "Your authorized analytics have insufficient daily data for a useful comparison. General test windows are shown.";
    } catch { limitation = "Authorized YouTube analytics could not be retrieved. General test windows are shown; no audience behavior has been inferred."; }
  }
  return { timezone, limitation, items: platformAdapters.map(p => ({ platform: p.id, label: p.label, basis: signal && ["youtube", "shorts"].includes(p.id) ? "Limited account data" : "General suggestion", days: signal && ["youtube", "shorts"].includes(p.id) ? `${signal.weekday} had the highest average daily views in ${signal.days} available days (${signal.averageViews.toLocaleString()} views).` : "Try two different weekdays and compare results over several weeks.", window: p.id === "youtube" ? "Test 17:00 to 19:00" : p.id === "shorts" ? "Test 18:00 to 20:00" : p.id === "tiktok" ? "Test 19:00 to 21:00" : "Test 12:00 to 14:00", note: "An experimental starting point, not a guaranteed best time." })) };
}
