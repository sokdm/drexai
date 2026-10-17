# Production reference layout

AI Studio, Product Commercials and the existing Video Editor now follow the supplied reference hierarchy: compact workspace tabs, navy panels, purple/blue active states, a large central preview, left setup/media tools, right assistant/inspector, and timeline/storyboard below the preview. Light theme uses the same proportions with readable light surfaces. Mobile stacks the same working tools.

Studio's storyboard displays real generated scene thumbnails when available and honest empty scene slots otherwise. Its mini timeline reads the shared `VideoEdit`: clip, caption, narration and music tracks use saved timing. Clicking a track or scrubbing opens the shared preview at that position. Scene-details controls show saved project content. Detailed manipulation remains in the linked existing editor; no second editing engine is introduced.

Product Commercials uses the same three-column workspace, retains the uploaded product preview, and displays its actual durable script-job activity beside the assistant. Generated commercial scenes remain reviewable in Script Builder. No reference-image product photography, fake waveforms, fictional costs, progress or successful generations are inserted.

The editor's timeline is directly beneath the preview on desktop, with its media library and inspector alongside. Existing controls, uploads, exports, pack integration and credit confirmations are retained. The reference's unsupported record control, 4K export label and unavailable provider choices are not added as decorative controls.

Changed UI files: `production-reference.css`, `main.tsx`, `AIStudioPage.tsx`, `ProductCommercial.tsx`, `VideoEditorPage.tsx`, and new `StudioStoryboard.tsx`.

Verification: TypeScript and production build; mocked commercial approval/restore and Studio editor handoff checks; desktop/mobile editor controls including overlays; dark-theme screenshot inspection; mobile overflow checks. No paid AI generation is used for layout tests.
