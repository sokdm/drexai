# Script output limits and audio intent

The supplied provider log verifies `finish_reason=length` at a 12,000-token ceiling, including ~2,600–2,700 reasoning tokens while requesting two scenes. It does not establish an application timeout. New script settings use one scene per writing request. Continuation upgrades unfinished legacy work to one-scene requests under a newly displayed quote; saved scenes are not regenerated. Completed checkpoints remain durable. No automatic paid replay or token-limit increase bypasses approval.

Script requests disable optional reasoning through the supported OpenRouter parameter. Mandatory-reasoning models are excluded from new story selection. Non-spoken response fields have explicit string bounds included in JSON schema and concise writing instructions. Full requested narrative speech remains governed by per-scene duration targets. Providers can still fail or truncate; partial work is preserved and uncertain outcomes are not blindly replayed.

Audio mode (automatic, dialogue, narration, mixed, silent) is accepted in Script Builder, inferred from explicit agent instructions and persisted on scenes. Dialogue/silent modes suppress unintended off-screen narration; silent mode suppresses character speech. Separate voiceover is priced only when a scene actually needs it. Native character dialogue stays in video generation. Auto selection does not require a speech model at all if no scene needs voiceover, even if the global narration toggle was previously enabled. Explicit mixed scenes can keep both speech types. No audio is generated until media approval.

Reference: https://github.com/OpenRouterTeam/docs/blob/main/guides/best-practices/reasoning-tokens.mdx

Short-script quotes now freeze a duration/scene-based output allowance (3,000 tokens minimum, bounded by the configured ceiling); long scripts scale their allowance. One-scene batching and the new token bound are included in the quote before approval. Existing released reservations are not rewritten or charged; continuation obtains fresh terms.

Browser checks passed at 390px and 1440px: changing Audio style to dialogue-only reaches the real generation request, with normal quote approval, editing, log scrolling and wallet navigation preserved. Provider responses are mocked; no paid calls or historical wallet adjustments were made.

Final verification: 29 backend tests passed, including dialogue/silent/mixed planning, single-scene persistence, truncation recovery, actual reasoning request parameters, pricing and production handoff. Two browser tests passed at mobile/desktop widths. Full production build and frontend TypeScript check passed. No paid generation tests.
