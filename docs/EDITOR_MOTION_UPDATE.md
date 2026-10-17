## October 17 update

Talking avatar creation has been removed from AI Studio, admin choices, creative API submission, provider configuration and worker execution. The HeyGen adapter is deleted. The creative workspace remains dedicated to Shorts. Historical jobs and financial records are retained. Waiting presenter jobs without a provider submission are cancelled and reconciled by the creative worker; accepted or interrupted work requires review rather than automatic resubmission or an unverified refund. HEYGEN_API_KEY and AVATAR_PRESENTERS_JSON are no longer used and can be removed from Render.

The shared Studio/manual editor now supports persisted pan/zoom keyframes, linear interpolation, browser preview and FFmpeg rendering. Splitting a clip preserves the interpolated boundary; silence cuts preserve the motion for each retained interval. Keyframes are limited to 100 per clip, zoom 1–4, normalized focus coordinates and increasing timestamps inside the clip.

Text and subtitle overlays support color, opacity, rotation and custom positioning. These properties are applied in both preview and ASS export. Existing font, size, presets and animation controls remain available.

Verification uses synthetic media and mocked providers: avatar submission rejection, Shorts creation, full-source transcription fixtures, keyframe interpolation/splitting, real MP4 export with native audio, overlay ASS output and silence/effects exports. No paid AI calls are made.

This update does not implement continuous active-speaker detection, arbitrary compositing/merging of parallel video tracks or unrestricted autonomous production. Existing sequential clip assembly/export and approved production orchestration remain available. A saved crop point is not speaker tracking, and spending approval remains required for paid generation.
