# Script review handoff and result layout

The saved-project chat card was rendered from an ID-only conversation reference and always displayed draft instructions. It now loads the owned saved project, refreshes on focus and displays actual approval state. Its grid gives text a usable full-width column with links below.

Script Builder now checks the returned approval before continuing. The backend refuses Studio continuation for missing, unapproved, empty or partial projects. On return, Studio automatically prepares a non-billable plan for the approved project using its requested duration, then opens that exact production. Media generation still requires credit approval. Failed preparation retains the approved project and the existing manual retry action.

Scene results use bordered cards, aligned title/duration headers, a responsive field grid, content-sized text areas and grouped footer actions. Script/Scenes/Dialogue/Prompts tabs, editing, reordering, versions and all existing generation approvals remain connected.

Verification: backend approval persistence and unapproved-continuation guard tested with isolated MongoDB; browser review-to-plan flow at 390px and 1440px; existing script editing, quote approval, activity scrolling and wallet-link regressions at both widths; production build and frontend TypeScript check. No paid provider calls or production database changes.
