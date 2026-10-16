import { Schema, model } from "mongoose";

const sceneSchema = new Schema({
  order: Number,
  title: String,
  sceneDescription: String,
  characters: [String],
  narration: String,
  dialogue: String,
  dialogueLines: { type: [{ speaker: String, text: String, language: String, accent: String, emotion: String, delivery: String }], default: undefined },
  dialogueLanguage: String, preferredAccent: String, emotionAndDelivery: String,
  characterActions: String, cameraPosition: String, cameraMovements: String,
  environmentalSounds: String, soundEffects: String, backgroundAmbience: String,
  estimatedDurationSeconds: Number, visibleSpeakingCharacters: Boolean, offscreenNarration: Boolean,
  imagePrompt: String,
  videoMotionPrompt: String,
  cameraDirection: String,
  estimatedNarrationTiming: String,
  audioSuggestions: String,
  transitionSuggestions: String,
  approved: { type: Boolean, default: false }
}, { _id: true });

const projectVersionSchema = new Schema({
  label: String,
  scenes: [sceneSchema],
  savedAt: { type: Date, default: Date.now }
}, { _id: true });

const aiProjectSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  nicheId: { type: Schema.Types.ObjectId, ref: "Niche" },
  title: { type: String, required: true },
  storyConcept: String,
  summary: String,
  type: String,
  language: String,
  targetDuration: String,
  visualStyle: String,
  selectedVisualStyle: String,
  characters: [{ type: Schema.Types.ObjectId, ref: "CharacterProfile" }],
  scenes: [sceneSchema],
  prompts: { type: Schema.Types.Mixed, default: {} },
  approvedAt: Date,
  aiStudioReadyAt: Date,
  latestProductionId: { type: Schema.Types.ObjectId },
  latestEditId: { type: Schema.Types.ObjectId },
  finalExportId: { type: Schema.Types.ObjectId },
  productionTimeline: { type: [Schema.Types.Mixed], default: [] },
  versions: [projectVersionSchema]
}, { timestamps: true });

export const AIProject = model("AIProject", aiProjectSchema);
