# Phase 13: Administrative control center

The existing project now exposes `/admin/login` and `/admin`. No separate application is created. Public dashboards, wallet, generation workers and Phase 12 support remain in place.

> Updated login: email OTP is now the default. Use [Creator upgrades setup](CREATOR_UPGRADES.md#administrator-email-codes) for the current Render configuration. The authenticator setup below applies only when `ADMIN_LOGIN_METHOD=totp`. Existing administrator accounts remain unchanged.

## Render bootstrap and MFA

Provision the initial administrator using Render server environment variables:

```text
ADMIN_BOOTSTRAP_EMAIL=your-private-admin-address
ADMIN_BOOTSTRAP_PASSWORD_HASH=an-Argon2id-password-hash
ADMIN_BOOTSTRAP_ENABLED=true
ADMIN_TOTP_SECRET=a-private-base32-authenticator-secret
```

`npm run admin:credentials --workspace backend` runs in your own interactive terminal, reads a password without echo and prints its Argon2id hash plus a random TOTP secret. The plaintext password is never saved. Add the secret to an authenticator using SHA1, six digits and a 30-second period; store recovery access securely outside the repository. Do not run the credential generator through a shared log or commit its output.

On startup, a MongoDB transaction creates one initial admin and a permanent `AdminBootstrap` completion marker. Bootstrap refuses to promote an existing customer or replace an existing administrator. Subsequent restarts do not reset credentials. After successful provisioning, set `ADMIN_BOOTSTRAP_ENABLED=false` and remove the bootstrap email/hash from Render; keep the TOTP secret. This requires Atlas/a replica set, as the wallet and support transactions already do.

Admin login requires a database admin role, active account, verified Argon2 password and TOTP code. A consumed code cannot create a second session. Missing TOTP configuration blocks sign-in. Sessions use a separate four-hour, HttpOnly, SameSite Strict cookie, secure when `APP_URL` is HTTPS. Privileged mutations also require a separate admin CSRF token. Normal customer or support-agent sessions do not authorize administrative APIs. Production frontend/API must use same-site domains or a reverse proxy compatible with Strict cookies. No public role-grant, password reset or MFA-reset endpoint is introduced.

All `/api/admin` routes authorize the current database admin on every request. User lists/details exclude password hashes, OAuth secrets and provider keys. Staff-account changes require an operator security process rather than a customer-management button. Admin login, CSV export and business mutations are audited.

## Reports

Overview dates are UTC, limited to one year. Database counts cover users, new users, login-active users, suspended users, credit sales/consumption/refunds, outstanding available/reserved credits, jobs by status/kind and recorded storage bytes. Real daily charts show recorded USD revenue, credit usage and explicit quote cost estimates. Customer detail includes wallet/ledger, generation records, support tickets and feedback. Finance lists actual payment records (including failures), credit ledger adjustments/refunds and reservations, with paginated records and CSV export of up to 5,000 recent rows. CSV cells are escaped against formula injection.

USD and NGN revenue are never combined without conversion. Revenue uses successful stored payment records. AI estimates use stored reservation quote estimates; they include budgets for reserved/released work and are not verified charges. Cost tables group those estimates by provider, model, user and feature. Legacy default-zero costs remain unknown. No billing/invoice provider feed exists in this repository, so verified expenses display Unavailable. Margin estimates explicitly exclude unknown AI costs, payment fees, taxes, storage and staffing. Credit-value estimates use the selected period's USD package sales mix; they are not a formal accounting liability valuation. Storage is recorded bytes, not live R2 billing usage. Cash refunds are not inferred from credit refunds.

## Business controls

- Packages retain the starting 1,000/$15 and 5,000/$50 seed values unless edited. Names, amounts, quantities, currency, visibility, sort order and promotional descriptions persist in the existing package collection. Public landing pricing and wallet now read these records; in-progress payments retain their original amount/credits.
- Pricing creates audited versions rather than rewriting prior versions. Image units include resolution and image count; video uses duration × output count and resolution; voice uses characters; text/story uses requests/projects; rendering can use minutes. Active paid rules validate configured cost and desired margin against the cheapest active USD package. Direct legacy generation keeps its prior prices until a matching rule is configured.
- Ten-minute quote snapshots preserve previously reviewed credits/model/cost terms through a pricing change. Existing Studio plans retain their step pricing snapshots. Enabling a hard model/provider restriction or spending cap still blocks unsafe work; a quote is not permission to bypass an administrative block.
- User suspension revokes existing normal sessions. AI restriction is checked when reserving credits. Documented positive/negative wallet adjustments are transactional, UUID-idempotent, recorded in the ledger and audit log, and cannot create a negative available balance.
- Provider/model policies store enabled state, defaults, concurrent provider-call limits, UTC daily call limits and estimated per-job spending caps. Provider-wide policy uses `gemini:*`, `google-veo:*` or `ffmpeg:*`. Policies apply in actual generation functions and rendering. Database leases/counts coordinate execution; unknown cost estimates fail configured spending caps. Video limits apply to provider submission calls, not a claim to cancel already-running remote Veo operations. Keys remain in server environment configuration.
- Failed billable image/video/voice jobs require owner review of a new quote instead of an unsafe replay. Admins can cancel eligible queued image/video/render jobs or idle Studio plans, releasing the appropriate remaining reservation exactly once. Active provider work is not forcibly interrupted. Failed FFmpeg renders can be queued again without a new wallet charge. The existing worker performs rendering.
- Feature flags protect direct backend APIs for research, assistant, images, videos, voice, Studio, publishing and registrations. Maintenance returns a polished public screen and rejects normal API access; an independently authenticated admin session retains access. Existing authenticated support/feedback routes are reused inside the control center.

## Validation

- `npm run test:admin --workspace backend`: isolated MongoDB replica set tests bootstrap, Argon2/TOTP login, replay/CSRF checks, ordinary-session denial, audited packages/pricing, preserved quotes, wallet adjustment idempotency, suspension, AI restriction, feature/maintenance enforcement, provider admission limits, safe job cancellation/retry, real-record financial reports, CSV escaping, admin support and logout.
- `npm run test:workspaces --workspace frontend`: admin mobile/desktop sign-in, charts, audited forms, user adjustments, eligible job controls, Phase 12 integration and maintenance screen, plus existing workspace regressions.
- Full build/typecheck and prior backend publishing/support/editor/Studio regressions verify integration. Provider calls in automated financial/generation tests are mocked; no provider spending, real financial adjustment or public upload is performed against live accounts.

Render credentials must be supplied by the deployment operator. This phase does not invent an administrator password or silently grant an existing customer admin privileges.
