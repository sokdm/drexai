# Connected YouTube channel

Open **My YouTube Channel** from the dashboard or **My channel** in YouTube Research.

- View the connected channel profile, statistics and videos, including private and unlisted videos.
- Choose **Enable uploads** to grant the additional Google upload permission. Existing research connections remain read-only until this is granted.
- Upload MP4, WebM, MOV or MKV files up to 2 GB. Videos default to private. Audience and synthetic-content declarations are required.
- Uploads use server-proxied 8 MB resumable chunks. MongoDB stores encrypted session details and confirmed progress. To resume after closing the page, choose the same source file from upload history.
- Completion requires a video ID returned by YouTube. YouTube may continue processing the video afterward.
- Upload JPG, PNG or WebP thumbnail pictures for owned videos. Channel verification may be required by YouTube.
- Standalone picture posts open the channel's YouTube Posts page. Create those posts using YouTube's composer; Drex does not claim to publish them through the Data API.
- Profile editing opens YouTube Studio. Finished editor exports can be downloaded and selected for upload in Publishing Tools.

Google OAuth credentials and a configured callback URL are required. Refresh tokens and resumable session URLs stay encrypted on the server.

## Verification

`npm run test:publishing --workspace backend` checks authenticated ownership, OAuth scope, CSRF, upload metadata, acknowledged progress, resumable recovery, thumbnail validation and session URL validation using mocked Google responses and an isolated MongoDB.

`npm run test:workspaces --workspace frontend -- channel.spec.ts` checks responsive profile layout, upload feedback and persistence, interrupted response recovery, thumbnails and read-only permissions. These tests never publish real content to YouTube.

References: [resumable uploads](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol), [video uploads](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [thumbnails](https://developers.google.com/youtube/data/reference/rest/v3/thumbnails/set), [picture posts](https://support.google.com/youtube/answer/7124474).
