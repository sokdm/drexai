# Character Animator: capability audit and implementation

This is a new capture workspace integrated into the existing DrexAI media/editor infrastructure. It does not restore Avatar Studio and does not replace ordinary image/video generation.

## Provider findings, 20 October 2026

Official references:
- https://platform.xmax.ai/docs/authentication
- https://platform.xmax.ai/docs/capabilities/realtime-video/sdk-reference
- https://platform.xmax.ai/docs/resources/changelog
- https://platform.xmax.ai/model?mode=CharX
- https://openrouter.ai/docs/api/api-reference/video-generation/create-videos

Xmax publishes a browser SDK with realtime camera/video input, remote streams and character references. The public documentation bundle describes permanent server-side keys, temporary browser keys, expireSeconds/pointsLimit, temporary-key usage and deactivation endpoints. The September SDK changelog lists version 1.1.13. Public CharX playground material displays one provider credit per second. That is not a verified USD conversion or a DrexAI website credit rate.

No authenticated Xmax account, API access entitlement, USD provider-credit purchase price or live reference-voice conversion contract was verified. No Xmax requests were submitted. This is not evidence that Xmax restricts every account. OpenRouter documents asynchronous video job submission/polling; no equivalent camera-to-character live stream was verified. No ordinary image-to-video endpoint is substituted for live animation.

Consequently, live animation, mode controls, reference-voice conversion, paid quotes/reservations and streaming sessions remain disabled. No SDK integration, live session billing or automatic session shutdown/settlement is claimed. Enabling processing requires a real Xmax integration using capped temporary keys and verified costs through the existing pricing/reservation engine, plus trusted provider usage reconciliation and expiration/deactivation handling. Never expose a permanent provider key or derive spending from client timers.

## Functional scope

- Responsive dark/light workspace with two preview panels, actual saved-image gallery, image upload, camera controls, aspect ratios and voice-reference section.
- Camera/microphone requested only after Open camera. Microphone is opt-in; changing it closes the camera and requires reopening. Tracks stop on close/navigation. No provider receives the local stream.
- Camera input recording with MediaRecorder, stop, playback and download in the browser-supported WebM/MP4 format. Source recordings are explicitly labelled, not portrayed as animated output. Recording is limited to ten minutes or roughly 95MB. Driving-video uploads can be previewed, downloaded and saved; they are not transformed.
- Authorized reference audio can be uploaded through the existing editor audio service and previewed. This does not clone or change the user's voice.
- MongoDB AnimatorWorkspace persists owned image/audio selections, aspect ratio, microphone preference and the shared edit ID. Existing MediaAsset, VideoEdit, AIProject and StudioProduction records hold uploaded recordings and production data. Assets remain private through existing R2 storage/signing.
- Saving reuses the existing idempotent blank-editor operation, actual media upload/probe and revision-checked timeline save. Long inputs are split into clips of at most ten minutes without trimming their total duration. Existing Video Editor and AI Studio links reference the same edit/project/production. Existing editor render/export and Redis worker remain the MP4 export path.
- Existing authentication, CSRF, ownership, upload limits, permission confirmation, maintenance/rendering feature controls apply. No second wallet/pricing engine or dummy Redis generation queue is added. Local capture has no AI charge. Paid processing cannot start with unverified pricing.

## WebM repair

Browser MediaRecorder can produce valid WebM without a container duration. The existing editor visual-upload service now remuxes only video/webm with a video stream and no measured duration, using FFmpeg stream copy with a bounded timeout, then probes the result before validation and private storage. Normal videos retain their original path.

## Verification

- Backend build and frontend typecheck/build.
- Three backend tests: authenticated truthful capabilities; persisted owned workspace/CSRF; real duration-less WebM generation, remux, local S3-compatible R2 upload, shared timeline persistence and unchanged 272-credit wallet.
- Three browser tests: desktop/mobile fit with no automatic camera requests; explicit test camera recording, playback, download, save and shared editor/Studio links. Only test code supplies a generated camera stream. Production does not synthesize a live preview.
- No paid provider tests, real-account Xmax sessions, production R2 uploads or actual reference-voice conversion were performed.

Existing-editor regression: all 12 tests passed, including worker MP4 rendering, measured audio placement, captions, private storage protocol, download and upload validation.
