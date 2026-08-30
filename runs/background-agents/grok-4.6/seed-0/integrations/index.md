# Files

- [Automations and Inbound Triggers](automations.md) - Scheduled and event-driven automations that spawn coding sessions from D1-backed cron ticks, inbound webhooks, Sentry, Slack, and GitHub events, including fan-out, recovery, and auto-pause.
- [GitHub Bot and Autofix](github.md) - GitHub App webhook worker for PR auto-review, reviewer requests, @mention sessions, delivery dedupe, default-environment targeting, and Autofix queue ingress into the control plane.
- [Linear Bot](linear.md) - Linear AgentSessionEvent webhooks, OAuth app-actor install, team/project target mappings including environmentId, session start and follow-up, and signed completion callbacks back into Linear.
- [Slack Bot](slack.md) - Slack Events API worker that maps threads to coding sessions, classifies repository or environment targets, forwards attachments, and posts completion replies through a queue.
