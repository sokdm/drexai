import { Schema, model } from "mongoose";

const paymentSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  packageId: { type: Schema.Types.ObjectId, ref: "CreditPackage", required: true },
  txRef: { type: String, required: true, unique: true },
  // Keep legacy databases with a unique reference_1 index compatible with txRef checkouts.
  reference: { type: String, immutable: true, default: function(this: any) { return this.txRef; } },
  // Persist the legacy id field; do not rely on Mongoose's virtual id getter.
  id: { type: String, immutable: true, default: function(this: any) { return String(this._id); } },
  flutterwaveId: String,
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  credits: { type: Number, required: true },
  status: { type: String, enum: ["pending", "successful", "failed", "cancelled", "rejected"], default: "pending" },
  checkoutUrl: String,
  receipt: { type: Schema.Types.Mixed, default: {} },
  audit: [{ at: { type: Date, default: Date.now }, event: String, details: Schema.Types.Mixed }]
}, { timestamps: true, id: false });

paymentSchema.pre("validate", function() { if(this.isNew){this.reference=this.txRef;this.id=String(this._id);} });

export const Payment = model("Payment", paymentSchema);
