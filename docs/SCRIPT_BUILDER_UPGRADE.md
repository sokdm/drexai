## Script Builder correction

The existing `/dashboard/script-builder` page is upgraded, not duplicated. It uses compact navy/purple panels with light-theme support: story setup, four document tabs, a script revision assistant, actual persisted generation logs, and a draggable scene timeline. The existing live wallet balance remains beside notifications.

### Verified code causes of the old timeout

- Both the direct text adapter and OpenRouter text adapter had a 90-second request abort.
- The previous background route launched an unawaited promise inside the web process. A stored job ID did not make execution durable across process termination.
- The whole narrative was requested in one response, capped at twelve scenes, with provider-specific eight-second dialogue restrictions. That encouraged short output and made long stories a large single request.
- The old status route classified any processing request older than three minutes as interrupted, regardless of actual saved progress.

No Render platform timeout was independently observed. These are verified source-code findings, not a claim about live provider latency or Render logs.

### Execution and recovery

The new authenticated script endpoints require an OpenRouter model selected through existing admin routing. A quote covers planning plus every two-scene writing batch. The worker uses MongoDB durable inputs, plan, cursor, leases, partial projects and timestamped logs. The web service starts a single local script consumer; MongoDB atomic claims coordinate multiple web instances. No new environment key is necessary. This is a Mongo-backed worker loop in the web service, not a newly deployed Redis script worker.

The eight-minute default targets sixteen scenes and 480 seconds. Each writing batch requests developed narration/dialogue and complete prompts. Malformed batches fail visibly. Valid short scenes are preserved and, when verified costs permit, expanded within the approved ceiling. Otherwise the saved draft carries a shorter-duration review note. Speech word-count validation is an estimate; actual duration depends on delivery and must be reviewed.

Script provider calls have an explicit 180-second limit and the frozen quote's output allowance (up to 12,000 tokens), capped by published model output limits. HTTP polling does not wait on them. Checkpointed work can continue after restart. If a process dies during a provider call or a timeout is ambiguous, the job moves to `needs_review` and preserves partial scenes and its reservation. It is not automatically resubmitted or declared refunded. Only explicit 429/503 pre-generation rejections are retried once. Invalid/failing stages release the reservation through the existing workflow. Previously consumed provider costs remain in gateway usage records. Completed jobs settle once; repeated request IDs return the existing job.

### Editing and integration

Manual scene editing, adding, deleting, reordering, version save/restore and JSON export are free. Approved continuation uses existing AI Studio routes and stored scene/character data. The revision assistant submits real background writing jobs, checks for concurrent project edits, updates the existing project and retains previous scenes in versions. Recognized targeted rewrites preserve other scenes and scene IDs; dialogue-naturalization and image-prompt requests update their respective fields. Adding scenes preserves prior scenes. Other narrative revisions may rewrite multiple scenes and require review.

Revisions currently generate a complete candidate in bounded stages even when only a subset is applied. Their quote reflects that work; this is a cost/latency limitation, not a claim of cheap single-scene inference. Agent request/outcome conversations are stored in the existing AIConversation collection and previous revision history can be opened with the project.

No image/video provider is invoked by script generation. Timeline cards start with honest placeholders. Real project assets are looked up by scene ID and refreshed periodically. Optional scene-image links pass the saved project/scene IDs and prompt into existing Image Studio; its backend validates ownership and persists scene associations. Image generation requires its own cost approval.

### Verification and remaining limits

Tests use isolated MongoDB, mocked providers and real browser layout checks; no paid OpenRouter calls are made. They cover sixteen-scene staged writing, partial progress on timeout, checkpoint recovery, targeted project revision/version/ID preservation, request deduplication, authentication, manual save, tabs, quote approval, logs and responsive layouts.

Provider quality and latency, live Render restart behavior and real paid duration matching are not verified. Ambiguous provider work needs administrative reconciliation before retry/refund. The consumer has no separate Render process and does not expose a self-service retry of ambiguous paid submissions. Existing production media costs remain separately approved. No direct-provider credentials are removed because other tools may still use them.

### Incomplete-output correction

The worker previously hardcoded 5,000 tokens despite quotes allowing 12,000, and the non-streamed gateway ignored the worker's 180-second timeout. Both paths now honor their approved settings. Script requests ask for low reasoning effort only when the catalog lists reasoning support; technical prompt fields are kept concise. Incomplete responses preserve the actual finish reason, reported usage and request ID in job diagnostics. No extra paid retry is added. Existing frozen quote ceilings, completed checkpoints and historical wallet records are unchanged.

### Scene completeness correction

Writing batches now request required named scene fields instead of an unconstrained scene array. Planning schemas specify the exact requested scene count. Complete legacy arrays with matching scene orders remain readable; missing scenes produce a field-specific error without inventing scenes, overwriting saved batches, or submitting an extra paid call. Spoken-duration checks count structured dialogue lines when present. Provider adherence still depends on the selected model; malformed responses fail explicitly.

### Short-draft recovery

Short valid writing is no longer a fatal job error. Each scene receives explicit minimum/target/maximum spoken-word guidance. A usable batch is persisted before optional expansion. Expansion runs at most once per batch, and only when all recorded provider costs are known and their sum plus frozen worst-case bounds for the expansion and every remaining required batch fit the original approved provider-cost ceiling. It creates no new wallet reservation and cannot increase the approved credit amount. Unknown or insufficient budget disables expansion. Ambiguous expansion charges stop for billing review, preserving the saved pending batch.

If writing remains short, the job saves a complete draft with an estimated spoken duration (140 words/minute) and a prominent duration-review note. It does not label a short script as an eight-minute production. Actual voice speed and visual pauses still require review. Historical failed jobs are not silently restarted.
