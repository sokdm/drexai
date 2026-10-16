# Architecture

## Frontend

The frontend is a React + Vite + TypeScript application in `frontend`. It uses React Router for public, auth, and dashboard routes. Tailwind CSS provides the design system. TanStack Query is initialized for future API data fetching.

## Backend

The backend is an Express + TypeScript service in `backend`. It validates environment variables, connects to MongoDB Atlas when `MONGODB_URI` is available, exposes `/api/health`, and initializes Socket.IO for later real-time production updates.

## Shared

The `shared` package contains brand configuration, credit package data, and Zod validation schemas. The brand name `Drex` is centralized here so it can be changed later from one place.

## Future Worker

A separate worker package can be added later for long-running AI generation, video rendering, publishing jobs, and scheduled automation.

## Payments And Credits

Phase 3 stores credit packages, wallets, payments, ledger entries, reservations, and generation pricing rules in MongoDB. Flutterwave remains locked to test mode. Wallet credits are added only after backend transaction verification and idempotent ledger writes.
