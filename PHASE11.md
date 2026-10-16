# Phase 11: Publishing preparation

This phase extends the existing platform. It reuses the connected YouTube account, encrypted tokens, resumable uploader, thumbnails endpoint, upload recovery/history, image generation worker, Gemini service, credit wallet, MongoDB projects and Phase 10 MP4 exports. It does not replace YouTube Research, My Channel, the editor or dashboard navigation.

## Workspace

`/dashboard/publishing` lists completed exports, projects with saved final exports, publishing drafts, connected YouTube account and upload history. Editor export links open this workspace with the same export/project context. The finished MP4 remains downloadable through the existing authenticated editor endpoint.

Drafts persist in MongoDB with owner checks and revision conflict protection. Users can edit title alternatives, title, description, keywords, hashtags, summary, thumbnail concepts, calls to action and captions for YouTube, Shorts, TikTok and Facebook. The content brief is saved too. Suggestions are reviewed before application; generated metadata never publishes automatically.

## AI and thumbnails

Gemini optimization uses the existing JSON generation service with a validated response schema and a new `publishing_optimization` price rule. The existing quote endpoint displays the configured credit cost. Generation reserves credits, settles on success and refunds on failure. Pricing is seeded alongside the existing Gemini features.

Optional original thumbnail generation uses the existing image quote/generate/worker pipeline, at 16:9 and 1K. The draft stores the image job ID; polling resumes when reopened. Generated images can be previewed and downloaded through an owner-protected attachment endpoint. To apply a thumbnail, use the existing My Channel thumbnail upload after the video is uploaded. Image provider and storage configuration are required for live generation.

## Scheduling

Recommendations cover YouTube, Shorts, TikTok and Facebook. Timezone is explicit. General windows are labeled experimental starting points and do not claim audience knowledge. If existing analytics permission permits a YouTube daily-views report with sufficient days, the page describes which weekday had the highest average views. It explicitly explains that daily views are not audience-online data, hourly analytics or proof of a best publication time; daily analytics use Pacific Time. Shorts shares the channel-level signal and does not claim a separate Shorts audience report. TikTok/Facebook remain general suggestions. Failed or insufficient analytics fall back honestly.

## Authorized uploads

Reviewed saved metadata is handed to `/dashboard/youtube-channel?draftId=...&exportId=...`. The existing resumable uploader adds tags and optional future `publishAt`. Scheduled videos must be private, with a release time at least five minutes ahead. A user confirmation is required before creating an upload session; the API requires explicit `confirmed: true`. Existing audience and synthetic-content declarations remain required. Upload scopes are requested only through the existing Enable uploads step.

Upload history now also records project/export/draft references, connected channel title, tags, scheduled release and completion timestamp. Provider-confirmed completion and encrypted resumable recovery are retained. A completed upload may still require YouTube processing; uploading does not imply a scheduled video is already public.

The user downloads the existing finished MP4 and selects it in the existing uploader. Drex does not silently fetch or publish a source video. Generated metadata is carried over; the user reviews upload settings and confirms. No live uploads or public posts are made by automated tests.

## Platform adapter boundary

`backend/src/services/publishing.ts` defines platform capabilities and preparation guidance. YouTube/Shorts delegate to the existing OAuth uploader. TikTok/Facebook expose manual MP4 and metadata export only. There are no nonfunctional posting buttons or claims of API approval. Future adapters must provide their own approved OAuth permissions, status verification and policy/disclosure checks before enabling direct posting.

## Validation

- `npm run test:phase11 --workspace backend`: isolated Mongo replica set and mocked Gemini/analytics responses; draft ownership/conflicts, optimization charging/refunds, truthful scheduling, actual generated image bytes through the existing worker, preview linkage and authenticated download.
- `npm run test:publishing --workspace backend`: existing resumable YouTube upload tests plus confirmation, tags and scheduled release validation. Google requests are mocked.
- `npm run test:workspaces --workspace frontend`: responsive publishing preparation, quote-before-generation, reviewed edits, reload persistence, thumbnail preview/download, manual platform export, existing channel flows and workspace regressions.

Live Gemini and YouTube actions require configured services and the user's cost/publishing approval in the UI. These checks do not spend real credits or post to real accounts.

References: [YouTube videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [TikTok Content Posting API](https://developers.tiktok.com/docs/en/content-posting-api-get-started), [Meta developer documentation](https://developers.facebook.com/docs/).

Stop after Phase 11. No subsequent phase is implemented.
