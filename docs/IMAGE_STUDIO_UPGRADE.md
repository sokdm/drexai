## Existing image workspace upgrade

The existing `/dashboard/text-to-image` route now has compact tool tabs, left model settings, a central shared canvas, a right prompt/tool panel and a bottom filtered library. Navy surfaces and purple accents follow the supplied reference; light theme and mobile layouts use the same controls. The existing dashboard navigation is preserved. Wallet balance appears beside notifications, using the existing authenticated wallet endpoint and realtime/focus refreshes.

### Connected operations

- Generate: existing image quote, reservation, dispatch, worker, settlement and refund paths.
- AI Editor: reference-image edits via the existing image provider adapter, where image input is verified. Free crop, flip, rotation and resampling use Sharp and save new assets while preserving originals.
- Characters: owned reference assets and appearance descriptions saved in the existing CharacterProfile collection; the image worker now loads their actual reference bytes. Project associations use existing AIProject IDs.
- Variations, Product Photo, Thumbnail and Style Transfer: explicit task instructions plus reference images where needed, using the same quoted generation path. These are generative workflows, not pixel-exact masks or guaranteed identity preservation.
- Batch Scenes: up to five prompts separated by blank lines, individually quoted and summed before approval. Each generates one image. A submission failure reports accepted jobs and retries retain request IDs; this is not an all-or-nothing database batch.
- Background removal: enabled only when the published model supports image references and `background=transparent`. The adapter checks returned pixels for real transparency. Otherwise disabled with a clear explanation and an optional generative background replacement workflow.
- Resize: free standard resampling, not a claimed AI super-resolution model.
- Prompt Assistant: existing OpenRouter streamed conversations, saved memory and credit approval, with a button to apply an answer to the image prompt. It works from the written brief; image understanding is not claimed.

ImageStudio stores workspace settings, selected asset and manual undo/redo pointers in MongoDB. Original and transformed images share MediaAsset; edit metadata links the parent asset and operations. No second wallet or pricing engine was added. Uploaded/generated assets use configured R2. Redis and the existing generation dispatch fallback remain unchanged.

### Billing

Existing package initialization already includes 1,000 credits for $20 and 5,000 for $90; existing admin package management is preserved. New default automatic image quotes have a five-credit-per-image floor, with higher prices computed from verified provider units, resolution, reference count, quantity, operating expenses and admin profit policy. Existing administrator overrides and frozen approved quotes retain their terms. Historical balances are untouched.

New request IDs are unique per user. Retrying a completed request returns its job before reserving or dispatching. Worker status claims prevent a completed job from generating again. Existing wallet settlements/releases remain idempotent. Manual transformations never call the wallet or paid provider. Reference image charges are included in the existing pricing estimator.

### Verification and limits

Non-billable tests cover state persistence, reference ownership, character references reaching the worker, manual image output without ledger changes, repeat request IDs, existing finance settings and pricing, and mobile/desktop canvas/approval/undo/assistant controls. Provider responses are mocked; real Sharp processing is tested. Live provider quality, production R2 connectivity and account-specific provider availability are not claimed as tested.

Advanced image layers, masks, object selection, face replacement and AI super-resolution are not implemented. Transparency depends on published model capabilities; unavailable models do not receive unsupported parameters. Video continuous active-speaker tracking, arbitrary parallel-video composition and broader autonomous production remain outside the completed image work; existing approved production and sequential exports still operate. Paid operations still require credit approval. Avatar creation remains removed.

No new environment keys are required. Redeploy the web service and image worker together. The existing OpenRouter, MongoDB, R2 and Redis configuration is reused.

Provider capability contract: https://openrouter.ai/docs/api/api-reference/images/list-image-models and https://openrouter.ai/blog/announcements/image-api/ .
