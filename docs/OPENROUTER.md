# OpenRouter gateway migration

This extends the existing backend and admin Providers page. MongoDB projects/scenes, Redis queues, Studio events, operation recovery, wallet reservations, R2 storage, YouTube/Google OAuth, Flutterwave and FFmpeg remain in place.

## Render setup

1. Deploy the latest commit to the web service and image, video, Studio and creative workers.
2. Add `OPENROUTER_API_KEY` privately to the web service and those workers, preferably through the existing `drex-private` Render environment group. Variables on the web service are not automatically inherited by workers. Never use a `VITE_` key.
3. Optional: `OPENROUTER_TEXT_MODEL=google/gemini-3.8-flash`. This is the remote OpenRouter slug, without the internal `openrouter/` prefix. When a gateway key is configured, new text quotes default to this model unless an admin routing choice overrides it.
4. Keep MongoDB, Redis, private R2 and existing queue enable variables unchanged. FFmpeg rendering still runs in the dedicated render worker and needs no AI gateway key.
5. Open **Admin → Providers**. Live public catalogs are cached for five minutes. Select a model for research chat, channel analysis, scripts, publishing metadata, media analysis, or each image/video/voice workspace. Multiple features can independently use the same model. Saved bindings and policy changes are audited. Choose No default to clear a feature binding and return to the configured provider default.
6. Use **View pricing** to see live published rates, billing units, available endpoint tiers and verification time. This is not an invoice or a promised fixed cost per project. OpenRouter general video model listings can show zero token rates; these are not video prices. Video pricing requires the dedicated video catalog's pricing SKUs, and image rates come from endpoint-specific billable lines.
7. In Admin / Pricing, configure Automatic OpenRouter credit pricing, fees, margin and spending caps. Published bounded text and native-audio video rates drive new quotes. Token-priced images, speech and multimodal analysis need expiring Verified cost overrides when discovery cannot establish a safe maximum cost. Direct-provider rules remain separate. Approved quotes keep their terms.
8. Configure **Provider and model policy** for the model or `openrouter:*`: enablement, maximum concurrent calls, daily jobs and estimated per-job spend cap. Routing bindings do not bypass these checks.
9. Prepare and approve a small new production estimate. Existing quotes/queued jobs keep their stored provider, model and original price. There is no silent provider/model fallback after approval.

## Implemented adapters

| Feature | Gateway API | Model support |
| --- | --- | --- |
| Research chat, channel analysis, scripts, publishing metadata | `/chat/completions` | Admin-selectable text models with text output, output-token limits and structured-output support; catalog validated before use |
| Thumbnail assessment and long-video analysis | `/chat/completions` multimodal content | Selected model must explicitly support image/video inputs; short-clip source is shared through a temporary private R2 signed URL, not uploaded to Google Files |
| Scene images, standalone images, original thumbnails | `/images` | Existing Google image adapters mapped to `google/...` slugs; only catalog-verified options appear, and resolution/aspect ratio/reference counts are validated |
| Video with native sound | Async `/videos`, polling, authenticated `/content` | `google/veo-3.1`; dedicated catalog capabilities required before submitting. Voice/dialogue prompting, stream/audio inspection and required human lip-sync review remain in effect |
| Narration/Voice Studio | `/audio/speech` | `google/gemini-3.8-flash-tts` and Lite adapter with the existing documented voice roster. MP3 is decoded with FFmpeg into measured WAV for the existing pipeline |
| Talking avatars | Existing direct HeyGen workflow retained | Existing authorized presenter IDs and provider consent records are not portable to OpenRouter image/audio Avatar IV inputs |
| Editing/export | Existing FFmpeg worker | No AI gateway used for actual editing, audio mixing or MP4 rendering |

Internal IDs start with `openrouter/`, for example `openrouter/google/veo-3.1`; adapters remove only that prefix when calling the gateway. Legacy direct IDs remain valid. Supported gateway capabilities and prices are fetched from the real API; discovery failure does not invent models or prices. The UI retains existing direct options, and unsupported gateway settings fail before a paid request is submitted. Generic arbitrary video models, advanced voice cloning and portable HeyGen presenter IDs are not exposed as working adapters.

OpenRouter lists `heygen/avatar-iv` and `heygen/heygen-video-1`. Their existence is not proof that a direct HeyGen `avatar_id` and `voice_id` can be reused. This migration preserves the current authorized-presenter workflow until a separate compatible image/audio input adapter and consent transfer have been implemented and tested. No direct Gemini, Veo or HeyGen integration has been removed.

## Costs, storage and reliability

