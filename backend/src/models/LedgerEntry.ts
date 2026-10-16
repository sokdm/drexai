import { Schema, model } from "mongoose";

const ledgerEntrySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  walletId: { type: Schema.Types.ObjectId, ref: "Wallet", required: true },
  type: { type: String, required: true, enum: ["adjustment", "purchase", "reservation", "settlement", "release", "refund", "promotion", "provider_cost"] },
  amountCredits: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  idempotencyKey: { type: String, required: true, unique: true },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

export const LedgerEntry = model("LedgerEntry", ledgerEntrySchema);
