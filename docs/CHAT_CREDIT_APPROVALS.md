# In-chat credit approvals

AI Studio reuses existing Script Builder jobs, Studio production steps, pricing quotes, wallet reservations, progressive settlement and Redis workers. No additional wallet or pricing engine is introduced.

Script creation approval is persisted on AgentTask. It shows the model, requested scenes, credit quote, wallet balance, activity and reservation status, and supports Reject. Rejected tasks cannot start generation or reserve credits.

Production cards are persisted in CreditApproval. The chat offers the next group of same-model operations (images, narration or videos with native audio), plus an entire remaining production budget. Website credit amounts come from the existing priced production steps and render quote. Public card payloads omit provider costs, margins and private pricing settings.

Approval uses a MongoDB transaction and idempotent reservation keyed by approval ID. A server-stored digest binds the record to the production snapshot, selected inputs, models, quantities and credit ceilings. The worker verifies this binding before provider requests and pauses at the first operation outside the approved scope. Repeated clicks cannot create additional deductions. An entire budget authorizes only its frozen included steps and rendering, not future regenerations.

Completed outputs settle individually. Failed card operations release unused reserve and preserve successful outputs. A subsequent production budget excludes already completed outputs. MP4 rendering requires inclusion in an approved entire remaining budget. The export job reuses that same reserve. Uncertain provider requests retain existing needs-review protections and are never automatically resubmitted by an approval card.

Reject reserves nothing and skips the named operation. Rejecting source images also skips dependent video operations. Rejection is saved in the conversation when a conversation is linked, and in production activity. Users can ask the agent for a revised plan. Other operations remain unapproved.

Reload restores cards by the owned production ID and script tasks by conversation. Cards show progress, scoped activity, live available credits, reservation state and ledger-backed settled credits. Existing infrastructure readiness, feature controls, script review, provider spending limits, authentication and CSRF checks still apply.

Non-billable validation uses isolated MongoDB, mocked media providers and mocked browser APIs. No production balances or paid provider generation are used. Approval jobs use distinct queued/running states that older workers cannot claim, preventing an outdated worker from bypassing scoped authorization during a rolling deploy. Deploy the application and Studio workers from the same commit; no additional environment variables are required.
