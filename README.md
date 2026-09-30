# LaunchBrief

LaunchBrief turns a product idea into a short, saved launch brief. A signed-in user can write one free-text description or use guided fields for product name, description, target customer, category, and an optional goal or constraint. In free-text mode, TanStack AI organizes the prompt into those fields before the normal briefing workflow begins. The app shows progress, then returns research notes and a recommendation covering the customer problem, positioning, and a small MVP scope. Users can revisit prior ideas, ask follow-up questions, and create a PowerPoint deck from any completed brief.

Research notes are labeled as **model-generated assumptions**. LaunchBrief does not currently use an external research source, so it does not present those notes as sourced findings or invent citations.

## How it works

| Action | Cost | Result |
| --- | ---: | --- |
| Submit an idea by either input mode | 1 credit | Saved brief and Trellini task |
| Send a follow-up | 1 credit | New saved brief in the same idea history and a Trellini task |
| Create a PPT deck | 1 credit | Five-slide `.pptx` saved for download |

The costs above apply when the credit gate is enabled. By default, users buy credit packs through Stripe Checkout. A signed Stripe webhook grants credits after payment. Credits are not seeded automatically. For testing before Stripe is configured, set the server-side `LAUNCHBRIEF_CREDIT_GATE_ENABLED=false`: signed-in users can create briefs, follow-ups, and decks without credits. The app hides Checkout while this mode is active. Set the flag to `true` (or remove it) to restore credit charging. Test mode applies to every signed-in LaunchBrief user and still uses the configured Anthropic API key.

The app uses Next.js for the interface and Volcano Auth, Database, Functions, and Storage for user accounts and saved work. Server-side Functions use TanStack AI with its Anthropic adapter to write briefs and record each prompt through Trellini MCP. Owner-operated deployments use the bundled stdio server with a Trellini service key; the shared-board lab uses hosted MCP with each participant's Trellini user session token. Ordinary LaunchBrief end users do not need Trellini accounts; lab participants sign up on the shared board to supply their connection token and watch tasks. The MCP snapshot bundled with LaunchBrief is described in [its provenance file](volcano/functions/_shared/trellini-mcp/PROVENANCE.md).

The free-text path preserves the user's original wording in the saved conversation and Trellini task. The organized product fields are a working interpretation, especially when the prompt leaves a customer or category unspecified. Both input modes cost the same one credit when the credit gate is enabled; free-text organization does not add a charge.

## Requirements

- Node.js and npm, plus the Volcano CLI and a Volcano project.
- Access to a Trellini board and destination column: either a hosted MCP endpoint and your Trellini user session token, or an owner-operated project service key for stdio MCP.
- An Anthropic API key with usable API credits.
- For credit purchases, a Stripe account, a one-time credit-pack Price, and a webhook signing secret.

## Configure the app

Install the frontend and Function dependencies:

```sh
npm ci
npm ci --prefix volcano/functions
```

Copy the environment templates and fill in their values:

```sh
cp .env.example .env
cp web/.env.example web/.env.local
```

[`.env.example`](.env.example) contains the standard setup with a production API URL and the shared-board HTTP MCP connection. Set `APP_BASE_URL` to your deployed LaunchBrief frontend origin and replace the Trellini IDs for your target board and column. Keep populated environment files and service keys out of Git. `NEXT_PUBLIC_*` values are browser-visible; model API keys and service keys belong in Volcano's server-side variables.

Functions and the Next.js browser build share `NEXT_PUBLIC_VOLCANO_API_URL` and `NEXT_PUBLIC_VOLCANO_ANON_KEY`. Set the latter to your LaunchBrief project anon key. The anon key is public and access is governed by user authentication and database policies. Never put `VOLCANO_SERVICE_KEY` in a `NEXT_PUBLIC_*` variable. Remove the old `VOLCANO_API_URL` and `VOLCANO_ANON_KEY` entries from your LaunchBrief environment. The templates in `web/.env.example` and `volcano/volcano.env.example` use localhost for local development; replace those URLs and keys when deploying to production.

Store Stripe credentials with the other server settings in the root `.env`. The lab helpers read this file; CLI deployment uses `--file .env` to populate project variables. Hosted Functions read those variables through `process.env`. If you already have a populated `.env`, edit it instead of copying over it.

