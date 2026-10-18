# Durable AI Studio story tools

Verified code defects: the chat planner was framed as YouTube research, ordinary story requests did not call Script Builder, and successful tool evidence was only committed with the final summary. A later model failure could therefore leave an empty project and no recoverable tool record. The local logs did not establish the exact Render incident response; deployment diagnostics are still needed to attribute that specific outage.

Story intent now creates an owned, idempotent MongoDB AgentTask with validated Script Builder settings and an existing-engine creation quote. Approval atomically reserves the existing wallet and queues the existing durable ScriptJob. Saved scene records populate the same Studio project and storyboard. A production plan is prepared from those real scenes; media cannot start until the script has been reviewed and its generation budget approved.

Sending chat remains free within the existing shared four-hour allowance. Script creation and revision are billable tools, including when their provider model is free. Image/video tools retain their existing approved pricing. No separate wallet was introduced. Failed script tasks release their reserve; continuation quotes only unfinished stages. Completed script work is not repeated or charged again when media-plan preparation fails.

Tool results are saved before the final reply and displayed in collapsible chat activity. Provider diagnostics log stage, identifiers, status and finish reason without prompts, keys or response bodies. Tasks and conversations restore after reconnecting. Explicitly rejected requests can be retried; ambiguous provider timeouts require review instead of blindly repeating potentially billable work. A paid model option only prepares a quote and requires approval.

Deployment: update the web service and existing workers to the same commit. No additional environment variables or Redis service are required. The web process starts the existing script worker and the new task coordinator; media/render workers remain required for their respective generation tools.

Validation uses isolated MongoDB, mocked provider responses and browser API fixtures. It does not call paid generation APIs or change production wallet balances. The 272-credit wallet is a test fixture, not a live balance audit.
