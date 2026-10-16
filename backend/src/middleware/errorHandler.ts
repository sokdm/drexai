import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);
  if (error?.name === "ZodError") {
    return res.status(400).json({ error: error.errors?.[0]?.message ?? "Invalid request" });
  }
  res.status(error?.statusCode ?? 500).json({ error: error?.message ?? "Internal server error" });
};
