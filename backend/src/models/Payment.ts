import { Schema, model } from "mongoose";

const paymentSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  packageId: { type: Schema.Types.ObjectId, ref: "CreditPackage", required: true },
  txRef: { type: String, required: true, unique: true },
  flutterwaveId: String,
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  credits: { type: Number, required: true },
  status: { type: String, enum: ["pending", "successful", "failed", "cancelled", "rejected"], default: "pending" },
  checkoutUrl: String,
  receipt: { type: Schema.Types.Mixed, default: {} },
  audit: [{ at: { type: Date, default: Date.now }, event: String, details: Schema.Types.Mixed }]
}, { timestamps: true });

export const Payment = model("Payment", paymentSchema);
