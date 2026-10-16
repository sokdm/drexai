> Email update: existing SMTP is the preferred mail transport for account OTP, welcome messages, admin OTP and support updates. Configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and EMAIL_FROM. Resend is optional fallback only when SMTP is absent. SMTP support delivery with an uncertain outcome is held for manual review to avoid automatic duplicate messages.

# Creator workspace additions

These additions extend the existing Research, Publishing, Video Editor and AI Studio screens. Their navigation, timeline and export controls remain in place.

## Administrator email codes

The default login method is now email. In Render's private backend environment set:

```text
ADMIN_BOOTSTRAP_ENABLED=true
ADMIN_BOOTSTRAP_EMAIL=your-admin-email
ADMIN_BOOTSTRAP_PASSWORD=your-long-private-password
ADMIN_LOGIN_METHOD=email
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
EMAIL_FROM=Drex <security@your-verified-domain>
```

Use a password of at least 14 characters. The server hashes the bootstrap password with Argon2id before saving the administrator. It never sends it to the browser or stores it in MongoDB as plaintext. Alternatively, retain `ADMIN_BOOTSTRAP_PASSWORD_HASH` from the existing credentials utility. Do not set both password variants. Render itself retains configured environment secrets until you remove them.

After the first successful server startup, set bootstrap enabled to false and remove the bootstrap password/email variables. The administrator account remains saved in MongoDB. Existing administrator credentials are not changed or overwritten by bootstrap configuration. An existing ordinary user's email cannot be promoted through bootstrap.

Sign in with email/password, receive a six-digit email code, then enter it. Codes are hashed, expire after ten minutes, allow at most five attempts and can be consumed only once. The configured mail transport must accept the email before the challenge becomes usable. Missing email configuration fails closed. Admin sessions last four hours; the password is not saved in browser storage. Existing authenticator deployments may explicitly select `ADMIN_LOGIN_METHOD=totp` and retain `ADMIN_TOTP_SECRET`.

## Research and thumbnail additions

Channel analysis retrieves server-side public metadata rather than trusting browser-supplied metrics. It includes recent video lifetime views, competitor search samples, topic and keyword suggestions, inferred audience interests, content gaps and downloadable content briefs. It does not fabricate search trends, CTR, watch time, revenue or posting-time heatmaps. Public samples are limited, and lifetime views are not growth rates.

Publishing can generate up to the selected image model's supported number of variations. The full generation credit quote is shown first. Optional paid Gemini image assessment describes small-screen readability, focus and improvements. These are subjective design assessments, not real click-through tests. Eligible users can open YouTube Studio for native Test & Compare; there is no automated API audience-testing claim.

## Short clips

Start the dedicated processing worker after building:

```powershell
npm.cmd run worker:creative --workspace backend
```

It requires MongoDB, private R2 storage, FFmpeg/FFprobe and Gemini. Configure R2 CORS for your frontend origin: allow PUT, Content-Type and the upload request headers. Source MP4 uploads are direct to a short-lived signed private R2 URL, limited to 1 GB, 60 minutes and dimensions no larger than 3840 pixels. Browser upload progress and real persisted processing states are displayed. Server validation checks the actual uploaded size, streams and duration. The source must contain an audio stream; AI determines whether there is useful speech.

In admin Pricing, create an active `short_clip_analysis` rule for provider `gemini`, the configured text model and unit `request`. Set a conservative provider estimate and customer credit charge covering the maximum supported input. No default paid price is invented. Generation remains unavailable until pricing is configured.

Gemini receives the source through its Files API and selects 5–20 non-overlapping moments of 5–90 seconds. It suggests hooks, phrase captions, a normalized speaker crop position and estimated engagement scores. FFmpeg prepares real media with its original audio. Every short becomes a persisted, editable vertical timeline, opened through the existing editor and exported through its existing rendering worker and credit quote. Framing is a suggested static speaker position, not continuous face tracking; the framing slider permits corrections. Caption timing and speech recognition require review. Pop/fade subtitle effects render in FFmpeg and preview in the browser.

The private R2 source is removed after normal completion/failure or upload expiry. The Gemini file is deleted after normal completion/failure. Provider file retention applies after process crashes. Interrupted billable processing is marked `needs_review` and is never automatically resubmitted; an operator must reconcile provider charges and reservations before recovery. A failed partial batch may leave prepared clips in saved edits. The 60-minute path is implemented but has not been exercised against a paid live provider in this environment.

## Talking presenters

Set `HEYGEN_API_KEY` privately on both API and creative worker. Set `AVATAR_PRESENTERS_JSON` to an operator-approved catalog, for example:

```json
[
  {"id":"provider-stock-avatar-id","name":"Presenter","voiceId":"provider-voice-id"},
  {"id":"verified-personal-avatar-id","name":"My presenter","voiceId":"provider-voice-id","ownerEmail":"owner@example.com","authorizationReference":"provider-consent-record-id"}
]
```

Use actual IDs available to your provider account. Stock presenters require appropriate provider usage rights. Personal avatars must first complete the provider's identity/consent process; the UI links to that process. Owner email and authorization reference restrict personal presenters to their owner. The provider controls lip synchronization, expression and gesture quality; Drex does not claim independent gesture controls or in-app personal-avatar enrollment.

Add an active admin pricing rule: feature `talking_avatar`, provider `heygen`, model `heygen-avatar`, unit `request`. Price conservatively for the script limit (2500 characters). Provider budget/concurrency controls can target `heygen-avatar` or `heygen:*`. The dedicated worker submits once, polls real provider status, validates returned media, stores it in private R2 and verifies accessibility before marking complete. Ambiguous submissions are held for operator review rather than automatically duplicated. Presenter selection and scripts persist with private jobs. Finished outputs can be previewed and opened/downloaded.

## Verification

`backend/tests/creative.test.mjs` covers email-code delivery acceptance, hashed storage/replay prevention, fail-closed configuration, ownership/CSRF, presenter access, invalid timing and a real five-clip FFmpeg preparation with MongoDB persistence. Paid Gemini/HeyGen and Resend calls use mocks in automated tests. Existing admin, research and editor regressions are retained. Run builds before backend tests.

Provider documentation: [Gemini audio/video understanding](https://ai.google.dev/gemini-api/docs/audio), [Files API](https://ai.google.dev/gemini-api/docs/files), [HeyGen video generation](https://github.com/heygen-com/skills-legacy/blob/master/skills/heygen/references/video-generation.md), [YouTube Test & Compare](https://support.google.com/youtube/answer/13861714).
