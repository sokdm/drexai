# Phase 10 — Video editing and final MP4 export

The editor imports AI Studio scene order, clips, still holds and measured narration/dialogue timing into a separate MongoDB `VideoEdit`. Studio productions remain intact. Open a Studio rough cut with **Continue to Editor**, or resume it from the editor's saved-edit list.

## Editing

- Sequence and reorder clips by dragging or with Earlier / Later. Trim video using source-in and duration; adjust still durations; split at the playhead; delete clips or a whole scene. Add intro, outro or scene title cards.
- Timeline zoom, ruler seeking, playback, multiple audio lanes, volume, mute, trim, global positioning, fade-in and fade-out operate on the saved timeline. Source video audio is deliberately excluded to avoid doubling generated narration. Add any wanted audio through the audio library.
- Speech imported from Studio is anchored to the first clip of its scene. Moving that anchor moves its speech and captions. Setting an explicit audio/caption start detaches that item from the clip. Deleting an anchor deletes its anchored items. Review audio after splitting or moving individual parts of a scene.
- Save timeline persists to MongoDB. A revision conflict returns HTTP 409 rather than overwriting another tab's edits. Unsaved changes have a visible indicator and a browser-close warning. Undo/redo history is local to the open editor.
- The music question offers upload, licensed library items, or no music. No commercial tracks are bundled. Music uploads require a usage-permission confirmation; library music requires recorded license confirmation or a license URL. Deployers can populate licensed assets with their own permission and attribution metadata.
- Captions derive from saved speech text and measured audio duration. Phrase timings are estimates, not forced word alignment or speech recognition. Trimmed audio limits the generated caption intervals. Edit text, timing, font, size, position and clean / boxed / bold presets. Overlays are burned into final output with libass.
- Pacing and fade recommendations are explicitly labelled rule-based and reviewable. They do not call a paid AI provider or modify the timeline without Apply. Transitions support hard cuts and short fades through black, with no overlapping-time shift.

## Rendering setup

Install dependencies and build:

```powershell
npm install
npm run build
```

Run the API, frontend and dedicated worker separately:

```powershell
npm run dev --workspace backend
npm run dev --workspace frontend
npm run worker:render
```

The API and worker must share MongoDB and these server-only settings in `drex/.env` or `backend/.env`:

```dotenv
MONGODB_URI=<MongoDB connection>
RENDER_QUEUE_ENABLED=true
R2_ACCOUNT_ID=<Cloudflare account>
R2_ACCESS_KEY_ID=<private bucket key>
R2_SECRET_ACCESS_KEY=<private bucket secret>
R2_BUCKET=<private bucket>
```

Rendering uses a durable MongoDB job queue, independent of Studio's Redis queue. An online worker heartbeat enables the Export button. The worker claims one job at a time atomically, renews its lease, recovers expired leases and records interrupted work as failed after three attempts. Failed exports can be submitted again from the editor. Jobs contain immutable timeline/settings snapshots, so edits after queueing do not change a running export.

`ffmpeg-static` and `ffprobe-static` provide the binaries. Optional `FFMPEG_PATH` and `FFPROBE_PATH` override them. An installed FFmpeg must support libx264, AAC, libass, scale/pad/crop, fade, atrim/adelay/afade and amix. Review the licenses and codec distribution requirements for your deployment. Linux deployments need available Arial/Georgia/Courier-compatible fonts for consistent rendering.

Exports support MP4/H.264/AAC at 30 fps, landscape 16:9, portrait 9:16 and square 1:1, 480p/720p/1080p, and three CRF quality levels. Video sources and audio trims are checked against their actual probed duration. Resolution checks reject upscaling for the chosen fit/crop mode. Limits: one-hour timelines, 200 visual clips, 200 audio clips, 1,000 captions, 100 MB audio uploads and 250 MB per render input. Frame rounding uses cumulative boundaries to avoid per-clip drift.

FFmpeg runs with argument arrays, never a shell. Inputs are owned media assets fetched from private storage, not arbitrary client URLs or filesystem paths. Text is escaped into ASS documents. A temporary render directory is removed after processing. Completion requires a valid H.264/AAC MP4, matching output dimensions/duration, successful R2 upload, matching object length and an accessible signed-URL MP4 read-back. Final exports never use the inline-development storage fallback.

Completed videos expose preview, duration, dimensions, authenticated streamed download, re-edit, Save to project and a link to the existing Publishing Tools route. Publishing itself remains outside Phase 10. Saving a result records `finalExportId` and `latestEditId` on its project.

## Validation

```powershell
npm run typecheck
npm run build
npm run test:editor --workspace backend
npm run test:workspaces --workspace frontend -- tests/editor.spec.ts
```

The backend integration suite starts an isolated MongoDB replica set and local S3-protocol store, then runs the real dedicated FFmpeg worker. It renders original synthetic multi-scene visuals, spoken narration, narration/dialogue synchronization tones, optional original music, title cards and captions. It checks authorization/CSRF, stale saves, persistence, trim limits, source resolution, stored-object HEAD/read-back, authenticated download, decoded audio timing, burned-in captions and full MP4 decode. It also proves a failed storage verification cannot mark an export complete. Portrait and square exports are tested without optional music or captions.

Review artifacts are retained in `backend/test-artifacts/phase10-final.mp4`, `phase10-caption-preview.png`, and `phase10-verification.json`. These tests do not spend generation credits or use live R2. Live Cloudflare acceptance requires real credentials and an online render worker; absent infrastructure is reported clearly in the UI.

Implementation references: [FFmpeg command line](https://ffmpeg.org/ffmpeg.html), [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html), and [FFprobe](https://ffmpeg.org/ffprobe.html).
