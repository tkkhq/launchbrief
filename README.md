# LaunchBrief

A Volcano app that turns a signed-in user's product idea into a saved launch brief. Each initial prompt and follow-up costs one credit. An optional PPT deck costs one additional credit. Stripe Checkout sells credit packs, and a signed Stripe webhook grants credits only after payment. Claude Agent SDK writes the brief and uses Trellini's hosted MCP `create_card` tool to record each prompt.

## What is built

- Volcano Auth email/password sign up, sign in, sign out, and password reset request.
- Owner-scoped Volcano Database records for ideas, conversation turns, and individual credits. Browser sessions can read their own rows through RLS; server Functions make the writes.
- Briefs with customer problem, positioning, a small MVP scope, and research notes clearly labeled as model assumptions. The agent has no web research tool and cannot assert external sources.
- A saved progress/status record and Trellini card ID for each prompt; optional task URL when a verified deep-link template is configured.
- A private five-slide PPT file in Volcano Storage, downloadable by its owner.
- Stripe hosted Checkout and idempotent credit fulfillment for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. A signed webhook checks the purchased Price and quantity before granting credits.

## Configuration

Copy `volcano/volcano.env.example` to the ignored `volcano/volcano.env`; replace placeholders. Copy `web/.env.example` to the ignored `web/.env.local` for local frontend development. `NEXT_PUBLIC_*` values are public browser settings; all other keys are server-only. Supply:

| Value | Purpose |
| --- | --- |
| `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, `VOLCANO_SERVICE_KEY`, `VOLCANO_DATABASE` | Volcano Functions and database; service key stays server-only. |
| `NEXT_PUBLIC_VOLCANO_API_URL`, `NEXT_PUBLIC_VOLCANO_ANON_KEY`, `NEXT_PUBLIC_VOLCANO_DATABASE` | Browser Volcano client. |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Claude Agent SDK. The default model is `claude-sonnet-4-6`. |
| `TRELLINI_MCP_URL`, `TRELLINI_MCP_TOKEN` | Full hosted Streamable HTTP MCP endpoint and a Trellini authenticated user bearer token with board access. |
| `TRELLINI_BOARD_ID`, `TRELLINI_COLUMN_ID` | Existing Trellini board and destination column UUIDs. |
| `TRELLINI_CARD_URL_TEMPLATE` | Optional verified task deep link with `{board_id}` and `{card_id}` placeholders. Trellini currently establishes `/board/{board_id}` but does not establish a card deep-link contract. |
| `APP_BASE_URL` | LaunchBrief origin for Checkout redirects and the link placed in Trellini card notes. |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CREDITS_PER_PACK` | One-time credit-pack Price, webhook verification secret, and pack size. |

The Trellini HTTP MCP function reads the caller's bearer token from Volcano auth and runs its database queries as that caller. A LaunchBrief user session is not a substitute for a Trellini session. Provision and rotate the Trellini token outside the app; no refresh contract exists in the repository.

## Build validation

```sh
npm install
npm --prefix volcano/functions install
npm run build
npm test
```

This request is build-only, so local services, migrations, function invocations, Stripe charges, and cloud deployment have not been run. The server needs outbound access to Anthropic, Trellini, and Stripe, and the Volcano Function runtime must support the Claude Agent SDK child process. Confirm this with a local stack before production use.

## Local run and deployment steps

When ready to exercise the app locally, follow the Volcano CLI flow: `volcano start`, `volcano variables deploy`, `volcano functions deploy --all`, `volcano config deploy`, `volcano migrations deploy --all -d app`, and `volcano storage bucket create launchbrief-decks --allowed-mime-type application/vnd.openxmlformats-officedocument.presentationml.presentation`. Then run `npm run dev` for the frontend. Create the private bucket before using the PPT action; the bucket's default owner policies govern download access. Configure Stripe's webhook endpoint to the deployed `stripe-webhook` HTTP Function URL, subscribing to the two Checkout events above. Use the URL reported by Volcano after deployment; no endpoint URL is assumed in this repo.

Cloud deploy requires an authenticated Volcano project and explicit approval. Deploy server variables, Functions, configuration, migrations, the storage bucket, and the frontend only after the IDs and secrets above are available. The configured `STRIPE_PRICE_ID` must represent the entire `CREDITS_PER_PACK` pack as one line item; the app does not calculate prices itself.

## Known integration boundaries

- Trellini's hosted MCP `create_card` schema is confirmed in `../trellini/volcano/functions/mcp-server.js`: `board_id`, `column_id`, `title`, optional `notes` and `priority`. LaunchBrief requires an actual tool result with a UUID before storing a task ID. No Trellini files are changed.
- Trellini has no confirmed card deep-link URL. A card ID is retained, but a task link is shown only after a working `TRELLINI_CARD_URL_TEMPLATE` is supplied.
- The current brief notes are model assumptions. External research needs a source provider and source-verification contract before sourced findings can be shown.
- The brief generation Function waits for Claude and Trellini in one request. The app saves progress and results, but a production deployment needs a measured function timeout and may need a durable runner if agent execution exceeds it.
