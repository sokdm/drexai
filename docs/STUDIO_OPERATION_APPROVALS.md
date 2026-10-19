# Studio operation approvals and model selection

Prepare estimate previously reused saved direct Gemini settings. A missing narration price made the total null and prevented all approval cards. It also required script approval even to prepare a non-billable plan.

The Studio button now prepares operation approvals. Planning drafts is allowed; paid media still requires the existing script review and exact credit authorization. Studio defaults use non-Gemini OpenRouter adapters. An unstarted Gemini draft is re-quoted once on opening with automatic model selection; this creates no media and reserves no credits. Projects/scenes and historical wallet transactions remain untouched.

Automatic selection compares supported non-Gemini adapters enabled by existing administrator controls and present in live OpenRouter discovery. It preserves requested aspect ratio, resolution, quality, native audio and language, validates scene construction and compares quotes using the existing pricing engine. It chooses the lowest website credit quote among those compatible candidates. Model and final amount are frozen in the operation card before approval. This is limited to implemented adapters, not every model in OpenRouter's catalog. If none can be priced safely, planning fails without charging or submitting generation.

Users see separate image, narration, video and MP4 credit approvals rather than an entire-production total. Existing approved budgets remain supported server-side for compatibility. A later unpriced operation cannot prevent the current valid priced operation being approved. Zero-credit unpriced media is never authorized. Workers continue to pause at scope boundaries, settle completed outputs once, release unused reserve and preserve interrupted work.

Validation uses isolated MongoDB, mocked OpenRouter catalogs and mocked media providers. Tests compare differently priced image models, replace legacy narration with the supported ElevenLabs adapter, verify character quotes and confirm a valid image approval survives an unpriced future operation. No paid generation or production wallet changes occur.
