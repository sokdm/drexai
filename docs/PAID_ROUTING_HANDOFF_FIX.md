# Paid-only routing and production handoff correction

## Verified causes

- Auto routing explicitly chose catalog `:free` models. Zero-provider-cost story quotes used `minimumCredits` as a flat service minimum, explaining the displayed 1-credit script quote.
- Production model discovery built all operations while pricing an image candidate. A selected ElevenLabs model with stale `Kore` voice settings failed validation before the voice candidate could be corrected, even after the script had saved.
- Research and legacy Chef chat appended unbounded stored context to bounded requests. Prompts now retain the latest request and allocate UTF-8 byte budgets to history and evidence.
- `estimatedNarrationTiming` was a required provider response field although the application can calculate this estimate locally from actual spoken text.
- Socket clients connected immediately and disconnected whenever the final hook unmounted, including development remounts. They also used polling followed by upgrade, which is susceptible to invalid sessions across instance switches. The supplied logs do not establish which Render instance handled each failed request.
- YouTube created its own iframe asynchronously, so API initialization could precede iframe navigation. The replacement initializes an explicitly addressed YouTube iframe after its load event. The fullscreen attribute warning is also addressed.

## Changes

Paid catalog routes only; free aliases blocked during discovery, quoting, wallet reservation and execution. Saved legacy mode values normalize to compatible paid text models. Messages remain uncharged to users within the existing four-hour allowance; provider costs remain bounded and tracked. Creation tools use existing dynamic cost pricing and exact approval. No forced 1-credit story service charge remains. A genuinely low calculated quote may still round to one credit under admin pricing rules.

Image, video and speech candidates validate independently before building the final combined production plan. Agent plans select compatible priced media models. The production-plan retry retains the existing script and settled reservation. Cards distinguish a failed production-plan handoff from script creation and remove redundant paid-continuation buttons.

Missing timing is calculated without a new paid request; missing actual scenes or narration still fails validation. Definite 502 text rejections with no generation ID or reported charge can use already-approved compatible fallbacks. Uncertain paid timeouts are not blindly replayed.

Realtime uses WebSocket only, deferred initial connection and short shared cleanup grace, with identity changes reconnecting safely. YouTube sets iframe source, origin, referrer policy and permissions before API initialization.

## Verification and deployment

31 focused backend tests: paid-only selection, real pricing above the old flat minimum, script creation to saved storyboard and narration plan, duplicate approval protection, continuation without rebilling, 502 fallback, wallet protections, four-hour allowance, scene validation, durable progress and speech pricing. Four mocked browser tests cover chat restoration, desktop/mobile story approval and iframe/WebSocket initialization. Production build and frontend typecheck pass. No paid generation or production database changes were performed.

Deploy web and all workers from the same commit. Refresh an unapproved old creation quote before approval. For an already-saved script with failed production-plan handoff, use Continue unfinished step; it does not regenerate or charge for the script again. Previously settled transactions were not adjusted. Actual Render connectivity and live provider reliability require post-deployment observation; external outages cannot be eliminated by application code.

References: [Socket.IO multi-node transport guidance](https://socket.io/docs/v4/using-multiple-nodes/), [YouTube iframe API](https://developers.google.com/youtube/iframe_api_reference).
