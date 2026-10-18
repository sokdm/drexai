# Free assistant chat

This replaces the previous one-credit chat fallback policy. Assistant conversations never deduct user credits, even when a paid provider serves a response. The existing wallet can record a zero-credit reservation for cost attribution; no second wallet is introduced. Historical charges are unchanged.

Research/YouTube chat, AI Studio and image prompt chat, legacy chat, motion prompt suggestions and editor commands share one MongoDB-backed allowance per user. The default is 20 admitted messages in each fixed four-hour UTC window. The UI converts the reset timestamp to the user's local time. New conversations, API key changes and switching models do not reset the allowance. Script creation and revision tools use their own idempotent approved billing.

Provider attempts remain separately limited: existing shared daily and per-minute free-provider quotas still apply, with per-user free-provider attempts now resetting in four-hour windows. These provider counters are not the displayed message count; a research message may perform multiple requests. When free capacity is slow or exhausted, verified compatible paid models can serve the response at the platform's expense. Existing daily USD admission, provider restrictions and model concurrency controls still apply.

Admin pricing settings include `chatMessagesPerWindow` (default 20) and `chatMaxProviderUsd` (default $0.25 per operation). Only supported models with a verified bounded cost are eligible for platform-funded fallback. Structured operations continue validating actual responses. Vision fallback uses only the existing bounded image-analysis adapter. Unsupported, unavailable or blocked provider access does not become a paid charge to the user.

Chat errors show a reset message or a temporary availability message. Provider configuration, admin pricing, credentials and raw routing errors are not exposed by chat endpoints. The application cannot guarantee provider uptime; it reports temporary unavailability without pretending a response succeeded.

New script creation, images, video, narration, transcription and production/render jobs retain their existing credit approval and billing. Free chat does not authorize paid media tools. New script generation still has the previously requested platform minimum; script revisions are also billable creation tools under the updated policy.

No new Render environment variables are required. Deploy the updated application and workers together. Non-billable tests use isolated MongoDB and mocked providers to verify zero deductions, paid-provider continuation, ownership, atomic limits, resets, script idempotency, public errors, motion suggestions and responsive UI.
