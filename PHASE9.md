# Phase 9: AI Studio

Phase 9 orchestrates the existing image, speech, video, storage, and wallet services. It does not implement Phase 10 manual editing or final MP4 export. The rough cut is a browser-playable timeline with native Veo dialogue and optional separate off-screen narration, sequential clips, trims, hard cuts, and still-image holds.

## Use locally

Open an approved script from Projects, choose Continue in AI Studio, prepare an estimate, and explicitly approve a spending limit. Every feature workspace has an X and a workspace switcher. My Niches includes 36 editable starter ideas, category/format filters, and custom niches.

The frontend remains usable while production infrastructure is unconfigured. No fake generation is substituted. Redis, private R2 storage, verified pricing, and an online Studio worker are required before approving production.

```powershell
npm run build
npm run start
npm run dev --workspace frontend
```

## Enable production later

Add these server-only values to `backend/.env` (or the existing root `.env`):

```dotenv
MONGODB_URI=<Atlas replica-set connection>
GEMINI_API_KEY=<provider key>
REDIS_URL=<redis:// or rediss:// connection>
STUDIO_QUEUE_ENABLED=true
R2_ACCOUNT_ID=<account>
R2_ACCESS_KEY_ID=<bucket-scoped key>
R2_SECRET_ACCESS_KEY=<secret>
R2_BUCKET=<private media bucket>
```

Leave public bucket access disabled; Studio issues ownership-checked signed URLs. `R2_PUBLIC_BASE_URL` is not needed. Existing image/video queue flags do not enable the Studio queue.

After configuring storage, Redis, and pricing:

```powershell
npm run worker:studio
```

Run the API and worker with the same environment and MongoDB. The worker records a Redis heartbeat, uses concurrency 2, and reconciles approved MongoDB records back into BullMQ. The browser is not responsible for execution.

## Pricing configuration

No permanent provider prices are invented or enabled. Configure `GenerationPriceRule` records through trusted server-side administration after verifying provider costs. Each record needs `feature`, `provider`, `model`, `unit`, positive `creditsPerUnit`, positive `providerCostUsd` per unit, `desiredMarginPct`, and `active: true`.

| Feature | Provider | Unit |
| --- | --- | --- |
| text_to_image | gemini | image:1K, image:2K, or image:4K |
| image_to_video | google-veo | second:720p, second:1080p, or second:4K |
| voice_generation | gemini | character |

Only configure model/resolution combinations actually supported by the provider. Include overhead in the cost basis. Speech character pricing is a conservative estimate: validate its relationship to the provider's actual billed usage before enabling. Provider usage metadata and the estimated cost basis are recorded separately; they are not claimed as an invoice.

Studio rejects rules that cannot meet their configured margin at the cheapest active USD credit package. Multiple quality rules can coexist. Ten-minute plans freeze their configured prices. No public pricing-edit endpoint is exposed.

## Reliability and billing

- Approval and maximum-budget reservation are one MongoDB transaction.
- Legacy public reservation/settlement/release endpoints are disabled; only generation services may mutate reserves.
- Each output has a deterministic step key, storage key, unique asset key, and idempotent settlement ledger entry.
- A worker lease prevents concurrent execution. Saved Veo operation IDs are polled again after interruption instead of submitting another operation.
- Ambiguous image/speech submissions are marked `needs_review`; a new explicitly approved regeneration plan is required when no stored result can be recovered.
- Recoverable failures preserve completed outputs and hold unspent credits. Retry resumes failed work; cancellation releases unused credits, not already completed work. In-flight provider operations may finish before cancellation takes effect.
- Regeneration reuses unaffected outputs without charging for them again. Replacing an image or narration output replans dependent scene clips. Native dialogue regeneration always uses a new approved quote.
- Native dialogue is divided into short ordered segments and each completed audiovisual segment remains whole. Actual off-screen WAV duration drives ambient clip coverage. `maxClipsPerScene` caps paid requests; additional narration is covered with the scene's still image.
- Persistent events are streamed through authenticated SSE, with polling fallback and reconnection. Preview links refresh periodically.

## Verification

```powershell
npm run build --workspace backend
npm run test:studio --workspace backend
npm run typecheck --workspace frontend
npm run test:workspaces --workspace frontend
```

Backend tests use an isolated in-memory MongoDB replica set and injected provider/storage fixtures. Browser tests use installed Chrome, a frontend on port 5173, and intercepted APIs. Neither suite creates paid generations or modifies the configured Atlas database.

Before launch, run a real approved multi-scene production with Redis, private R2, verified rates, and provider access, then test worker termination/restart, real SSE reconnection, and signed-media playback. These live checks cannot run while infrastructure is deferred.

Provider references: [Gemini images](https://ai.google.dev/gemini-api/docs/image-generation), [speech](https://ai.google.dev/gemini-api/docs/speech-generation), [Veo](https://ai.google.dev/gemini-api/docs/veo), [BullMQ stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs).

## Native audiovisual correction

See [Phases 5, 7, 8, 9 and 10 correction](docs/NATIVE_AUDIO.md). Speaking scenes use Veo native speech with video, not TTS dialogue. Real persisted events report soundtrack detection and required human review. Old unsubmitted dialogue plans require a fresh native-audio quote; completed assets remain available.
