# Large editor preview and durable playback recovery

## Verified diagnostics

Read-only inspection found the affected Coca-Cola project's four saved Seedance clips. The first source has 3,671,986 bytes in both its database record and R2 object. FFprobe reads H.264 Constrained Baseline/yuv420p video at 864x496 and AAC-LC audio, duration 6.074 seconds. Its moov metadata is near the end of the MP4. The original plays successfully in local Chrome, and a temporary local normalization also succeeds. It is therefore incorrect to describe this clip as missing, corrupt or definitely using an unsupported codec. The exact failure of the live authenticated delivery path remains unverified without that browser's HTTP trace. No production writes, uploads, wallet modifications or paid generation were performed during inspection.

## Layout

Removed the viewport-height constraint that squeezed preview, tracks and export into one screen. Desktop preview is at least 380px tall and grows up to 680px; the timeline follows below in a 300px panel. The document can scroll vertically. Media and the assistant remain separate columns; the assistant stays usable while the document scrolls. Mobile keeps a single-column layout and a full-width preview. No working controls were removed.

## Playback recovery

The existing FFmpeg export worker now also accepts distinctly tagged browser-preview jobs. A failed/stalled video requests one owned, durable preview job, which creates a small H.264/AAC fast-start MP4. Originals, timelines and final exports remain unchanged. Real job status/progress appears in the editor. Completed previews are cached by user/source asset and automatically used when the editor opens that source again. A scoped unique index and upsert prevent duplicate jobs. Failed jobs are not silently recreated; explicit retry is bounded by the existing attempt limit. Queue/rate limits protect processing capacity. Preparing a preview makes no AI provider request and no wallet reservation or deduction.

Preview MP4s are served through the authenticated byte-range endpoint. They are excluded from final export history, production export tools, publishing choices and the completed-part export gate. They cannot be saved as a project's final export. The timeline continues to reference original assets so final rendering retains source quality.

## Validation

Local MongoDB, real FFmpeg, a local S3-protocol fixture and mocked browser APIs cover conversion of a non-browser MPEG-4 source to H.264/AAC, fast-start metadata, original/credit preservation, idempotent jobs, explicit retry, range delivery, final-export isolation, publishing and series gates. Browser checks cover automatic recovery/resumption, large preview dimensions, mobile/desktop overflow, editing/history, overlays and export. Backend/frontend builds and frontend typecheck pass. No paid provider requests were used. A production worker must be online for first-time preview preparation.

Final results: 25 backend checks and 10 browser checks passed. Backend and frontend production builds and frontend TypeScript checking passed.
