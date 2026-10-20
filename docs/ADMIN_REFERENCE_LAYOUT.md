# Reference-style admin layout

Existing admin functionality is retained: users, wallets, projects, finance, packages, pricing, models/providers, queues/jobs, assets, support, feedback, feature controls, notifications, email, alerts, health and audit. Overview detailed metrics remain accessible through a collapsible disclosure.

Updated styling uses near-black panels, compact fixed-width desktop navigation, purple chart accents, an active navigation highlight, four summary cards, an interactive business-activity chart and verified recent-sales panel. Phone layout stacks charts and sales with two summary cards per row and existing mobile navigation. Chart tabs expose revenue, consumed credits and estimated AI cost. Hover, focus and click select actual date values. CSV exports recorded selected-period daily data.

Backend recent sales are selected from successful recorded payments in the requested date range, enriched with actual stored customer names/emails under existing admin authorization. Pending/failed payments are excluded. Mixed currencies are never combined into a dollar value. Empty states remain explicit. No visitor counts, arbitrary trends or fabricated revenue are added.

Validation: backend/frontend builds and frontend TypeScript passed. An independent MongoDB recent-sales test passed. Two browser tests at 390px and 1440px passed for chart interaction, CSV download, navigation and existing audited package/provider/wallet/maintenance actions; screenshots reviewed. A prior isolated legacy admin test required earlier-suite fixture setup and was replaced for this check by the independent reporting test. Initial browser preview connection failure was resolved by restarting the local preview before the successful run. No paid provider calls or payment transactions were made.

Payment-method note: the existing Flutterwave server verification uses transaction reference, amount and currency independently of method. This applies to transfer when Flutterwave offers it for the configured checkout currency. No unverified transfer claim or receipt can grant credits.
