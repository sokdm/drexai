import { Schema, model } from "mongoose";
const schema = new Schema({ userId: { type: Schema.Types.ObjectId, required: true, index: true }, eventKey: { type: String, required: true, unique: true }, type: { type: String, required: true }, title: String, content: String, href: String, readAt: Date }, { timestamps: true });
schema.index({ userId: 1, readAt: 1, createdAt: -1 });
export const Notification = model("Notification", schema);
export const NotificationCursor = model("NotificationCursor", new Schema({ _id: String, at: Date, lastId: Schema.Types.ObjectId }));
