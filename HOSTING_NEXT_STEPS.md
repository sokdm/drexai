# Finish hosting drexai.onrender.com

The website/API are deployed. Queue workers are separate Render services; deploying the web service alone does not run them. A code push cannot edit private Render environment settings.

## 1. Correct the web service environment

In Render → Drex web service → Environment, replace placeholders with:

```env
APP_URL=https://drexai.onrender.com
CLIENT_ORIGIN=https://drexai.onrender.com
GOOGLE_OAUTH_REDIRECT_URI=https://drexai.onrender.com/api/youtube/oauth/callback
```

Use your real private session secret, not `REPLACE_WITH...`. Keep `SERVE_FRONTEND=true`, leave `VITE_API_URL` unset, and keep admin bootstrap disabled now that your administrator exists. Do not reset the encryption key used for existing Google credentials.

## 2. Connect your existing Redis

Open your existing Render Key Value instance. Confirm it and the Drex web service are in the same region and workspace. Set its eviction policy to `noeviction`.

Copy its **Internal Connection URL** from Connect. Replace the `REDIS_URL` placeholder on the Drex web service with that full URL. The URL supplied earlier has been saved in your ignored local `.env.render.private`, but confirm it is still the current URL in Render rather than trusting an old copy.

This internal hostname works on Render's private network, not from your laptop. Do not put it in `APP_URL`, `CLIENT_ORIGIN` or frontend variables.

## 3. Create image and video workers

For each entry below, choose Render **New → Background Worker**, select `sokdm/drexai`, branch main, leave Root Directory empty, choose the same region as Redis, and review the paid plan before creating it.

Build command for both:

```sh
npm ci --include=dev --include=optional && npm run build --workspace shared && npm run build --workspace backend
```

| Name | Start command |
| --- | --- |
| drex-image-worker | `npm run worker:image --workspace backend` |
| drex-video-worker | `npm run worker:video --workspace backend` |

**Important:** Render does not inherit web-service environment variables into a new Background Worker. In the worker's Environment page, link the existing private environment group or add the variables directly. A log saying `MONGODB_URI is not set` means this setup is incomplete even if Render labels the service Live.

Both workers need the same `MONGODB_URI`, real `REDIS_URL`, Gemini settings, private R2 settings, `TOKEN_ENCRYPTION_KEY` and provider controls as the web service. Use your shared private environment group or copy values directly in Render. Never copy admin bootstrap credentials into workers. Wait for the logs to say the worker is listening.

On the web service set `IMAGE_QUEUE_ENABLED=true` (currently controls both the standalone image and video queues). Redeploy. Image/video submission checks for Redis and a matching worker before reserving credits. If deployment is incomplete it returns an actionable queue error rather than leaving a charge for an unsubmitted job.

## 4. Create the Studio worker

Create another Background Worker with the same build command and shared environment. Start command:

```sh
npm run worker:studio --workspace backend
```

Set `STUDIO_QUEUE_ENABLED=true` on both the web service and Studio worker. It also needs Gemini, private R2 and MongoDB. Wait for `Drex Studio worker ready`. Studio's readiness notice should then stop reporting the worker missing.

## 5. Create rendering and creative workers

Use the same background-worker build command, region and shared private environment. Give these services sufficient memory and temporary disk for FFmpeg media processing.

| Name | Start command | Additional configuration |
| --- | --- | --- |
| drex-render-worker | `npm run worker:render --workspace backend` | `RENDER_QUEUE_ENABLED=true` on worker and API |
| drex-creative-worker | `npm run worker:creative --workspace backend` | Active admin pricing for short clip analysis; Gemini for analysis |

These two use MongoDB queues, not Redis. Both need MongoDB and private R2. Bundled FFmpeg/FFprobe are included. Talking avatars additionally require real `HEYGEN_API_KEY` and authorized presenter/voice IDs; remove the placeholder key until obtained. Do not claim avatar rendering is enabled with a placeholder.

## 6. R2 and Google

In Cloudflare R2 bucket CORS allow `https://drexai.onrender.com`, PUT and Content-Type for long-video source uploads. Keep storage private. Read/write R2 credentials must be shared with processing workers.

In Google Cloud, add the exact authorized OAuth redirect:

```text
https://drexai.onrender.com/api/youtube/oauth/callback
```

Set the homepage to `https://drexai.onrender.com`, privacy URL to `/privacy`, and terms URL to `/terms`. Complete production consent/verification requirements and reconnect the channel in Drex. A localhost callback or placeholder host cannot complete production authorization.

## 7. Verify without risking a large paid job

Check `https://drexai.onrender.com/api/health`, then open the dashboard and wallet. Both must show the same available credits. The former hardcoded home balance is replaced with the real wallet; balance refreshes on notifications, focus and a timer, and has a manual Refresh balance button.

Generate a short script first. Scripts use Gemini directly and do **not** require Redis. The provider request has a 90-second timeout; the UI displays errors and stops loading. Failed generation releases its reservation. If a browser request times out, check Projects before retrying because the response may have been interrupted after persistence.

Then try one image, one short video and one small MP4 export. Provider billing/model access and active pricing are still required. Existing queued jobs created before Redis was configured may need inspection in Admin → Jobs; cancel eligible unwanted waiting jobs there to release their reservation. Do not automatically resubmit unknown provider work or credit the wallet a second time to mask a stale display.

When ready for test purchases, Flutterwave webhook URL:

```text
https://drexai.onrender.com/api/wallet/flutterwave/webhook
```

Use matching test keys and the same webhook secret in Flutterwave and Render. Live money remains disabled.
