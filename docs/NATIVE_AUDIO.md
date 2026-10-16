# Native audiovisual correction: Phases 5, 7, 8, 9 and 10

This targeted correction preserves existing projects, Voice Studio, the dashboard layout, and unrelated platform features.

## Phase 5: scripts

Scenes retain all legacy fields and add ordered `dialogueLines` with speaker, exact intended text, language, accent, emotion and delivery. Scene-level fields cover actions, camera position/movement, environmental sound, effects, ambience, estimated duration, visible speaking characters and explicitly requested off-screen narration. The generator requests these structured fields. Script Builder exposes sound/delivery directions and narrator selection; editing legacy `Name: words` dialogue clears stale structured lines. Ambiguous unnamed multi-character speech is rejected before billing. Saving scenes validates the shared generation schema before changing project history.

## Phase 7: Veo

The official `@google/genai` SDK submits `veo-3.1-generate-preview` and polls persisted operation IDs. Native audio is inherent to this model: no invented audio-enable flag, deterministic voice identity or separate voice-ID control is sent. Prompts contain ordered quoted speech, character descriptions, expressions/mouth movement instructions, accent/delivery preferences, motion, framing and environmental sound. Stored character references guide the scene image used as Veo's starting image; the starting-image path does not combine incompatible reference-image parameters.

Supported controls are 16:9/9:16; 4/6/8 seconds at 720p; eight seconds at 1080p/4K; one output per provider request. Studio currently chooses eight-second segments. Standalone image-to-video supports dialogue and sound instructions and rejects excessive dialogue instead of submitting an overloaded clip. Studio divides longer speech into ordered segments using a conservative 14-word estimate per eight seconds, without changing speaker order; exceeding the configured clip cap blocks estimation until the creator splits scenes or increases the cap. Segment boundaries and pacing need review, especially for slow or non-English delivery.

Downloaded MP4 bytes retain their soundtrack. FFprobe checks video/audio streams and duration; FFmpeg measures peak audio level, rejecting missing or effectively silent tracks. These checks do not establish correct words, speaker identity, voice consistency or lip-sync. Results record these as unverified and request user review. Provider errors and blocked/empty output are failures, never fabricated media. No expensive generation is retried automatically by the SDK.

## Phase 8: Voice Studio

Standalone Gemini TTS remains available unchanged for narration, faceless/documentary/educational voiceovers and audio-only work. Studio creates TTS only for scenes with requested off-screen narration. A legacy scene with no dialogue and narration is interpreted as narrated; a dialogue scene requires explicit `offscreenNarration: true` to add a narrator. On-screen dialogue never produces a separate TTS operation or charge. TTS voice selections apply to the narrator, not Veo's character speech.

## Phase 9: orchestration, review and credits

Approve script → generate scene images → generate Veo audiovisual segments → optional off-screen TTS → inspect native tracks → arrange clips → prepare editable rough cut. Existing configurable per-second video pricing includes native audio; only actual narration steps incur TTS pricing. Quotes, reservation, idempotent settlement and unused-credit release remain in place. Dialogue segments are never skipped to satisfy an estimated target duration and stay whole in the rough cut. Narration may extend a scene using its still image.

Events stored in MongoDB report generation submission, native audio inspection, detected soundtrack, required review and audiovisual assembly. The scene preview offers accepted/issue review and optional actual-audio transcript entry. Ownership and CSRF protections apply. Review text and timestamps persist on the media asset. Regeneration uses the existing scene/output quote-and-approval flow. Failed inspection marks Studio work `needs_review`, preserves completed outputs and prevents an automatic paid regeneration. Cancel pending work to release unused reserved credits before starting again.

Old completed assets are preserved. A legacy unsubmitted dialogue production requires a fresh native-audio plan; separate legacy dialogue steps are skipped, not billed again. Regeneration does not reuse legacy silent video as a verified native-audio output.

## Phase 10: editing and exports

New rough cuts preserve native source sound. The timeline stores original sound enable/volume/mute and native-dialogue markers. Preview uses the same source-in and playhead as the picture. Splitting retains source offsets and audio controls; moving a clip moves its native sound with it. The renderer extracts audio directly from each original source using the exact visual trim, offsets it to the clip position and mixes it with requested narration, sound effects and optional music. Visual intermediate segments omit audio intentionally; the final mix restores the original soundtrack from the untouched source files. Native speech is not replaced by TTS. No automatic pacing-shortening recommendation is offered for native sound clips. Manual trims/splits display a dialogue warning; there is no unimplemented claim of automatic sentence-boundary detection.

Original dialogue is not faded with visual fades, avoiding clipped words. Extra tracks have explicit fades and volume; uploaded music defaults to 20%, with a final limiter. Users must listen for competing narration/music; automatic speech ducking is not implemented. Existing saved edits retain their prior original-audio choice; original sound can be enabled in clip properties without destructive migration.

Native captions require a creator-reviewed actual audio transcript, or manual captions. The intended dialogue is not a verified transcript. Narration captions retain estimated phrase timing. Word alignment, automatic transcription, reliable automated lip-sync scoring and automatic sentence-boundary cuts are not implemented. FFmpeg cannot repair mouth animation by shifting sound.

## Verification

`backend/tests/native-audio.test.mjs` covers prompt speaker ordering, ambience, SDK parameter mapping, duration limits, segmentation, no dialogue TTS billing steps, narrator opt-in, full native clip preservation, split offsets and caption provenance. Real synthetic MP4s exercise missing/silent track rejection and FFmpeg preservation of two native sound segments alongside separate audio/captions; decoded frequency checks verify timing and audibility. Studio and editor suites exercise persistence, reservations, retries and rendering.

For authorized live verification, build then run `NATIVE_VEO_LIVE_TEST=true node backend/scripts/test-native-veo.mjs` from the repository root (PowerShell: set `$env:NATIVE_VEO_LIVE_TEST='true'` first). This checks model access, then submits at most three eight-second 720p clips: one speaker, alternating speakers and ambience. It checkpoints operation IDs, does not repeat uncertain submissions, never retries paid generation, and stores ignored local artifacts. Human playback review is still required to assess actual dialogue and mouth synchronization. No live pass is claimed merely from local fixtures or a detected audio stream.

Provider capabilities verified against [Google's Veo documentation](https://ai.google.dev/gemini-api/docs/veo). Language/accent and voice consistency remain provider-dependent; native audio does not guarantee exact words or perfect lip-sync.
