# Connected production agent

## Audit and changes

The existing Studio worker already generated images, native-audio video and optional narration, stored assets in R2, checkpointed stages in MongoDB and settled outputs against one approved reserve. Its missing connections were chat-to-planning/control, automatic final rendering, and a valid Studio record for Shorts editor timelines. Those connections now use the existing services.

- `productionTools.ts` owns priced planning and production control for both HTTP actions and agent calls. Planning only creates a draft; it never approves spending.
- `agentTools.ts` exposes owned production status, assets, licensed presets, supported timeline commands, planning, replacement-output quotes, pause/resume/retry/cancel and render status. OpenRouter selects bounded tool calls; actual backend results are supplied to the streamed answer. Unknown tools, foreign resources and unauthorized edits fail.
- `editorToolExecution.ts` is used by manual editor commands and saved Studio edits, including actual FFmpeg silence analysis for edits up to five minutes. Existing revision checks prevent overwriting concurrent manual edits.
- Chat displays tool state and durable production events in its scrolling conversation. Saved assistant messages retain tool results. The separate Studio coordinator and activity panel are removed. Script/commercial worker logs also feed the conversation.
- New Studio plans default to including an MP4 export from the shared saved editor revision. Existing plans keep their original behavior. The rendering quote is frozen into the same budget. MP4 jobs reuse the existing FFmpeg worker and verified R2 upload/download routes.
- Commercial scripts hand off to the production workspace with their real product references. Shorts now create owned Studio productions and shared editor records instead of nonexistent production IDs. Existing source audio, captions and crop information are preserved.
- Existing admin model controls, pricing, access checks, licensed pack CRUD and preset application are reused. New work does not introduce a wallet, asset store or second editing engine.

## Budget behavior

The user reviews the production estimate and approves its maximum once. Credits are reserved up front; each completed output settles progressively, using existing unique ledger keys. The reserve is checked before the next generation request. Automatic rendering uses that reserve rather than making another reservation. Successful completion or render failure releases the remaining unused reserve. Ambiguous provider submissions are not automatically regenerated.

Script drafting remains a separately quoted operation before media planning. A changed plan or replacement output needs new approval; this is not permission for unlimited generation. Known provider usage is linked to the production reservation for cost monitoring. Unknown provider costs remain estimates rather than invented actual costs. No historical wallet corrections are performed.

## Deployment

Keep the existing MongoDB, Redis, R2 and provider variables. Studio requires its existing Studio background worker and `STUDIO_QUEUE_ENABLED=true`; the image worker alone is insufficient. Automatic export requires `RENDER_QUEUE_ENABLED=true` and a verified FFmpeg renderer (dedicated worker or existing web fallback). Missing pricing or readiness blocks generation approval. No new secret is required by this change.

## Verification and boundaries

Non-billable tests cover ownership, CSRF, frozen budgets, progressive settlement, duplicate workers, checkpoints, cancellation, product references, pack permissions, native-audio rejection, shared revisions, Shorts handoff, and real FFmpeg MP4 rendering with a local S3-protocol storage fixture. Chrome tests cover mobile/desktop chat activity, budget approval, playback, overlays, timeline editing and saved conversations. No paid generation or live R2 writes were used.

This is bounded tool orchestration, not unrestricted autonomous execution. Scripts/scenes require review before media production. Automatic final rendering freezes the saved timeline revision; later manual edits require a new export. Silence analysis is limited to five minutes. Speech identity, lip-sync and inferred Shorts captions/framing require review. Multimodal analysis/transcription need supported configured models and verified pricing. Provider availability, live speech quality, continuous speaker tracking and the quality of paid media were not verified by these non-billable tests. Arbitrary music generation and unsupported provider features are not fabricated.
