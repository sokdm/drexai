import { Schema, model } from "mongoose";

const creditPackageSchema = new Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  credits: { type: Number, required: true, min: 1 },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, enum: ["USD", "NGN"], default: "USD" },
  active: { type: Boolean, default: true },
  promotion: { type: String, default: "" },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

export const CreditPackage = model("CreditPackage", creditPackageSchema);
