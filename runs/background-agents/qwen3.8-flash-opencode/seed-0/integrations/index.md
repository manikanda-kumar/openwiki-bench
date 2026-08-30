# Files

- [GitHub Bot and Autofix](github-bot.md) - The GitHub webhook worker — signature verification, redelivery-safe dedupe, PR review and @mention sessions with permission gating and default-environment targets — plus the PR-feedback autofix pipeline through a Durable Queue into control-plane session admission.
- [Linear Bot Integration](linear-bot.md) - The Linear agent worker — AgentSessionEvent webhook handling, the five-stage repo/environment resolution ladder, issue→session KV continuity with follow-ups, activity-streaming callbacks, and OAuth installation with a bot-key fallback.
- [Slack Bot Integration](slack-bot.md) - The Slack worker — signature-verified event ingress with best-effort KV dedupe, the deterministic-first classifier ladder targeting repos or environments, image and forwarded-message attachment handling, thread-session continuity, and HMAC completion callbacks delivered through a Durable Queue with a NO_REPLY decline policy.
