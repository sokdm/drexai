# Existing production integration plan

Inspection: Script Builder has persistent staged jobs and approved resume. Agent tools already include production inspection, assets/packs, shared timeline edits, planning, exports, pause/resume and quoted regeneration. Approval cards reserve/settle through the existing wallet. Studio runs image, narration and native-audio video steps. Shared editing preserves manual revisions. FFmpeg joins clips, mixes native/separate audio, applies effects/captions and exports through the existing worker and authenticated download route. Native audio inspection checks tracks and volume but does not establish semantic dialogue or lip sync.

Phases:
1. Provider-capacity diagnostics: identify account versus key limits, preserve wallet, never bypass genuine insufficient funds.
2. Expose owned production quality inspection through the current agent registry. Reuse FFmpeg/native audio and saved timeline validation. Repairs that regenerate media continue through regenerate_output and fresh approval; do not fabricate repaired speech.
3. Verify 60-second multi-scene timing/assembly with actual local FFmpeg; mocked provider and wallet/approval integration tests remain distinct from paid semantic generation verification.
4. Run existing agent, pricing, rendering, export/download and media regression tests; document failures and scope honestly.

No live paid generation is authorized. Production provider balance cannot be replenished by website credits. Human review remains required for spoken wording, speaker identity and lip sync; no successful semantic checks will be invented.

## Implemented and verified

- Provider-capacity rejection records whether the account balance or generation-key limit blocked the quoted operation. Public error offers model/quality requoting without disclosing provider USD or changing wallet balances. Genuine insufficient funds remain blocked; code cannot replenish an external account.
- Added inspect_quality to the existing production-tool registry and planner instructions. It checks owned completed media with real FFprobe/native-audio inspection, validates the same saved editor timeline, persists a separate qualityReport without modifying approval-signed snapshots, and returns existing regenerate_output tool arguments for damaged clips. Pending outputs are reported as incomplete. No duplicate editor or paid-repair implementation was introduced.
- Repairs needing media regeneration still require the existing fresh quote and user approval. Semantic dialogue, speaker identity, acting and lip sync are explicitly unverified; this implementation does not pretend tone fixtures are spoken dialogue.

Testing: backend build passed. 16 production/story/approval/model/credit/capacity/editor-command tests passed, including a local 60-second three-clip technical workflow with actual FFmpeg and synthetic audio, damaged-output detection, ownership checks and idempotent settlements. Existing editor suite: 12 tests passed covering FFmpeg worker, S3-compatible test storage, authenticated download, captions, audio positioning, uploads and failed-upload handling. Five targeted agent regression tests passed: streaming/concurrency, shared timeline editing, asset packs and saved tool evidence after summary failure.

Scope: these are complementary subsystem/integration tests, not one uninterrupted 60-second paid-provider end-to-end run. Script creation/approval are tested with mocked provider responses; 60-second assembly uses synthetic local media. Actual AI image/video generation, speech content and provider lip-sync repair were not tested using paid credits. No live account balance or Render logs were accessed. Website wallet balances and existing stored projects were not modified.
