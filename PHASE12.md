# Phase 12: Customer support, feedback and notifications

This phase replaces the existing Support and Feedback placeholders, adds a notification bell/center, and extends the existing MongoDB session and Socket.IO infrastructure. It does not implement the Phase 13 administrative dashboard.

## Customer support

- `/dashboard/support`: open tickets in the eight requested issue categories, send messages, attach files, read saved replies, search/filter prior conversations and reopen eligible resolved requests.
- `/dashboard/support?view=admin`: support-only administrative workspace. Admins and support agents can search/filter, reply, assign an active agent, change priority/status, resolve and reopen tickets. Ticket history records management actions; revision checks reject stale changes.
- Existing `User.role` now supports `user`, `admin`, and `support`. All privileges are checked from the authenticated database user on every HTTP request. No role can be selected during signup or assigned through profile/preferences forms. A trusted operator must provision staff roles using existing secure database/operator tooling; this phase adds no public role-grant endpoint.
- `SupportTicket`, `SupportMessage`, and `SupportAttachment` persist conversations in MongoDB. Messages include sender ID/name/role, creation timestamp, content, ticket ID and separate customer/support read timestamps. Message/ticket request UUIDs prevent duplicate retries.
- Ticket creation, message attachment binding, notification creation and email-outbox insertion use MongoDB transactions. MongoDB must support transactions, as already required by the credit wallet (replica set or Atlas).
- Recent messages load in pages of 50; older conversations and messages can be loaded without deleting history. Customers may reopen resolved tickets within 30 days. Closed/older tickets require a new request or staff reopening.

## Attachments

Up to three files per message, 5 MB per upload: PNG, JPEG, WebP, PDF or UTF-8 text. Supported images are decoded, bounded, stripped/re-encoded; PDFs require their signature and text must be valid UTF-8 without null bytes. Executables and SVG/HTML are not accepted. Attachment bytes live in separate private MongoDB documents, never public R2 URLs.

Unsent uploads expire after 24 hours. Binding an attachment to a committed message removes that expiration. Downloads require the ticket owner or a currently authorized staff account, and use attachment disposition, no-store, nosniff and sandbox headers. File validation is not a claim of malware scanning; files are not rendered inline by Drex.

## Real-time and reconnects

Socket.IO authenticates the existing session cookie, CSRF token and configured `CLIENT_ORIGIN`. Cookies are sent with credentials. Only server-selected user/staff rooms are joined; image-job watches now check ownership. New ticket/message/read/status changes broadcast only after database commit. Staff-room events carry the ticket ID rather than private message contents; subsequent reads recheck authorization.

Clients refetch persisted messages on reconnect and use HTTP polling while the page is active as a recovery path. Sessions and roles are rechecked periodically for connected sockets. Revoked or changed identities disconnect. Durable storage is the source of truth, not transient socket packets.

## Resend email updates

Set `RESEND_API_KEY` and a verified sender in `EMAIL_FROM` in the existing environment configuration. Support ticket confirmation, staff reply and resolution emails use Resend's server-side API. They contain a minimal update and a link to the private conversation rather than attachments or full message bodies. Existing verification/password-recovery/welcome SMTP services remain separate.

`SupportEmail` is a durable outbox with unique event keys, delivery status, lease, attempts and retry schedule. The server's background notification worker runs every 15 seconds; pending mail survives restarts. Missing Resend configuration leaves mail pending rather than inventing a successful send. Retries use one immutable Resend idempotency key; automatic retries stop before its 24-hour deduplication window expires. Uncertain older deliveries are marked for manual operator review instead of risking duplicate email. Provider acceptance is recorded only after Resend returns an email ID; this is not proof of inbox delivery.

## In-app notifications

The bell is available in the existing dashboard/workspace headers. `/dashboard/notifications` shows owner-scoped notifications, read states, older pages and preferences. Links and explicit read actions update the server; cross-user IDs cannot mark another user's notifications read.

The background worker observes completed/failed image, video, voice, AI Studio and export jobs, plus settled credit purchase ledger entries. Durable cursors catch up after downtime; unique event keys avoid repeat notifications. On its first run only, each cursor starts with a 24-hour lookback. Support notifications are inserted within conversation transactions. Important password-change/reset and deletion-request alerts are inserted by their existing account flows.

Preferences separate optional support email updates, optional generation notifications and marketing consent (off by default). Security/account alerts, verification/recovery messages and payment confirmations are not disabled by marketing preferences. No marketing campaign is introduced in this phase.

## Feedback

`/dashboard/feedback` supports bug reports, feature requests, general feedback and 1–5 experience ratings. `Feedback` stores the owner, request UUID, category, status and timestamps. Users see their own history. `/dashboard/feedback?view=admin` provides protected review, categorization, status and internal notes; internal notes are excluded from customer responses.

## Checks

- `npm run test:support --workspace backend`: isolated Mongo replica set, real Socket.IO server/client sessions and mocked Resend. Tests cover complete conversations, persistence, authorization, attachments/downloads, receipt updates, reconnects, assignment, search, stale edits, resolution/reopening, email retries/deduplication, preferences, terminal job/purchase notifications, account alerts and feedback.
- `npm run test:workspaces --workspace frontend`: responsive customer/staff support workflows, attachments, persisted replies, notification read/preferences, feedback review and prior workspace regressions. HTTP responses are mocked; no real customer email is sent.
- `npm run build` and `npm run typecheck` validate the full project.

Reference: [Resend idempotency keys](https://resend.com/changelog/idempotency-keys). Stop after Phase 12; wider administration remains Phase 13.
