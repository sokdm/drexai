import { type ReactNode } from "react";
export function adminValue(value: any, field: string): ReactNode {
 if (value == null || value === "") {
  if (field === "readAt") return "Unread";
  if (field === "approvedAt") return "Awaiting approval";
  if (field === "error") return "No error recorded";
  if (field === "promotion") return "No promotion";
  if (field === "defaultFor") return "No default";
  if (field === "enabled") return "Default: enabled";
  if (["maxConcurrent", "maxDailyJobs", "maxJobCostUsd"].includes(field)) return "No model override";
  if (field === "verifiedCostUsd" || field === "costUsd") return "Not reported";
  if (field === "estimatedCostUsd") return "Not estimated";
  return "Not set";
 }
 if (typeof value === "boolean") return value ? "Yes" : "No";
 if (/At$/.test(field)) { const date = new Date(value); if (!Number.isNaN(date.getTime())) return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
 if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: field.toLowerCase().includes("usd") ? 6 : 2 });
 return ["status", "role"].includes(field) ? String(value).replaceAll("_", " ") : String(value);
}
