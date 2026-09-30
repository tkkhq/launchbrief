# LaunchBrief lab

A 90-minute lab using a Free Volcano account: each participant creates **one LaunchBrief project with one `web` frontend**. Trellini is already deployed by the facilitator at [trellini.volcano.run](https://trellini.volcano.run). Participants sign up there and watch their LaunchBrief requests appear on the shared board. No Pro coupon or participant Trellini deployment is needed.

- [Lab handout](handout.md) — known board website and fields the facilitator must supply.
- [Environment template](../.env.example) — copy to the gitignored `.env` in the repository root.
- [Environment checker](scripts/check-env.mjs) — validates required fields without printing secrets.
- [Trellini target finder](scripts/list-trellini-targets.mjs) — connects to hosted MCP using the participant's token; reads visible board/column IDs without writing cards.

The facilitator distributes participant instructions separately.

LaunchBrief uses `TRELLINI_MCP_TRANSPORT=http` in the lab. Each participant supplies their own Trellini session token in `TRELLINI_ACCESS_TOKEN`, plus the confirmed MCP endpoint and shared destination IDs. The website URL does not establish the MCP endpoint. The instructor's Trellini service key is never distributed. Existing owner-operated deployments can continue using the default `stdio` mode.

Prompts posted to Trellini are visible to everyone on the shared board. Use sample ideas suitable for group sharing. Existing Trellini permissions allow collaboration, including editing; the board is not an observer-only view. LaunchBrief's saved briefs, conversations, and decks remain scoped to users in each participant's instance.

The lab uses `LAUNCHBRIEF_CREDIT_GATE_ENABLED=true`. Each idea, follow-up, and PPT creation costs one credit. Configure Stripe test-mode Checkout and the deployed webhook in each LaunchBrief instance, then buy one five-credit test pack before exercising generation. The idea, follow-up, and PPT spend three credits, leaving two for additional exercises. Credits are not seeded automatically. The environment checker requires Checkout values before deployment and the webhook signing secret for its ready check. Model calls also need authorized model access; the repository does not supply an instructor model proxy.

The facilitator must verify hosted MCP access with a newly registered Trellini user before the session, including live board updates and the actual session-token lifetime. Runtime tokens are copied credentials, not automatically refreshed by LaunchBrief.

Before sharing changes, run `npm test`, `node --test lab/tests/*.test.mjs`, and `git diff --check`. Helpers make read-only network calls when explicitly run; they do not deploy resources.
