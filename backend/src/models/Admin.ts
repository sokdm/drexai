import { Schema, model } from "mongoose";
export const AdminBootstrap = model("AdminBootstrap", new Schema({ _id: String, email: String, completedAt: Date }));
export const AdminSession = model("AdminSession", new Schema({ userId: { type: Schema.Types.ObjectId, required: true }, tokenHash: { type: String, unique: true }, csrfHash: String, expiresAt: { type: Date, index: { expires: 0 } }, revokedAt: Date }, { timestamps: true }));
export const AdminAudit = model("AdminAudit", new Schema({ actorId: Schema.Types.ObjectId, action: String, target: String, reason: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed, requestId: String }, { timestamps: true }));
export const PlatformControl = model("PlatformControl", new Schema({ _id: String, maintenance: { type: Boolean, default: false }, message: { type: String, default: "We are making improvements. Please check back shortly." }, features: { type: Schema.Types.Mixed, default: {} } }, { timestamps: true }));
export const ProviderControl = model("ProviderControl", new Schema({ provider: String, model: { type: String, unique: true }, enabled: { type: Boolean, default: true }, defaultFor: String, maxConcurrent: { type: Number, default: 2 }, maxDailyJobs: { type: Number, default: 100 }, maxJobCostUsd: { type: Number, default: 10 } }, { timestamps: true }));
export const ProviderLease = model("ProviderLease", new Schema({ provider: String, model: String, expiresAt: { type: Date, index: { expires: 0 } } }, { timestamps: true }));
export const ProviderDaily = model("ProviderDaily", new Schema({ _id: String, count: { type: Number, default: 0 } }));
export const ApprovedQuote = model("ApprovedQuote", new Schema({ userId: Schema.Types.ObjectId, token: { type: String, unique: true }, fingerprint: String, quote: Schema.Types.Mixed, expiresAt: { type: Date, index: { expires: 0 } } }, { timestamps: true }));

export const AdminLoginCode = model("AdminLoginCode", new Schema({ _id: String, userId: Schema.Types.ObjectId, codeHash: String, attempts: { type: Number, default: 0 }, expiresAt: { type: Date, index: { expires: 0 } }, consumedAt: Date, delivered: { type: Boolean, default: false } }, { timestamps: true }));
