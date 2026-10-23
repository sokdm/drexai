# Reference editor layout and assistant

Implemented against the user's supplied dark editor reference, inside the existing Video Editor.

- One editor header replaces the extra workspace toolbar. Existing project selection, wallet, notifications, save, Studio link and export remain connected.
- Desktop uses five columns: tool rail, searchable/filterable media library, preview, independent properties inspector, and assistant. Timeline spans preview and inspector beneath them. No Upgrade block is included.
- Tablet rearranges the inspector below the timeline; mobile uses a horizontally scrollable tool rail and stacked preview, timeline, assistant, properties and media panels. Scroll is contained within tracks, properties, media and conversation.
- Assistant messages use user/assistant bubbles, real pending status, preserved failed input with retry, existing persistent conversation, quick actions, and actual export job progress. There are no invented progress percentages or fake tool completions. Commands still use the existing revision-bound proposal, Undo and Save workflow.
- Cinematic-plus-captions requests compose the existing color and caption tools atomically. Missing reviewed transcripts fail without partially changing a timeline. No new provider or production implementation was introduced.
- Functional preview mute and fullscreen controls, real video timeline thumbnails and initial clip selection were added. Preview muting does not change exported audio settings.
- Reference controls for capabilities not currently supported (such as automatic background removal and stabilization) were not presented as working switches. Existing supported effects, motion, captions, overlays, packs, audio and review controls remain accessible.

Validation uses local MongoDB, real FFmpeg and local storage fixtures, plus mocked browser APIs and real media files. No paid provider requests, live project writes or wallet changes were made. Backend and frontend builds and frontend TypeScript checking passed. The backend editor suite and compound-command tests passed: 19 tests. Final browser results are recorded after verification.

Final browser verification: all 14 unique editor cases passed (12 in the final full run, followed by the two corrected export-card locator checks). The reference screenshot and media-filter check were also rerun successfully. Desktop screenshots were visually reviewed.
