import { Schema, model, type InferSchemaType } from "mongoose";

const preferencesSchema = new Schema({
  appearance: { type: String, enum: ["system", "light", "dark"], default: "system" },
  emailUpdates: { type: Boolean, default: true },
  supportEmails: { type: Boolean, default: true }, generationNotifications: { type: Boolean, default: true }, marketingEmails: { type: Boolean, default: false }
}, { _id: false });

const onboardingSchema = new Schema({
  completed: { type: Boolean, default: false },
  step: { type: Number, default: 0 },
  skipped: { type: Boolean, default: false },
  completedAt: Date
}, { _id: false });

const userSchema = new Schema({
  displayName: { type: String, required: true, trim: true, maxlength: 80 },
  country: { type: String, trim: true, maxlength: 80 },
  inviteCode: { type: String, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  profilePictureUrl: String,
  adminTotpStep: { type: Number, default: -1, select: false },
  aiRestricted: { type: Boolean, default: false },
  role: { type: String, enum: ["user", "admin", "support"], default: "user" },
  status: { type: String, enum: ["pending_verification", "active", "suspended", "deletion_requested"], default: "pending_verification" },
  emailVerified: { type: Boolean, default: false },
  onboarding: { type: onboardingSchema, default: () => ({}) },
  preferences: { type: preferencesSchema, default: () => ({}) },
  termsAcceptedAt: Date,
  welcomeEmailSentAt: Date,
  lastLoginAt: Date
}, { timestamps: true });

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: string };
export const User = model("User", userSchema);
