# Prompt Creator and request hardening

The existing AI Assistant dashboard now has an AI Assistant / Prompt Creator tool switch. Embedded production/image assistants retain their original component and workflow. Prompt Creator takes a brief and a general/video/image/script target, returns a structured ready-to-copy prompt, permits local editing/copying, and restores saved results from MongoDB.

## Allowance and provider costs

Prompt Creator has a separate allowance of 20 admitted requests per user in the existing fixed four-hour UTC windows. It reuses ChatUsage/ChatAdmission transactions and TTL cleanup with a prompt namespace; existing assistant counters are unchanged. Changing browser storage or opening concurrent tabs cannot reset this server-side counter. Duplicate request UUIDs return the original record without a second provider submission or allowance deduction. Provider failures count as admitted requests; no website wallet credits are deducted.

Calls use existing OpenRouter model verification, configured provider spending caps and approved bounded fallback routing. Free-to-user requests may incur platform provider cost. No free-model capabilities are fabricated. Output is capped at 1200 tokens, optional reasoning is disabled when supported, and each model attempt has a 20-second timeout. Oversized briefs fail validation before admission. Prompt Creator only writes text: it cannot run agent tools or authorize media purchases. Existing OpenRouter usage tracking remains active. No second wallet or pricing engine was introduced.

MongoDB PromptDraft stores briefs, generated prompts and processing/completed/failed states per authenticated owner. Stale processing records are marked interrupted on subsequent history refresh after two minutes. Successful outputs are preserved; interrupted paid requests are not automatically repeated. History returns the latest 30 records, without exposing provider models/costs to users.

## Security changes

- API writes carrying a foreign Origin are rejected, including login/signup. Trusted configured frontend origins and ordinary server-to-server webhook requests remain usable. CORS, CSRF and webhook signature verification remain separate controls.
- Structured API bodies/queries reject database-operator keys and prototype-related keys; traversal is bounded. String prompt content is preserved.
- User session and CSRF cookies receive Secure on configured HTTPS deployments. HttpOnly session cookies, SameSite, existing expiry/revocation, password checks, Turnstile and existing login rate limits are preserved.
- Prompt endpoint is authenticated, CSRF-protected, rate-limited per account and protected by the assistant feature/maintenance controls. Its 20-request quota is atomic in MongoDB across processes.
- Unexpected internal errors return a generic message and correlation ID instead of raw database/provider details. Duplicate-key, malformed JSON, invalid identifiers and oversized request errors have controlled responses. Production 5xx errors are masked. Error logs record correlation ID, class/code and status without full request bodies or secrets.
- Express no longer advertises X-Powered-By. Existing Helmet/CSP and Cloudflare challenge integration remain active as configured.

This is targeted application hardening, not a penetration-test certification. Cloudflare edge WAF/DDoS rules, account settings and production infrastructure have not been changed or independently audited.

## Non-billable verification

Tests use a local MongoDB replica set and mocked OpenRouter/Siteverify/Flutterwave responses, never paid requests or real payments. Coverage includes structured prompt generation and persistence, duplicate submissions, 20-request concurrent enforcement and reset, separate chat quota, unchanged wallet, foreign/trusted origins, server-to-server writes, injection/prototype keys, session authentication/CSRF, internal-error masking, Turnstile and existing payment verification/cancellation/idempotency. Browser checks exercise generation, copy, saved history and responsive fit at 390 and 1440 pixels, plus exhausted allowance behavior.

Final verification: 23 backend tests and 3 browser tests passed. Backend/frontend builds and frontend typechecking passed. No paid API requests were submitted.
