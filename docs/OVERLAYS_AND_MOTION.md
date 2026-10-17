# Video overlays and motion templates

The existing shared timeline now stores up to 20 independently timed image/video overlays. The last layer is on top. Controls support start time, source trim, duration, normalized center/size, opacity, rotation, stacking and none/fade/slide-left/zoom-in animation. Video overlays are muted; use the existing audio tracks for sound. Layer timing is visible and draggable in the timeline. Undo/redo and existing save/autosave include overlays.

The browser preview and FFmpeg exporter use these same properties. Source assets are ownership-checked; video trim is checked against saved metadata and actual media during export. Images/video can be uploaded through the existing editor into R2 after usage-permission confirmation. Images are decoded/re-encoded; videos are probed before acceptance. Uploaded video is limited to 100MB and one hour, images to 15MB. Overlay durations are capped at ten minutes each and the full production remains capped at one hour.

Studio opens the same `VideoEdit`, includes overlay media URLs and previews the saved layers. Silence-removal ranges also cut/reposition overlays. Intro commands shift them; short-video commands and scene deletion trim layers that would extend past the new end.

Admin Asset Packs now supports motion on template packs: gentle camera push writes real clip keyframes, and title reveal adds an editable timed animated title caption. Both can be applied from Studio, Editor or the authorized Director pack tool. They are built-in renderer-supported templates, not arbitrary executable template code or an After Effects importer. Existing pricing/auditing remains in place; manual layer/preset edits make no AI request and incur no AI credit charge.

Verification uses generated local media, not paid AI: FFmpeg composites a red video layer over a base, exported frame pixels prove it appears only during its interval, and fade/zoom/rotation/opacity variants render. Tests verify template keyframes/title data, timeline bounds, and browser add/preview/save/reload/remove. Existing export, R2 test storage, audio and caption regression checks are also run.

OpenRouter's public catalog verification remains distinct from a live generation test. No paid image/video request was made. Account-specific generation availability, output quality and provider billing can only be verified by a separately approved real generation; this update does not claim that test occurred.

Main changes: `shared/src/editor.ts`; backend `ffmpeg.ts`, `videoEditing.ts`, `videoExport.ts`, `silenceEditing.ts`, `editorCommands.ts`, `routes/editor.ts`, `routes/studio.ts`, `routes/assetPacks.ts`; frontend `EditorPlayer.tsx`, `VideoEditorPage.tsx`, `AssetPacks.tsx`, `styles.css`.
