import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDatabase() {
  if (!env.MONGODB_URI) {
    console.warn("MONGODB_URI is not set; server starts without a database connection.");
    return;
  }
  await mongoose.connect(env.MONGODB_URI);
  await cleanupLegacyIndexes();
}

async function cleanupLegacyIndexes() {
  const collection = mongoose.connection.collection("sessions");
  const indexes = await collection.indexes();
  const legacyIndexes = ["token_hash_1", "csrf_token_hash_1"];
  for (const name of legacyIndexes) {
    if (indexes.some((index) => index.name === name)) {
      await collection.dropIndex(name);
      console.warn(`Dropped legacy sessions index: ${name}`);
    }
  }
}
