import { API_URL } from "./api";
export async function adminApi<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const csrf = decodeURIComponent(document.cookie.split("; ").find(v => v.startsWith("drex_admin_csrf="))?.split("=")[1] || "");
  const target = path.replace(/^\/api\/support/, "/api/admin/support").replace(/^\/api\/feedback/, "/api/admin/feedback");
  const response = await fetch(API_URL + target, { ...options, credentials: "include", headers: { "Content-Type": "application/json", "x-admin-csrf": csrf, ...options.headers } });
  const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Admin request failed"); return data;
}
