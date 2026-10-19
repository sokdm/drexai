# Approved script card and approval-state recovery

The saved script banner is now rendered only for loaded, unapproved projects. Approved scripts remain saved and accessible through the project workspace and Script Builder without a persistent green banner.

Approval errors previously passed through generic assistant error redaction. Known approval-state failures now carry a specific safe code and preserve their actionable state message. Unknown approval failures do not claim the wallet was uncharged. If a decision response fails, the UI reads the persistent approval status before suggesting another attempt; an accepted decision followed by a progress-fetch failure is explicitly reported as accepted. Retry connection handles its rejection instead of producing an unhandled promise.

Before authorizing the next operation, the transaction reconciles a previous approved record whose reservation has already closed. A genuinely reserved record continues to block overlapping spending. Duplicate approvals remain idempotent.

The screenshot alone does not establish the original server exception. These fixes cover verified error-handling/state defects; production logs are needed to distinguish a reservation conflict, expiry, queue outage or other failure for that historical attempt. Existing assets, wallet balances and historical transactions are unchanged.

At the user's stated packages, 3,000 credits has purchase value $54 (5,000/$90) to $60 (1,000/$20). Under default markup 3, payment fee 3%, zero extra fees/overhead, and the cheapest package, 3,000 credits corresponds approximately to $17.46 protected variable cost. It is not a fixed OpenRouter exchange rate. Per-step rounding, minimum charges, admin changes and overhead change the actual provider share; only recorded provider usage establishes actual expenditure.

Verification: 3 backend tests cover closed versus active reservations, duplicate approval protection and the credit conversion calculation. Browser regressions cover approving/rejecting, a lost decision response, refresh persistence and hiding the approved script card at 390px and 1440px. Production build and frontend TypeScript check passed. Provider responses were mocked; no paid API tests or production wallet adjustments.
