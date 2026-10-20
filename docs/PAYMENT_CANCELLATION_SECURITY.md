# Checkout cancellation and verification

Pending means a checkout was initiated; it does not mean payment or credits were issued. The wallet now has a CSRF-protected Cancel pending checkout action. The server filters by authenticated owner and pending status, records one audit event, and never mutates the wallet for cancellation. Flutterwave cancellation returns without transaction IDs use the same endpoint. Closing a tab without returning leaves the checkout pending until the user dismisses it.

A local cancellation dismisses checkout tracking, not an actual provider payment or refund. A later genuine verified success can still settle and grant purchased credits exactly once. Client return status cannot grant credits. Provider verification must match tx_ref, currency, sufficient finite amount and transaction ID. Verified failed/cancelled notifications cannot overwrite a successful payment. Provider-pending notifications cannot reactivate a locally cancelled checkout. Frozen purchase credits/amounts remain unchanged.

Tests use local MongoDB and mocked provider verification only, not real money or fabricated production payment success. Coverage includes ownership, CSRF, idempotent cancellation, failed attempts, late success, duplicate callbacks, wrong signature and transaction mismatches. Existing atomic purchase ledger remains the single wallet mutation path.
