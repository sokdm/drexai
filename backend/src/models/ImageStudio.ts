import { Schema, model } from "mongoose";
export const ImageStudio = model("ImageStudio", new Schema({ userId: { type: Schema.Types.ObjectId, required: true, unique: true }, state: { type: Schema.Types.Mixed, default: {} } }, { timestamps: true }));
