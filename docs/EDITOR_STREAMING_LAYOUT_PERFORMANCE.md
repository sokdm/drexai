# Editor streaming, workspace and export follow-up

The earlier 15-second stall message exposed a failure; it did not establish that the user's source file was reachable or fix playback. No live authenticated media URL or production network trace was available in this session.

## Playback

Video time now drives the preview timeline. The previous independent animation clock could advance while the video was not advancing, then trigger repeated corrective seeks. Image/title clips still use wall-clock playback. Waiting/seek handling and bounded failure reporting remain. The message no longer claims unsaved edits were saved.

Owned R2 video/audio URLs from the editor now point to an authenticated same-origin content endpoint. It forwards validated single HTTP byte ranges to R2 and returns actual Content-Range, Content-Length and Accept-Ranges headers. This supports seeking to MP4 metadata near the end of a file and removes expiring browser-facing storage URLs from editor playback. Authentication/ownership checks apply to every range request. Invalid/multiple ranges are rejected; no public storage access is introduced. Existing local-upload and inline-development paths remain.

## Layout

The media column is narrower, the preview taller and wider, and the timeline spans the left and center columns. The assistant has a tall conversation region with its composer at the bottom. Clip properties are expandable and scroll separately. Export settings/history are an accessible disclosure, leaving a compact export/status bar visible while editing. Mobile presents preview, timeline, assistant, media and export in a single column; inspector controls are bounded instead of producing a multi-screen form.

## Export

Dissolve joining is integrated into the final FFmpeg filter graph together with captions, overlays and audio mixing. The extra full-video join encode and joined.mp4 intermediate have been removed. Normalization of clips and the final encode remain necessary for effects and verified output. No fixed render-speed improvement is promised on an unknown Render CPU allocation. Existing output duration, audio, codec and storage verification remain enforced.

## Validation

15 backend checks passed, using local MongoDB, real FFmpeg and a local S3-protocol fixture. These include authenticated head/tail range delivery, unauthorized access, invalid ranges, real dissolve pixel blending without a joined-video intermediate, audio sync, output verification and download. Ten browser checks passed for phone/laptop/desktop layouts, media playback, a paused-video clock regression, stalled-stream recovery, assistant proposals/history, overlays and export. Backend/frontend builds and frontend typecheck passed. No paid provider requests or live project/wallet modifications were made. The affected live source has not been fetched or its codec/network condition verified.
