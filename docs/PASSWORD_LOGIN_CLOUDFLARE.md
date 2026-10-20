# Password sign-in and Cloudflare

User and administrator sign-in use email and password, with server-verified Cloudflare Turnstile when enabled. Administrator login no longer depends on email delivery or an authenticator code, including deployments with legacy ADMIN_LOGIN_METHOD=email/totp settings. The administrator form submits once and retains its original destination after authentication.

Signup email verification and password-reset codes remain separate flows. Signing in does not mark an unverified email as verified. Invalid credentials, suspended accounts, non-admin access to the administrator login, and failed Turnstile verification remain blocked. Existing rate limits, session cookies, CSRF checks and administrator sign-in audit records are preserved.

Verification: backend build, frontend typecheck/build, eight non-billable password-login and Turnstile tests with local MongoDB and mocked Siteverify. No real emails or paid providers are used. Actual Cloudflare widget/domain configuration must be checked after deployment; local mocked tests do not validate production credentials.

Browser verification: two Playwright checks passed for password-only administrator sign-in and preserving the support-ticket return destination.
