import argon2 from "argon2";
export async function verifyPassword(hash: unknown, password: string): Promise<boolean> {
  if (typeof hash !== "string" || !/^\$argon2(?:id|i|d)\$/.test(hash)) return false;
  try { return await argon2.verify(hash, password); } catch { return false; }
}
