# LaunchBrief

A Volcano app that turns a signed-in user's product idea into a saved launch brief. Each initial prompt and follow-up costs one credit. An optional PPT deck costs one additional credit. Stripe Checkout sells credit packs, and a signed Stripe webhook grants credits only after payment. The OpenAI SDK writes the brief and requests a Trellini task through the standalone MCP server for each prompt.

## What is built

- Volcano Auth email/password sign up, sign in, sign out, and password reset request.
- Owner-scoped Volcano Database records for ideas, conversation turns, and individual credits. Browser sessions can read their own rows through RLS; server Functions make the writes.
- Briefs with customer problem, positioning, a small MVP scope, and research notes clearly labeled as model assumptions. The agent has no web research tool and cannot assert external sources.
- A saved progress/status record and owner-only Trellini card ID for each prompt. Trellini card notes link back to the LaunchBrief idea.
- A private five-slide PPT file in Volcano Storage, downloadable by its owner.
- Stripe hosted Checkout and idempotent credit fulfillment for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. A signed webhook checks the purchased Price and quantity before granting credits.

## Configuration

The root `.env.example` lists every environment field without real credentials. For local development, copy `volcano/volcano.env.example` to the ignored `volcano/volcano.env` and `web/.env.example` to the ignored `web/.env.local`; replace placeholders. `NEXT_PUBLIC_*` values are public browser settings; all other keys are server-only. Supply:

| Value | Purpose |
| --- | --- |
| `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, `VOLCANO_SERVICE_KEY`, `VOLCANO_DATABASE` | Volcano Functions and database; service key stays server-only. |
| `NEXT_PUBLIC_VOLCANO_API_URL`, `NEXT_PUBLIC_VOLCANO_ANON_KEY`, `NEXT_PUBLIC_VOLCANO_DATABASE` | Browser Volcano client. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Server-side OpenAI SDK key and model. The default model is `gpt-5-mini`. |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible proxy endpoint. The proxy operator must implement the Responses API, including function calling and structured outputs. |
| `TRELLINI_API_URL`, `TRELLINI_SERVICE_KEY`, `TRELLINI_DATABASE` | Trellini project API URL, server-only service key, and database name (`trellini` by default). |
| `TRELLINI_BOARD_ID`, `TRELLINI_COLUMN_ID` | Existing Trellini board and destination column UUIDs. |
| `TRELLINI_CARD_URL_TEMPLATE` | Optional verified task deep link with `{board_id}` and `{card_id}` placeholders. Trellini currently establishes `/board/{board_id}` but does not establish a card deep-link contract. |
| `APP_BASE_URL` | LaunchBrief origin for Checkout redirects and the link placed in Trellini card notes. |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CREDITS_PER_PACK` | One-time credit-pack Price, webhook verification secret, and pack size. |

LaunchBrief uses a compiled snapshot of Trellini's existing standalone MCP server, launched over stdio by the MCP client. That server accepts a Trellini project service key and checks its target board's legacy organization before writes. LaunchBrief additionally checks that the configured column belongs to the configured board. OpenAI is offered only a zero-argument `create_card` function; after exactly one valid request, LaunchBrief calls the MCP tool once with server-supplied fields and validates its returned card ID. The service key bypasses Trellini RLS, so it must stay server-side. The separately deployed HTTP MCP Function still requires a signed-in user bearer token; a live service-key initialize probe returned 401 there. No Trellini password is needed by LaunchBrief.

## Build validation

```sh
npm install
npm --prefix volcano/functions install
npm run build
npm test
```

The server needs outbound access to OpenAI, Trellini, and Stripe, and the Volcano Function runtime must support the Trellini MCP child process. Live OpenAI execution needs usable API credits, and paid Checkout remains unverified until its credentials are configured.

## Local run and deployment steps

When ready to exercise the app locally, follow the Volcano CLI flow: `volcano start`, `volcano variables deploy`, `volcano functions deploy --all`, `volcano config deploy`, `volcano migrations deploy --all -d app`, and `volcano storage bucket create launchbrief-decks --allowed-mime-type application/vnd.openxmlformats-officedocument.presentationml.presentation`. Then run `npm run dev` for the frontend. Create the private bucket before using the PPT action; the bucket's default owner policies govern download access. Configure Stripe's webhook endpoint to the deployed `stripe-webhook` HTTP Function URL, subscribing to the two Checkout events above. Use the URL reported by Volcano after deployment; no endpoint URL is assumed in this repo.

The configured `STRIPE_PRICE_ID` must represent the entire `CREDITS_PER_PACK` pack as one line item; the app does not calculate prices itself. Missing external credentials leave brief generation and Checkout unavailable without creating charges.

## Staging deployment (2026-09-24)

- LaunchBrief project `ca20b9da-464f-4202-9513-bf3e52c2b1c4`: [app](https://eff19528-a1be-4397-a099-bf3729dd275e.frontends.staging.volcano.run/), [Stripe webhook](https://4812dc37-48e4-4c32-b7dd-f56be9f7341f.functions.staging.volcano.run/). Database `app`, private `launchbrief-decks` bucket, four Functions, and email signup without confirmation are deployed.
- Separate Trellini project `53754e67-b4cd-49fb-be63-6928b86f4887`: [board app](https://a922367c-c26d-43b0-8a86-c2e70d6bd856.frontends.staging.volcano.run/), [public board view](https://2978473f-edd5-441c-bcdf-b23c3724f122.frontends.staging.volcano.run/), [MCP endpoint](https://6213366b-acbd-4392-964e-2f1f2e3051fd.functions.staging.volcano.run/). Its source repository was not edited.
- Its private `LaunchBrief tasks` board is `b1909bd4-1c07-4d32-b1cc-c98cfece1bcd`; its `Incoming ideas` column is `0b045138-332e-4d62-9c92-0633cb7562c0`.
- The previous Claude version generated an assumption-labeled brief and created a labeled Trellini test card (`c1aae829-04e5-4fdb-bd4e-c8e5dc523428`). The OpenAI migration passes local tests and build; a direct OpenAI brief request returned HTTP 429 because the supplied key has no API credits remaining, so live OpenAI output and the new MCP bridge remain unverified. To enable purchases, set the Stripe variables, register the webhook URL with Stripe for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then verify a paid test Checkout and credit grant. The complete credit, persistence, and PPT flow has not yet been exercised in the deployed app.

## Known integration boundaries

- Trellini's standalone MCP `create_card` schema is confirmed in `../trellini/mcp/src/index.ts`: `column_id`, `title`, optional `notes`, `priority`, and `labels`. The compiled snapshot in `volcano/functions/_shared/trellini-mcp/` comes from Trellini commit `b83bb184d7ca37f7693f55410adf60766d55f73c`. LaunchBrief supplies the card fields directly to the MCP tool and requires an actual tool result with a UUID before storing a task ID. No Trellini files are changed.
- Trellini has no confirmed card deep-link URL. The card ID remains available to the owner, and each card's notes link to its LaunchBrief idea. End users do not receive Trellini links.
- The current brief notes are model assumptions. External research needs a source provider and source-verification contract before sourced findings can be shown.
- The brief generation Function waits for OpenAI and Trellini in one request. The app saves progress and results, but a production deployment needs a measured function timeout and may need a durable runner if agent execution exceeds it.
