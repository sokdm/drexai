# Watching YouTube inside research

The existing research route now accepts `/dashboard/youtube-research/watch/:videoId`. Research stays mounted behind the watch view so returning restores filters, results, bookmarks and Chef conversation. Trending/search cards, saved video thumbnails and titles, and the detail-panel video open the internal watch view. The dashboard shell is unchanged.

The official YouTube IFrame Player API supplies playback, seeking, volume, speed, fullscreen and other controls supported by each video/device. Branding and advertisements are not covered or removed. Media streams directly from YouTube. No video download, proxy or rehosting endpoint is used. An explicit origin and referrer policy identify the website. Player errors, disallowed embeds and slow/blocked loading show retry or an external watch fallback.

Recommendations combine title/tags/topic-based search and videos from the source channel, with deduplication, embed filtering and pagination. They are related public search results, not YouTube's personalized recommendation feed. The deprecated `relatedToVideoId` parameter is not used.

Public metadata, recommendations, comment threads and replies reuse the existing server-only API key and MongoDB cache (10 minutes). Concurrent identical reads share one pending request; expired cache entries are replaced. Comments use plain text and React text rendering. Additional replies are fetched only when expanded. Sorting and pagination use supported API parameters. Disabled comments and quota errors have separate UI states.

## Comment authorization

Read-only and upload-only Google connections cannot post comments. **Authorize commenting** requests `https://www.googleapis.com/auth/youtube.force-ssl` through the existing OAuth flow, with incremental consent. The Google OAuth consent configuration may require verification for this scope. The broader pre-existing `youtube` scope also qualifies. Google tokens remain encrypted on the server.

Posts require an authenticated Drex session, CSRF token, rate limits, explicit comment permission and a confirmed Google success response. Replies validate the parent belongs to the selected video. Only text explicitly submitted by the user is posted. YouTube may moderate or hold comments.

## Checks

- `npm run test:watch --workspace backend`: isolated MongoDB and mocked Google API tests for cache, pagination, metadata, replies, quota, disabled comments, OAuth, CSRF and comment creation. No real comments are posted.
- `npm run test:workspaces --workspace frontend`: responsive watch navigation, retained research state, recommendation navigation, comments, replies and permission states, plus existing workspace regressions. The regular suite mocks the player/API for deterministic checks.
- Optional real-player smoke check in PowerShell: set `$env:LIVE_YOUTUBE_PLAYER='1'` and run `npm run test:workspaces --workspace frontend -- watch-live.spec.ts`. This streams a public YouTube developer demo through YouTube's player; Drex auth/metadata are mocked and nothing is posted. Requires YouTube network/browser access.

References: [official player API](https://developers.google.com/youtube/iframe_api_reference), [comment threads](https://developers.google.com/youtube/v3/docs/commentThreads), [comment implementation](https://developers.google.com/youtube/v3/guides/implementation/comments).
