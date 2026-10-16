import { Schema, model } from "mongoose";

const walletSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  availableCredits: { type: Number, default: 0 },
  reservedCredits: { type: Number, default: 0 },
  purchasedCredits: { type: Number, default: 0 },
  spentCredits: { type: Number, default: 0 },
  refundedCredits: { type: Number, default: 0 },
  promotionalCredits: { type: Number, default: 0 }
}, { timestamps: true });

export const Wallet = model("Wallet", walletSchema);
