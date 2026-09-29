# LaunchBrief lab

This directory contains materials for a hands-on Volcano lab. Participants deploy Trellini in one Volcano project, then use the CLI to deploy LaunchBrief in a second project.

- [Participant guide](participant-guide.md) — the nine exercise steps and checkpoints.
- [Facilitator notes](facilitator-notes.md) — preparation, timing, handout values, and recovery paths.
- [Clean LaunchBrief environment template](launchbrief.env.example) — copy to the gitignored repository-root `.env.cloud`.
- [Environment checker](scripts/check-env.mjs) — read-only; validates names and values without printing secrets.
- [Trellini target finder](scripts/list-trellini-targets.mjs) — read-only; lists board and column IDs from the participant's Trellini project.

In staging, step 2 uses Volcano's **Kanban board** template to install Trellini into each participant's first project. Participants redeem their one-month Pro coupon before creating projects, wait for template installation to show **Ready**, and create their own Trellini board and destination column. The facilitator supplies the actual staging dashboard link and coupon instructions in the handout.

Stripe is outside the core lab. Set `LAUNCHBRIEF_CREDIT_GATE_ENABLED=false` so signed-in participants can test brief, follow-up, and PPT creation without buying credits. Model calls still require a working credential. The separate [deployment runbook](../docs/deployment-runbook.md) covers optional paid-mode setup and ongoing operations.

Before sharing edits to these materials, run `node --test lab/tests/*.test.mjs` from the repository root. The helper scripts do not deploy or modify cloud resources.
