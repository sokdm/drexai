# Connected production increment

## Implemented

- Studio completion creates the existing `VideoEdit` using the shared rough-cut and asset validation services. Reopening a production preserves manual timeline revisions. Available transcript captions and synchronized audio use the editor's existing timeline representation.
- Studio previews the saved editor timeline and exposes its revision and editor/export handoff. Editor saves reappear in Studio. Missing native speech transcripts are not fabricated.
- AI Director reuses the persistent streaming research agent. Authorized tools inspect production status/assets and apply the supported editor command set. Production tool execution is logged in MongoDB. Timeline mutations require explicit editing permission. This is a bounded tool agent, not unrestricted autonomy.
- Script Builder can submit an idempotent background request and recover its saved job/result after navigation. A provider interruption becomes an explicit review state instead of an infinite spinner. These short text tasks run in the web process; restart-interrupted work is not automatically resubmitted or billed twice. Media production continues using existing workers.
- Editor speed adjusts video and original sound together in playback/export. Source trim/split validation accounts for speed. Separate audio/caption lanes retain their own timing and remain user-editable. Audio blocks can be dragged horizontally.
- Audio waveforms are measured by FFmpeg from owned sources and cached on the asset; the button does not display synthetic waves. Source limit is 100 MB and one hour. Existing effects, silence removal, undo, optional autosave, native audio and MP4 export remain available.
- Supported cinematic/professional commands apply real presets, scene fades, existing caption animation and existing music volume changes. New music must be uploaded with permission and added to the timeline; the assistant does not pretend to generate copyrighted music.

## Pricing and auditing

The defaults now use a 3x markup, 0% additional margin floor, zero invented provider/contingency overhead, one-credit rounding and no five-credit image floor. The payment-fee allowance remains configurable at 3%; it is an allowance, not a verified universal Flutterwave fee. Storage/rendering/other overhead defaults remain zero until an administrator supplies defensible values. Administrators retain control over rates and margins. Already approved quotes keep their frozen settings.

Eligible new standalone quotes can release unused reserved credits when actual provider cost is positively identified. Linked text usage or returned media usage supplies that cost. Unknown usage retains the approved charge and stays unknown in reporting. Actual cost above the approved ceiling never creates an additional debit. Settlement/release keys are idempotent. Studio output settlements retain their quoted per-output terms and never charge again for opening/editing a timeline. Native audio is included in the video step.

`backend/scripts/audit-billing.mjs` reads aggregate MongoDB financial records without writes or billable provider requests. Missing costs are not treated as zero; reservations and settlements are not summed as two deductions. Detailed business figures are reported privately, not committed here.

Proposed historical correction: reconcile each affected reservation to its provider generation IDs and approved terms, calculate a proposed credit difference under the new policy, then obtain explicit owner approval before documented wallet adjustments. Exclude unknown costs until verified. No historical balance was changed by this implementation.

## Remaining development

The Director does not yet autonomously rewrite arbitrary scenes, approve spending, choose/generate music or render without the existing export workflow. There is no complete CapCut-equivalent overlay/keyframe/effect plugin engine, arbitrary clip merging, continuous speaker tracking or tested OpenRouter avatar replacement. Existing authorized avatar rendering remains intact. Provider generation speed cannot be guaranteed; saved jobs and progress/error recovery do not accelerate provider computation.

## Deployment

Redeploy the web service and existing Studio/image/video/creative/render workers from the same commit. No new secret is required. The pricing defaults apply where no saved policy exists; deliberate saved admin policies are retained. Generation and export still require correctly configured existing dependencies. No paid API test was run.
