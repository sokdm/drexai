import mongoose from "mongoose";
import { CreditReservation } from "../models/CreditReservation.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { ensureWallet } from "./wallet.js";

// Each output settles once against the single user-approved production reserve.
export async function settleStudioStep(reservationId: string, stepKey: string, credits: number, metadata: Record<string, unknown> = {}) {
  if (!Number.isSafeInteger(credits) || credits < 0) throw new Error("Invalid step credits");
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const idempotencyKey = `studio:${reservationId}:${stepKey}`;
      if (await LedgerEntry.exists({ idempotencyKey }).session(session)) return;
      const reservation = await CreditReservation.findById(reservationId).session(session);
      if (!reservation || reservation.status !== "reserved") throw new Error("Production reserve is closed");
      const remaining = reservation.remainingCredits ?? reservation.credits;
      if (remaining < credits) throw new Error("Approved spending limit reached");
      const wallet = await ensureWallet(String(reservation.userId), session);
      wallet.reservedCredits -= credits;
      wallet.spentCredits += credits;
      reservation.remainingCredits = remaining - credits;
      await wallet.save({ session });
      await reservation.save({ session });
      await LedgerEntry.create([{ userId: reservation.userId, walletId: wallet._id, type: "settlement", amountCredits: -credits, balanceAfter: wallet.availableCredits, idempotencyKey, metadata: { ...metadata, reservationId, stepKey } }], { session });
    });
  } finally { await session.endSession(); }
}

export async function closeStudioReserve(reservationId: string, reason: string, outerSession?: mongoose.ClientSession) {
  const session = outerSession ?? await mongoose.startSession();
  const close = async () => {
      const reservation = await CreditReservation.findById(reservationId).session(session);
      if (!reservation || reservation.status !== "reserved") return;
      const remaining = reservation.remainingCredits ?? reservation.credits;
      const wallet = await ensureWallet(String(reservation.userId), session);
      wallet.availableCredits += remaining;
      wallet.reservedCredits -= remaining;
      reservation.remainingCredits = 0;
      reservation.status = remaining === reservation.credits ? "released" : "settled";
      await wallet.save({ session });
      await reservation.save({ session });
      await LedgerEntry.create([{ userId: reservation.userId, walletId: wallet._id, type: "release", amountCredits: remaining, balanceAfter: wallet.availableCredits, idempotencyKey: `studio-close:${reservationId}`, metadata: { reason, reservationId } }], { session });
  };
  try {
    if (outerSession) await close();
    else await session.withTransaction(close);
  } finally { if (!outerSession) await session.endSession(); }
}
