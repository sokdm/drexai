# Deploy Drex from GitHub to Render

Repository: `https://github.com/sokdm/drexai`.

No live services, domains, OAuth approval or payment account changes are performed by this repository alone. Review the blueprint's hosting charges before creating it. Credit deduction rules are unchanged.

## 1. Your environment files

`.env.example` is a public template with no real credentials. `.env.render.private` is an **ignored local handoff** prepared with your existing values and placeholders for missing production settings. Open it locally and transfer its values into Render. Never upload it to GitHub or paste its contents into public logs. Rotate the R2 secret previously shared in chat, then update both your local file and Render.

| Variables | Source / purpose |
| --- | --- |
| `MONGODB_URI` | Existing MongoDB Atlas database; transactions require a replica set |
| `SESSION_SECRET` | Strong random application secret; replace a development default |
| `TOKEN_ENCRYPTION_KEY` | Keep the existing key when migrating existing Google credentials |
| `APP_URL`, `CLIENT_ORIGIN` | Exact HTTPS URL assigned to the Render web service |
| `SERVE_FRONTEND=true`, `NODE_ENV=production` | Serve frontend and API together |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Existing SMTP account; use port 587 with secure=false, or 465 with secure=true, as your mail provider specifies |
| `REDIS_URL` | Render Key Value internal URL; blueprint injects it automatically |
| `IMAGE_QUEUE_ENABLED`, `STUDIO_QUEUE_ENABLED`, `RENDER_QUEUE_ENABLED` | Set true on API; blueprint sets worker-specific flags |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Your private Cloudflare R2 bucket and scoped access keys |
| `GEMINI_API_KEY` | Existing Google AI key with billing/model access as required |
| `GEMINI_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_TTS_MODEL`, `VEO_MODEL` | Keep supported configured models from the existing environment/template |
| `YOUTUBE_API_KEY` | Server-side YouTube Data API key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Production OAuth web application credentials |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://YOUR-SERVICE.onrender.com/api/youtube/oauth/callback` |
| `FLUTTERWAVE_MODE=test` | Hosted application uses Flutterwave test payments for now |
| `FLW_PUBLIC_KEY`, `FLW_SECRET_KEY` | Matching Flutterwave **test** public and secret keys; public key alone is insufficient |
| `FLW_WEBHOOK_HASH` | A separate random webhook secret you choose; same value in Flutterwave settings |
| `PAYMENT_CURRENCY=USD` | Must match active package currency; NGN packages require a corresponding checkout configuration |
| `HEYGEN_API_KEY`, `AVATAR_PRESENTERS_JSON` | Optional talking-avatar provider and authorized catalog; obtain when enabling avatars |
| `ADMIN_BOOTSTRAP_ENABLED`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` | One-time initial admin provision; web service only |
| `ADMIN_LOGIN_METHOD=email` | Admin OTP through existing SMTP |

Optional: `RESEND_API_KEY` is only an email fallback if SMTP is absent. `ADMIN_BOOTSTRAP_PASSWORD_HASH` can replace the bootstrap password; do not set both. `ADMIN_TOTP_SECRET` is used only if choosing authenticator login. `FFMPEG_PATH`/`FFPROBE_PATH` can override bundled binaries. Keep `R2_PUBLIC_BASE_URL` unset for private objects. Render supplies `PORT`; don't hardcode it. Production should leave `VITE_API_URL` unset so it uses the same origin. `UPLOAD_DIR` is temporary local upload storage, not persistent cloud storage.

Your R2 bucket and SMTP credentials were successfully checked locally before this guide was prepared. The Redis hostname supplied is internal to Render and does not resolve from the local laptop. Missing keys/provider approvals are not fabricated.

## 2. Connect Render and create the private environment group

1. Sign into Render and connect the GitHub account with access to `sokdm/drexai`.
2. Create an environment group named **drex-private**. Add the shared variables from the table using your local `.env.render.private` file. Do not put one-time admin bootstrap credentials in the shared worker group.
3. For the initial service URL, use the intended web service hostname; after Render assigns the final hostname, correct `APP_URL`, `CLIENT_ORIGIN` and the Google callback and redeploy.
4. Keep all services in one region (the template uses Frankfurt). Allow the services to reach MongoDB Atlas through your selected network access rules.

## 3. Create the Blueprint

1. In Render choose **New → Blueprint**, select `sokdm/drexai`, branch `main`, and `render.yaml`.
2. Review all services and plan costs. The template creates the web service, Key Value, and Studio/image/video/render/creative background workers. Rendering and creative processing need adequate memory and scratch disk for large media.
3. The repository root contains the workspaces directly; leave Root Directory empty. Build command for the web service is `npm ci --include=dev --include=optional && npm run build`; start is `npm run start`; health path is `/api/health`.
4. The blueprint sets `SERVE_FRONTEND=true`. The web service serves both the frontend and API, keeping session/CSRF cookies on the same origin.
5. Key Value uses `noeviction` and internal connections. The blueprint injects its URL into API, Studio, image and video services. If using your already-created Key Value instead, replace the blueprint references with that service's internal URL and avoid creating a duplicate instance.
6. Use a paid web service for existing SMTP: Render Free blocks outbound ports 25, 465 and 587. Background workers also require appropriate paid plans. See [Render Free limits](https://render.com/docs/free).
7. Wait for deployment, then open `https://YOUR-SERVICE.onrender.com/api/health`. It must report a connected database. In the service shell, run `npm run setup:check --workspace backend` to check Redis connectivity without printing credentials.

