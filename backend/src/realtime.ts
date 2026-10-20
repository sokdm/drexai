import {AdminSession} from './models/Admin.js';
import type { Server, Socket } from "socket.io";
import { Session } from "./models/Session.js";
import { User } from "./models/User.js";
import { ImageGenerationJob } from "./models/ImageGenerationJob.js";
import { hashSecret } from "./utils/crypto.js";
import { env } from "./config/env.js";
let ioRef: Server | null = null;
async function identity(socket: Socket) {
  if(socket.handshake.auth?.scope==='admin'){const raw=socket.handshake.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('drex_admin='))?.slice(11);if(!raw||typeof socket.handshake.auth?.csrf!=='string')return null;const session=await AdminSession.findOne({tokenHash:hashSecret(decodeURIComponent(raw)),revokedAt:null,expiresAt:{$gt:new Date()}});if(!session||hashSecret(socket.handshake.auth.csrf)!==session.csrfHash)return null;const admin=await User.findOne({_id:session.userId,role:'admin',status:'active'});return admin;}
  const raw = socket.handshake.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith("drex_session="))?.slice(13);
  if (!raw) return null;
  const session = await Session.findOne({ tokenHash: hashSecret(decodeURIComponent(raw)), revokedAt: null, expiresAt: { $gt: new Date() } });
  const user = session ? await User.findById(session.userId) : null;
  if (!session || !user || user.status === "suspended" || typeof socket.handshake.auth?.csrf !== "string" || hashSecret(socket.handshake.auth.csrf) !== session.csrfTokenHash) return null;
  return user;
}
export function setRealtimeServer(io: Server) {
  ioRef = io;
  io.use(async (socket, next) => { try { if (socket.handshake.headers.origin !== env.CLIENT_ORIGIN) return next(new Error("Invalid origin")); const user = await identity(socket); if (!user) return next(new Error("Authentication required")); socket.data.userId = String(user._id); socket.data.role = user.role; next(); } catch { next(new Error("Authentication required")); } });
  io.on("connection", socket => {
    socket.join(`user:${socket.data.userId}`);
    if (["admin", "support"].includes(socket.data.role)) socket.join("support-agents");
    const timer = setInterval(async () => { try { const user = await identity(socket); if (!user || user.role !== socket.data.role) socket.disconnect(true); } catch { socket.disconnect(true); } }, 30000); timer.unref(); socket.on("disconnect", () => clearInterval(timer));
    socket.on("image:watch", async (jobId: unknown) => { try { if (typeof jobId !== "string" || !/^[a-f\d]{24}$/i.test(jobId)) return; const user = await identity(socket); if (user && await ImageGenerationJob.exists({ _id: jobId, userId: user._id })) socket.join(`image-job:${jobId}`); } catch { socket.disconnect(true); } });
  });
}
export function emitImageJob(jobId: string, payload: unknown) { ioRef?.to(`image-job:${jobId}`).emit("image:status", payload); }
export function emitUserEvent(userId: string, event: string, payload: unknown) { ioRef?.to(`user:${userId}`).emit(event, payload); }
export function emitSupportEvent(userId: string, ticketId: string) { emitUserEvent(userId, "support:changed", { ticketId }); ioRef?.to("support-agents").emit("support:changed", { ticketId }); }
