# Video quotes and channel handoff ? 2026-10-19

Verified code causes:
- Ambient production planning used maxClipsPerScene as its default clip count. Three scenes with a limit of three therefore requested nine clips. Planning now uses scene duration and supported model durations; the worker skips by cumulative footage duration.
- Provider capacity/spending-limit errors were hidden by the generic approval error. These now return specific safe actionable errors. The exact live Render failure cannot be confirmed without its server logs.
- YouTube chat appended research context to the message used for intent detection and ignored task events. Context is now separate, task cards are functional, and saved scripts link to Script Builder and AI Studio.

Changes:
- Pending operation cards provide server-verified model/quality quotes, sorted by credit cost. Changing a model preserves completed assets, supersedes old approvals, refreshes quote validity and requires fresh approval. It never starts generation or reserves credits.
- Submitted provider jobs and active reservations cannot be replaced. Model changes after partially completed video operations are deliberately blocked to avoid repeated footage.
- Added Wan 480p/durations 2?30 seconds and Kling Standard native-audio adapter. Public OpenRouter video catalog verified those capabilities and Wan resolution pricing / Kling audio-inclusive pricing. Actual paid output was not tested.
- Channel cards now offer Analyse channel, original 60-second short creation and an editable 30-second episode brief. Existing paid analysis approval is retained; script and media require separate approvals. Chat tasks recover after refresh and New chat starts a fresh conversation.
- Research context is stored as untrusted evidence and passed as inspiration, not copied source scripts. This does not implement autonomous multi-episode series execution.

Pricing:
All quotes still use the existing pricing engine, active packages and admin settings. Wan 480p published provider duration rate is half the 720p rate; website quotes include existing configured expenses and margin. No historical wallet changes were made. Choosing cheaper quality is explicit; no approved paid settings are silently replaced.

Verification:
- Backend and frontend builds; frontend TypeScript check.
- 15 backend tests: durable story pipeline/recovery, approval idempotency, audio contracts, clip counts, alternative quotes and preservation/no deductions.
- 10 mocked browser tests at 390px and 1440px: approve/reject/lost response, video model switching, channel-analysis-to-story task handoff.
- No paid OpenRouter requests. Frontend build retains its pre-existing large-bundle warning.
