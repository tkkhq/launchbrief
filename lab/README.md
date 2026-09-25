# LaunchBrief lab

This directory contains materials for a hands-on Volcano lab. Participants deploy Trellini in one Volcano project, then use the CLI to deploy LaunchBrief in a second project.

- [Participant guide](participant-guide.md) — the nine exercise steps and checkpoints.
- [Facilitator notes](facilitator-notes.md) — preparation, timing, handout values, and recovery paths.
- [Clean LaunchBrief environment template](launchbrief.env.example) — copy to the gitignored repository-root `.env.cloud`.
- [Environment checker](scripts/check-env.mjs) — read-only; validates names and values without printing secrets.
- [Trellini target finder](scripts/list-trellini-targets.mjs) — read-only; lists board and column IDs from the participant's Trellini project.

The Trellini one-click deployment in step 2 is **not implemented yet**. The facilitator notes define the minimum result it must provide and a manual fallback. Do not publish a participant guide with a made-up deployment URL or claim the one-click path has been verified.

Stripe is outside the core lab. Set `LAUNCHBRIEF_CREDIT_GATE_ENABLED=false` so signed-in participants can test brief, follow-up, and PPT creation without buying credits. Model calls still require a working credential. The separate [deployment runbook](../docs/deployment-runbook.md) covers optional paid-mode setup and ongoing operations.

Before sharing edits to these materials, run `node --test lab/tests/*.test.mjs` from the repository root. The helper scripts do not deploy or modify cloud resources.
