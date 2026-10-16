> Deployment: follow [DEPLOYMENT.md](DEPLOYMENT.md) for the current GitHub/Render, SMTP, Google production OAuth, administrator and Flutterwave test-webhook setup. Real credentials belong only in ignored local environment files or Render private settings.

# Drex

Drex is a Phase 1 commercial SaaS foundation for YouTube automation, AI content research, creative generation, and future automated video production.

## What is included

- React + Vite + TypeScript frontend
- Tailwind CSS design system with dark and light themes
- Landing page, authentication page designs, and authenticated dashboard shell
- React Router routes for every dashboard menu item
- TanStack Query setup
- Node.js + Express + TypeScript backend
- MongoDB Atlas connection hook with `MONGODB_URI`
- Health-check endpoint at `/api/health`
- Socket.IO foundation for later real-time workflows
- Shared brand, pricing, and validation utilities
- SMTP-backed email with development terminal fallback
- Pay-as-you-go credit wallet with Flutterwave test-mode checkout

## Run locally

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`

Backend: `http://localhost:4000/api/health`

## Environment variables to provide after Phase 3

Create `drex/.env` from `.env.example` and provide:

- `MONGODB_URI`
- `SESSION_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- `APP_URL`
- `FLUTTERWAVE_MODE=test`
- `FLW_PUBLIC_KEY`
- `FLW_SECRET_KEY`
- `FLW_WEBHOOK_HASH`
- `PAYMENT_CURRENCY=USD`

Live Flutterwave mode is intentionally disabled in Phase 3.

## Build

```bash
npm run build
```

## Scope

This stops after Phase 1. It does not implement payments, live authentication, YouTube API integration, AI generation, admin functionality, or background workers.
