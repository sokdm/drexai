import { Schema, model } from "mongoose";

const creditReservationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  quote: { type: Schema.Types.Mixed, required: true },
  credits: { type: Number, required: true },
  remainingCredits: Number,
  status: { type: String, enum: ["quoted", "reserved", "settled", "released", "refunded"], default: "quoted" },
  idempotencyKey: { type: String, required: true, unique: true },
  providerCostUsd: Number,
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

export const CreditReservation = model("CreditReservation", creditReservationSchema);
