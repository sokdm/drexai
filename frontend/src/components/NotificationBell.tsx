import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useRealtime } from "../lib/realtime";
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const load = () => { void api<any>("/api/notifications").then(d => setUnread(d.unread || 0)).catch(() => {}); };
  useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer); }, []);
  useRealtime({ "notifications:changed": load, connect: load });
  return <Link to="/dashboard/notifications" aria-label="Notifications" title={`${unread} unread notifications`} className="notification-bell"><Bell size={19} />{unread > 0 && <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}</Link>;
}
