# Free AI and short-script corrections

## Implemented

- Script generation previously silently increased requests below 30 seconds to 30 seconds and forced at least three scenes. It now accepts one second and one scene. Existing-project revisions also preserve single-scene projects.
- The existing pricing engine accepts catalog-verified zero-cost `:free` text models. Every published pricing field must be zero. Structured output and bounded output tokens remain required. No second wallet was added.
- Free quotes can include up to two compatible verified free alternatives. Paid alternatives are not included in a zero-credit quote. Existing rejection-only fallback rules remain in force.
- Free calls share MongoDB transactional counters across workers: 20 attempts per user per UTC day, 50 across the configured API key per UTC day, and 20 per UTC minute by default. Retries count as attempts. Rejected admission rolls back all counter increments. Admins can change these caps through the existing audited Automatic Pricing form.
- The existing account monitor displays application-counted free usage separately from provider-reported account spending. Requests from other applications are not visible in these counters.
- YouTube Chef and the shared assistant offer configured, compatible-free and credit-priced continuation modes. A paid quote must still be confirmed. Zero-credit chat approval is accepted.
- Existing feature model bindings reject text models without both structured output and output-token limits.

## Verification and limits

Non-billable tests cover one-second generation, persisted batches, recovery, duplicate requests, free-model validation, simultaneous quota admission, zero-credit quotes and mocked execution without paid fallback. Existing admin, financial and OpenRouter regression tests were also run. No paid provider tests or historical wallet adjustments were made.

Live free-model availability and provider quality are not guaranteed. Missing/incomplete provider responses are still reported honestly with completed work preserved. A long job can encounter a shared quota after earlier stages complete; no paid continuation is submitted automatically. Free quotas count provider calls, not chat messages: a research answer can require two or three calls and script generation can require many stages.

The response-mode selector is in the shared research/Studio/prompt chat component. Script Builder and other assistants use their existing admin feature bindings; dedicated per-tool paid-continuation selectors and reservation of an entire long job's free quota are not implemented in this change. Full live production verification requires approved provider usage and deployment access. Existing admin/support/email controls were preserved rather than rebuilt; this change does not claim every administrative workflow received a new end-to-end browser test.

## Deployment

Use the existing Render deployment and environment variables. No additional secret is required. In Admin, select a compatible catalog model for each feature as needed. Default free limits are conservative application caps and are not a claim about the account's provider entitlement. Keep every service on the same MongoDB database and OpenRouter generation key to share counters.
