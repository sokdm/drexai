# Chat responsiveness and rendering

The shared research/Studio chat clears its composer on Send, uses a compact icon button and independently scrolling messages, and removes the permission checkboxes. Explicit editing requests still pass backend ownership and permission checks. Larger paid creation requests still require approval.

Fast chat attempts a verified free model with an eight-second response deadline. Before any text has arrived, quota exhaustion or a recoverable failure can use the approved paid fallback. The existing wallet reserves at most one credit; all-free usage is reconciled to zero, and failures retain existing refund handling. Published model costs must fit the one-credit ceiling. Plain conversation skips the research planning call. Partially emitted or ambiguous paid requests are never automatically replayed.

With RENDER_QUEUE_ENABLED=true and valid R2 storage, the web service can process existing export jobs serially when no dedicated FFmpeg worker is online. Readiness is published only after the installed FFmpeg capabilities are verified. Dedicated workers remain preferred, and the existing durable job leases and billing workflow are reused.

Verification uses mocked provider responses, isolated MongoDB, actual local FFmpeg capability checks, and mobile/desktop browser tests. No paid provider generation was run. External provider availability, invalid credentials, and resource exhaustion can still cause real errors.
