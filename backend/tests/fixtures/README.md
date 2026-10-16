# Original editor test audio

`original-narration.wav` is an original spoken fixture generated with Windows text-to-speech for these tests. Its text is: “The original story ends.” It is included so the complete sample MP4 contains spoken narration as well as the deterministic test tones used to measure synchronization. No third-party recording or commercial music is included.

The integration test synthesizes its own colored video clips, still image, synchronization tones and background music tone with FFmpeg. It uses an isolated MongoDB database and a local S3-compatible test server, not live customer storage or paid AI providers.
