# Support chat and Cloudflare Turnstile

Reuses existing SupportTicket, SupportMessage, SupportEmail, authenticated Socket.IO and polling fallback, ticket attachments, assignments, read receipts and admin support inbox. No second conversation database or support dashboard.

Users can start bot-first support from topic suggestions, type their issue, return to the saved conversation, create a conventional ticket or request a human. The AI uses existing bounded OpenRouter chat routing and the four-hour allowance. Provider/limit failures give identified guided troubleshooting, not fabricated AI actions. The assistant cannot issue refunds, alter balances or perform generation. It can point users to real existing actions. Duplicate assistant requests reuse the saved reply; a per-conversation lease controls concurrency.

Explicit handoff changes the saved stage to waiting_agent, preserves messages and queues a deduplicated Attention needed email to active admin/support accounts. Emails contain requester identity and a private admin sign-in link. They do not contain private transcript/attachments. Existing outbox retries deliver through configured email transport; missing mail configuration leaves emails pending, never falsely sent. Human replies stop bot mode and remain in the same conversation. No guaranteed agent availability is advertised.

Cloudflare configuration on Render backend:
TURNSTILE_SITE_KEY=<public site key>
TURNSTILE_SECRET_KEY=<private secret key>
TURNSTILE_ENABLED=true

Create a managed Turnstile widget for drexai.onrender.com and any custom frontend hostname. Keep APP_URL / CLIENT_ORIGIN aligned with actual frontend hostnames. One widget supports signup, login and admin_login actions. Site key is supplied through /api/auth/security, so no VITE secret or frontend key rebuild is required. Leave TURNSTILE_ENABLED false until valid keys are configured. Enabled missing keys fail closed. Existing password, email verification, admin OTP/TOTP, session, rate-limit and CSRF flows remain.

Backend validates via Cloudflare Siteverify with expected action and frontend hostname. Token expiry/replay are enforced by Cloudflare; failed/unreachable validation cannot bypass authentication. React widgets reset after each submission and token expiry clears the token. CSP permits only the required Cloudflare script/frame origin alongside existing origins. Cloudflare protects authentication forms; this does not configure CDN proxying, WAF or DNS.

Validation: 18 backend tests passed covering structured AI adapter with mocked provider, guided fallback, ownership, reply deduplication, durable alert outbox, existing ticket/attachment/realtime/admin/notification/email behaviour and Turnstile action/hostname/replay/failure checks. Eight browser tests passed for existing support actions, mobile/desktop live chat persistence and handoff, and Cloudflare token submission on login. Backend/frontend builds and frontend TypeScript passed. No paid AI tests, real email sends or live Cloudflare challenges were performed. Live Turnstile requires owner-provided keys; email delivery requires configured existing SMTP or Resend transport.

Final integration checks also cover administrator navigation/controls and support-email ticket return after sign-in. Separate administrator sessions now authenticate live support sockets with administrator CSRF and origin validation. New admin cookies use HttpOnly, SameSite=Strict and the root path so the socket handshake receives them; logout clears legacy and new paths. Existing admin users should sign out/in once after deployment to receive the updated cookie. Both builds, TypeScript and final targeted browser checks passed. Support-role staff receive the existing support dashboard link; administrators receive the admin portal link.
