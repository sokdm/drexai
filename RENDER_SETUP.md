> Email update: existing SMTP is the preferred mail transport for account OTP, welcome messages, admin OTP and support updates. Configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and EMAIL_FROM. Resend is optional fallback only when SMTP is absent. SMTP support delivery with an uncertain outcome is held for manual review to avoid automatic duplicate messages.

# Render setup, one step at a time

No cloud services have been created and no credentials have been changed. `render.yaml` is a deployment template to review when the GitHub repository is connected. It includes one web service, Redis and five dedicated workers, which incur hosting charges. Remove optional workers before deployment if their features are not being enabled. Rendering and hour-long video analysis need sufficient RAM and temporary disk space; load-test before increasing concurrency.

## 1. Repository and application hosting

The blueprint assumes the repository root contains `package.json`, `frontend`, `backend` and `shared`. If the GitHub repository instead contains the `drex` directory, add `rootDir: drex` to each Node service and choose `drex/render.yaml` as the blueprint path. We will verify this when the repository is supplied.

The backend can now serve the built frontend with `SERVE_FRONTEND=true`. This puts the dashboard, API, admin cookies and Socket.IO on one origin. No separate frontend service is required. Production API calls default to the same origin. Do not set `VITE_API_URL` to localhost in Render.

## 2. Private environment group

Create a Render environment group called `drex-private`. Enter real values privately in Render, never in GitHub or frontend variables:

```text
MONGODB_URI=<your existing MongoDB Atlas URI>
APP_URL=https://<your-web-service>.onrender.com
CLIENT_ORIGIN=https://<your-web-service>.onrender.com
SESSION_SECRET=<a long random secret>
TOKEN_ENCRYPTION_KEY=<your existing encryption key>
GEMINI_API_KEY=<your Gemini key>
R2_ACCOUNT_ID=<Cloudflare account ID>
R2_ACCESS_KEY_ID=<R2 access key>
R2_SECRET_ACCESS_KEY=<R2 secret>
R2_BUCKET=<private bucket name>
SMTP_HOST=<your mail server>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<SMTP username>
SMTP_PASS=<SMTP password>
EMAIL_FROM=Drex <security@your-verified-domain>
ADMIN_LOGIN_METHOD=email
```

Retain the existing `TOKEN_ENCRYPTION_KEY` when migrating existing OAuth records. Changing it prevents decryption of those records. MongoDB must support transactions (Atlas/replica set). Allow the Render services to reach Atlas through your chosen network rules.

For existing YouTube/payment integrations also copy their existing private server variables (`YOUTUBE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, Flutterwave variables) and set `GOOGLE_OAUTH_REDIRECT_URI=https://<your-web-service>.onrender.com/api/youtube/oauth/callback`. Register that exact callback in Google Cloud. Keep existing model settings if you customized them.

## 3. Redis

The blueprint provisions Render Key Value with `noeviction`, no public inbound IPs and automatic internal connection URLs for the API and Redis-backed workers. All services use the same region. No manual Redis password is committed. Its internal URL works from Render, not your local laptop.

If creating services manually, create Key Value, select `noeviction`, then place its **internal connection URL** in `REDIS_URL` on the API, Studio, image and video workers. Enable `IMAGE_QUEUE_ENABLED=true` and `STUDIO_QUEUE_ENABLED=true` on the API. Do not enable these flags locally without reachable Redis.

Image/video/Studio jobs use Redis/BullMQ. FFmpeg exports and creative jobs use MongoDB-backed queues, so Redis alone does not start those features.

## 4. R2

Use a private bucket and bucket-scoped object read/write credentials. Add R2 configuration to the shared group before starting Studio/render/creative workers. For direct short-video uploads configure bucket CORS for the exact frontend origin, PUT, and Content-Type. Local testing additionally needs `http://localhost:5173` as an allowed origin. Keep `R2_PUBLIC_BASE_URL` unset for private media. Signed links provide temporary access.

## 5. Administrator and email

Add these only to the **web service**, not the shared worker group:

```text
ADMIN_BOOTSTRAP_ENABLED=true
ADMIN_BOOTSTRAP_EMAIL=<an unused administrator email>
ADMIN_BOOTSTRAP_PASSWORD=<your private password, at least 14 characters>
```

Alternatively use `ADMIN_BOOTSTRAP_PASSWORD_HASH` from the credentials utility instead of the plaintext bootstrap variable. Bootstrap stores only an Argon2id hash. After one successful provisioning startup, set bootstrap enabled false and remove its email/password variables. The saved administrator remains in MongoDB. Existing admins are never replaced or silently promoted from customer accounts.

Email sign-in uses the configured SMTP account and an authorized EMAIL_FROM sender. After entering email/password, enter the single-use code from your inbox. There is no fake successful email delivery when Resend is absent.

The `pchstr must be a non-empty string` crash is guarded: missing, empty or malformed stored hashes now return a controlled invalid-credentials response. This does not manufacture a password for a damaged legacy account. Such an account needs an intentional operator credential repair; bootstrap does not overwrite it. The database diagnostic must never print stored password hashes or OAuth credentials.

## 6. Workers and verification

The blueprint defines Studio, image, video, rendering and creative workers with their existing npm start commands. FFmpeg/FFprobe use the bundled binaries unless explicit paths are configured. Set active admin pricing rules for new paid features before allowing jobs. Optional avatar rendering additionally needs `HEYGEN_API_KEY` and an authorized `AVATAR_PRESENTERS_JSON` catalog as described in `CREATOR_UPGRADES.md`.

Run in Render's web-service shell:

```text
npm run setup:check --workspace backend
```

The check prints configuration presence, Redis PING/PONG and eviction policy when the provider permits inspection. It never prints secrets and does not submit paid jobs. Other provider configuration is not called verified just because variables exist.

Verify `/api/health`, admin email OTP, worker heartbeats, one small generation and one MP4 export before attempting an hour-long source. SMTP delivery, R2 access, provider billing and YouTube scopes must each be checked with their real configured accounts.

References: [Render Key Value](https://render.com/docs/key-value), [Blueprint specification](https://render.com/docs/blueprint-spec), [BullMQ connection requirements](https://docs.bullmq.io/guide/connections).
