import { API_URL } from "./api";
export async function downloadMedia(path: string, filename: string) {
 const response = await fetch(API_URL + path, { credentials: "include" });
 if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Download failed. Please try again."); }
 const blob = await response.blob();
 if (!blob.size) throw new Error("The downloaded file is empty. Please try again.");
 const url = URL.createObjectURL(blob), anchor = document.createElement("a");
 anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
 setTimeout(() => URL.revokeObjectURL(url), 60000);
}
