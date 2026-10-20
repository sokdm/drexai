# Studio regeneration and interrupted-video recovery

## Verified code cause

The unique index on userId plus snapshot.agentTaskId correctly identifies one production per original agent request. prepareProduction previously copied source.snapshot directly when regenerating an output. A new production therefore inherited the original agentTaskId and collided with that index. This reproduces the E11000 key shown in the screenshot.

Regeneration now clones the snapshot, moves the original task identity to sourceAgentTaskId provenance, and assigns a new canonical agentTaskId only when a genuinely new agent request supplies one. Existing records and the uniqueness constraint are preserved. Replayed original requests return their saved production before repricing; concurrent upserts recover the matching record if another request won the insert. Completed assets are reused and priced at zero additional generation credits. New generation still requires its existing quote and approval.

## Interrupted provider requests

The warning means a saved step is marked requesting but has neither a saved output nor a provider job ID. Without a confirmed ID, the application cannot know whether the provider accepted or billed that request. The screenshot alone does not establish the original network, worker or provider interruption cause. No live Render logs or provider account history were accessed.

A StudioVideoReceipt now journals an accepted video operation ID by production and step. The OpenRouter adapter invokes the checkpoint callback immediately after validating its response ID, before returning to subsequent worker logic. The worker also retains the ID in memory and journals other adapters' returned operation IDs. Recovery loads an owned, non-rejected receipt before considering a missing checkpoint ambiguous, then polls/downloads that original job without submitting a new generation. Known rejected jobs are marked on the receipt and are not restored as active jobs.

Preflight capability/catalog failures are marked definitely unsubmitted, because they occur before POST /videos. Unknown POST outcomes and invalid/missing response IDs remain review-only. Activity now says submitting video request until acceptance is known, rather than claiming the request was already submitted before the provider call.

A receipt cannot reconstruct an old missing job ID from before this change, and no provider idempotency guarantee is invented. If the provider accepted a request but the process lost its ID before any durable write, review/new approved regeneration remains necessary. Known saved job IDs remain resumable; no uncertain operation is automatically replayed. Wallet and prior transaction history are not adjusted by this fix.

## Non-billable regression coverage

Local MongoDB and mocked providers cover unique-index regeneration, original/concurrent agent request idempotency, completed image/narration reuse, accepted-job recovery with exactly-once settlement, unknown-job review without submission, early acceptance followed by a handoff failure, adapter checkpoint ordering and preflight rejection. Existing approval recovery and model/quality requote tests are also run. No paid API calls, live account balance changes or historical wallet corrections are performed.

Validation result: backend build and all 13 focused regeneration, receipt-recovery, approval-recovery and model-requote tests passed.