The provider group is `openrouter` for new gateway calls. Existing reservation, settlement, refund, queue, concurrency and daily-limit systems still apply. Provider-response usage and numeric reported USD costs are stored in `GatewayUsage` and visible in Admin → Providers. Provider-reported costs are separate from credit quote estimates and invoices. Missing speech cost is recorded as unknown because its response is binary, never as free usage. Identified provider requests are deduplicated by request ID and media kind to avoid double counting resumed downloads.

Generated images are decoded and normalized to PNG; narration becomes valid WAV with measured duration; videos undergo native audio/video inspection before the existing R2 upload path. Asynchronous video IDs use `openrouter:<jobId>` and are persisted through the same checkpoints as existing Veo jobs. Polling resumes the ID instead of submitting another video. There is no automatic paid submission replay on network ambiguity; existing explicit retries/regeneration approval still apply. Content downloads use a fixed gateway endpoint and validate redirects; the API key is not forwarded to storage hosts.

Veo native dialogue does not create a TTS step. Optional off-screen narration is billed separately only when requested. FFmpeg source audio preservation, manual timeline editing, persistence and final R2 verification are unchanged.

## Testing and removal gate

`backend/tests/openrouter.test.mjs` mocks the gateway wire API while running real MongoDB transactions and FFmpeg media decoding/inspection. It tests structured scripts, image/reference payloads, speech WAV conversion, asynchronous native-audio video, capability rejection, unknown-price rejection, frozen quotes, routing persistence, provider limits and credential-safe downloads. Existing Studio, publishing, avatar consent, admin and credit suites are also required.

No OpenRouter key has been supplied for this migration. Paid gateway generation, account entitlement, real storage of gateway-generated files and actual dialogue/lip-sync quality have **not** been verified against a live account. Real FFmpeg tests use synthetic media; existing R2 tests use a local S3 protocol fixture. After adding the key, verify one image, one voiced video, one narration, one full Studio job and final export before considering retirement of direct credentials. Verify avatar rendering through the retained direct integration separately.

**Direct credentials safe to deactivate now: none.** Keep `GEMINI_API_KEY` for existing direct queued operations and unmigrated features, and keep `HEYGEN_API_KEY` for authorized presenters. Google OAuth/YouTube credentials are unrelated and remain required. No credential belongs in frontend JavaScript.

Provider references: [text API](https://openrouter.ai/docs/api/reference/overview), [image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [video API](https://openrouter.ai/docs/guides/overview/multimodal/video-generation), [speech API](https://openrouter.ai/docs/guides/overview/multimodal/tts), [live video model catalog](https://openrouter.ai/api/v1/models?output_modalities=video). Published catalogs were inspected on 16 October 2026; availability and rates remain dynamic.

Account reporting: add OPENROUTER_MANAGEMENT_KEY privately in Render for balance and completed-day activity. The normal generation key is used for key limits and generation-cost lookup. Admin / OpenRouter shows timestamps and stale or missing records. Reporting never submits paid generations. Credit packages default to $10/500, $20/1000 and $90/5000; existing custom prices and historical purchases are preserved.

## Queue outages and compatible alternatives

Standalone image/video jobs persist in MongoDB before dispatch. An offline Redis connection, missing worker, or enqueue failure selects the Mongo fallback. The web service runs one fallback job at a time, scanning every five seconds; old queued Redis jobs become eligible after one minute. Atomic worker claims prevent duplicate execution. MongoDB, a running web service, valid provider access and working media storage remain required. A restarted process does not automatically resubmit an uncertain in-flight provider operation; queued work survives restart, but interrupted processing needs review. Studio and FFmpeg export queues remain dedicated workers.

New gateway image choices include FLUX 3 Klein and Seedream 5 Flash. Dedicated public catalogs and endpoint rates were checked without paid generation. An unbounded Google token-priced image quote can propose compatible FLUX instead; the quote discloses the actual model before approval. Defaults favor the non-Google alternatives unless an admin binding overrides them. Wan 3.0 is available for native-audio image-to-video through the existing asynchronous adapter; duration, first frame, resolution and audio capabilities are checked, and FFmpeg inspects the output. Real paid image/video quality and account entitlement require an authorized live test.

New text quotes can include OPENROUTER_TEXT_FALLBACK_MODEL (default openai/gpt-4.1-mini) when discovery, structured-output support and verified pricing permit it. Approval covers conservative combined primary and fallback cost, and max-price controls are retained. A definite 404/429 rejection or a structured text-service 503 can switch once; network ambiguity and uncertain media submissions are not blindly retried. Existing frozen quotes are not silently expanded. Provider costs are recorded under the actual model. No privacy settings are weakened; blocked providers require another compatible provider or an explicit account-owner privacy change at https://openrouter.ai/settings/privacy.
