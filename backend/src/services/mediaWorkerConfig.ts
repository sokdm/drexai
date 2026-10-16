export function assertMediaWorkerConfig(settings: Record<string, unknown>) {
  const required = ["MONGODB_URI", "REDIS_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
  const missing = required.filter(key => typeof settings[key] !== "string" || !(settings[key] as string).trim() || (settings[key] as string).startsWith("REPLACE_"));
  if (!settings.GEMINI_API_KEY && !settings.OPENROUTER_API_KEY) missing.push("OPENROUTER_API_KEY or GEMINI_API_KEY");
  if (missing.length) throw new Error("Media worker setup incomplete. Add these variables to this Background Worker in Render: " + missing.join(", ") + ". Web service variables are not inherited automatically.");
}
