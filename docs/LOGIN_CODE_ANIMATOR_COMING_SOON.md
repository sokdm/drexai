# Password login and Character Animator availability

Verified intermittent OTP-screen cause: AuthPage redirected any error containing the word verification to /verify-email. Cloudflare rejection/load messages contain that word, so a failed bot challenge was presented as an email-code request. The backend user/admin login routes already issue password-authenticated sessions without OTP, including when legacy admin OTP configuration remains set.

Authentication errors now remain on the current form. Login copy describes email/password plus Cloudflare protection. Cloudflare token validation, failed-password protection, suspension checks, secure sessions and CSRF remain enforced. Signup email verification and password-reset codes are separate flows.

The existing Character Animator route now renders a Coming soon screen. Navigation identifies it as coming soon. Its capture workspace implementation is preserved for a future release but is not mounted. New animator workspace writes return HTTP 423 COMING_SOON; read-only saved workspace metadata and existing recordings are preserved. Shared Video Editor uploads remain available. Opening the page makes no animator API calls, creates no editor project and requests neither camera nor microphone.

Validation: seven backend checks and five browser checks passed, plus backend/frontend builds and frontend typecheck. Tests use local MongoDB, mocked Cloudflare, local R2-protocol storage and generated test media. No live emails, paid provider calls, user wallet edits or production account changes were performed.