## 4. Enable R2 uploads

Keep the bucket private. Allow the final site origin in R2 CORS, with PUT and Content-Type for direct source-video uploads. Use object read/write credentials scoped to this bucket. API and processing workers need the same R2 settings. Signed URLs supply temporary access; do not make the bucket public to fix a configuration error.

## 5. Initial admin sign-in

On the **web service only**, set:

```text
ADMIN_BOOTSTRAP_ENABLED=true
ADMIN_BOOTSTRAP_EMAIL=your-chosen-unused-admin-email
ADMIN_BOOTSTRAP_PASSWORD=your-private-password-at-least-14-characters
ADMIN_LOGIN_METHOD=email
```

Redeploy. The server reads these environment variables (Render variables take priority over local dotenv files), hashes the password using Argon2id and creates the admin once in MongoDB. It does not promote an existing customer email or reset an already-provisioned admin.

Open `/admin/login`, enter the chosen email/password, then enter the SMTP email OTP. After successful provisioning, set bootstrap enabled false and remove bootstrap email/password variables from Render. The saved account remains. A missing or malformed legacy password hash now returns a controlled sign-in error, not an Argon2 crash; it does not silently replace credentials.

Admin users, purchase records, packages, wallet ledgers and financial reports all use this same database. No separate financial database or fake admin credit balance is created.

## 6. Flutterwave test checkout and webhook

Keep `FLUTTERWAVE_MODE=test` and use a matching pair of TEST keys in Render. You supplied a public test key; ensure the corresponding secret is present. The app currently rejects live keys/mode intentionally.

In the Flutterwave **test** dashboard configure:

```text
Webhook URL:
https://YOUR-SERVICE.onrender.com/api/wallet/flutterwave/webhook

Customer checkout redirect (generated automatically by Drex):
https://YOUR-SERVICE.onrender.com/dashboard/credit-wallet
```

Choose a separate random webhook secret and put the exact same value in Flutterwave's secret-hash field and `FLW_WEBHOOK_HASH` on Render. The existing v3 integration validates the `verif-hash` header, re-verifies the transaction with Flutterwave, checks reference/currency/amount, and credits the stored package snapshot once. Returning from checkout alone never proves payment. Duplicate callbacks cannot add credits twice. A verified purchase can recover after an interruption between wallet crediting and saving payment status.

Test one successful test payment, a failed/cancelled payment, and webhook redelivery. Confirm the wallet purchase ledger, payment history, admin Finance report and admin user's wallet details agree. Test-mode purchases are simulated funds; do not treat them as live business revenue. Switching to real money is a separate explicit change with matching live credentials and provider approval.

## 7. Move Google/YouTube from testing to production

1. Use a separate production Google Cloud project where practical, keeping the development OAuth client separate. Enable YouTube Data API v3 and YouTube Analytics API in the production project.
2. Create an OAuth **Web application** client. Add this exact authorized redirect URI (no trailing slash): `https://YOUR-SERVICE.onrender.com/api/youtube/oauth/callback`. If entering JavaScript origins, use the site origin only, without paths.
3. Configure branding/homepage, support and developer contact emails, privacy URL `/privacy`, and terms URL `/terms`. Review the published policy text and add your real operator/support identity before requesting verification. A verified custom domain is preferable for production branding/domain verification.
4. In Google Auth Platform's Audience area, publish the external app to production. Submit brand/sensitive-scope verification when Google requests it. Publishing status is not the same as approval; don't promise users unrestricted access until verification succeeds.
5. Drex uses `youtube.readonly` and `yt-analytics.readonly` for connected research. It asks for `youtube.upload` only when enabling uploads and `youtube.force-ssl` when enabling comment posting. Declare and justify the actual requested scopes; do not broaden them just for deployment.
6. Put the production client ID/secret and callback in Render. API keys stay server-side. Restrict the public-data key to the necessary APIs, with compatible server-side restrictions. Do not use a browser-referrer restriction on a server-only key.
7. Reconnect YouTube through Drex to obtain tokens for the production client. Existing testing refresh tokens are not magically upgraded; external apps in Testing can receive refresh tokens expiring after seven days. Preserve the existing encryption key for any credentials you retain.
8. Test channel connection, authorized analytics, comments, and one explicitly confirmed upload. Check current YouTube project-specific limits, quota and provider responses; a code deployment or consent-screen switch cannot grant platform approval.

References: [Google production policies](https://developers.google.com/identity/protocols/oauth2/policies), [OAuth token expiry](https://developers.google.com/identity/protocols/oauth2/), [YouTube upload API](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [Flutterwave webhooks](https://developer.flutterwave.com/v3.0.0/docs/webhooks).

## 8. Activate optional features and final smoke test

Create/review active admin pricing rules for clip analysis, avatars and any newly enabled provider models. No automatic deduction-by-duration redesign was added in this deployment work. Short clips require the creative worker plus Gemini; avatars additionally require actual authorized HeyGen presenter/voice IDs. Unsupported TikTok/Meta direct posting remains unavailable.

Before inviting users: check signup/email OTP, admin OTP, test payment and webhook crediting, queue heartbeats, one small image/video job, save/resume of an edit, and a real R2 MP4 export. Then test the long-video path at increasing sizes. Provider keys, configured URLs and passing mocked tests alone do not prove a live end-to-end deployment.