| Variables | Use |
| --- | --- |
| `VOLCANO_SERVICE_KEY`, `VOLCANO_DATABASE` | Server access to LaunchBrief's database. Keep the service key server-side. |
| `NEXT_PUBLIC_VOLCANO_API_URL`, `NEXT_PUBLIC_VOLCANO_ANON_KEY`, `NEXT_PUBLIC_VOLCANO_DATABASE` | Shared API URL and anon key for Functions and the browser; database name for the browser. |
| `APP_BASE_URL` | LaunchBrief's public origin for Checkout redirects and links in Trellini task notes. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Brief generation and Trellini tool requests through TanStack AI. The default model is `claude-sonnet-5.5`. |
| `ANTHROPIC_BASE_URL` | Optional Anthropic-compatible proxy endpoint. It must support Messages API tool calls and structured outputs. |
| `ANTHROPIC_WORKSPACE_ID` | Required with the lab API key. Functions send this value in the `anthropic-workspace-id` header. Keep it in server-side variables. |
| `LAUNCHBRIEF_CREDIT_GATE_ENABLED` | Server-side credit gate. Defaults to enabled; only `false` bypasses credit spending for signed-in users. The browser reads the mode from the private `credit-mode` Function. |
| `TRELLINI_MCP_TRANSPORT` | `http` for shared hosted MCP; defaults to `stdio` for the bundled server. |
| `TRELLINI_MCP_URL`, `TRELLINI_ACCESS_TOKEN` | Required in HTTP mode: confirmed HTTPS MCP endpoint and your own Trellini session token. Keep the token server-side; replace and redeploy variables when expired. |
| `TRELLINI_API_URL`, `TRELLINI_SERVICE_KEY`, `TRELLINI_DATABASE` | Required only in stdio mode: owner-operated Trellini project API, service key, and database (`trellini` by default). |
| `TRELLINI_BOARD_ID`, `TRELLINI_COLUMN_ID` | Destination board and column UUIDs in Trellini. |
| `TRELLINI_CARD_URL_TEMPLATE` | Optional verified card link pattern using `{board_id}` and `{card_id}`. Leave empty without a confirmed deep-link format. |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CREDITS_PER_PACK` | Needed in paid mode for Stripe Checkout, webhook verification, and the number of credits granted by one purchased pack. |

For the shared-board lab, omit `TRELLINI_SERVICE_KEY`, `TRELLINI_API_URL`, and `TRELLINI_DATABASE`. `TRELLINI_SERVICE_KEY` is a privileged key for the separate Trellini project, used only by the bundled stdio connector. The main template omits the optional proxy URL and custom card-link settings listed above; the lab requires `ANTHROPIC_WORKSPACE_ID`. `VOLCANO_SERVICE_KEY` is still required for LaunchBrief's backend, including credit operations and webhook processing.

HTTP mode uses Trellini's existing user permissions; stdio mode uses a privileged Trellini service key. LaunchBrief checks the configured board/column relationship, supplies the card fields, and saves a task ID only when MCP returns a valid UUID. Keep credentials in the Function environment. Shared-board prompts are visible to everyone with access to that board. A copied HTTP session token is not automatically refreshed.

## Run locally

From the repository root, start Volcano and deploy the local resources:

```sh
volcano start
volcano variables deploy --file .env
volcano functions deploy --all
volcano config deploy
volcano migrations deploy --all -d app
volcano storage bucket create launchbrief-decks --allowed-mime-type application/vnd.openxmlformats-officedocument.presentationml.presentation
npm run dev
```

Open `http://localhost:3000`. The migrations create the idea, conversation, and credit tables with owner-scoped read policies. The Volcano CLI does not track applied migrations, so run the full migration set only against a fresh database. The deck bucket must be private and available before using the PPT action.

For Stripe purchases, point a Stripe webhook at the deployed `stripe-webhook` HTTP Function URL and subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Set `STRIPE_WEBHOOK_SECRET` from that endpoint. `STRIPE_PRICE_ID` must identify one whole credit pack; `CREDITS_PER_PACK` is the number of credits granted for that single line item. Complete a test purchase and confirm the credit balance before using paid flows. To test without Stripe, set `LAUNCHBRIEF_CREDIT_GATE_ENABLED=false` in the server variables and deploy them; brief, follow-up, and deck actions do not spend credits in this mode.

## Deploy

Use the [deployment runbook](docs/deployment-runbook.md) for a fresh Volcano project or a lab instance. It covers the separate Trellini prerequisite, cloud migration command, private variables, deployment order, no-credit testing, optional Stripe setup, and acceptance checks.

For a guided workshop, use the [lab materials](lab/README.md), including the participant guide, clean environment template, and read-only setup helpers. Each participant uses a Free account with one LaunchBrief project and one frontend, and joins the instructor-owned board at [trellini.volcano.run](https://trellini.volcano.run).

## Validate changes

```sh
npm test
npm run build
```

The tests cover credit spending and refund behavior, Stripe webhook validation, idea normalization, the Trellini task-call guard, and hosted MCP authentication and target validation. Lab-helper tests run separately with `node --test lab/tests/*.test.mjs`. The current research notes remain assumptions until an external source provider and a source-verification contract are added. Free-text briefing adds an Anthropic organization call before task tracking and brief writing, all within one Function request; production use should measure its execution time and use a durable runner if it exceeds the Function limit.
