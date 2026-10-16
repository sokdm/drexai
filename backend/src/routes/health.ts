import { Router } from "express";
import mongoose from "mongoose";
import { brand } from "@drex/shared";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ ok: true, service: brand.name, database: mongoose.connection.readyState === 1 ? "connected" : "offline" });
});
