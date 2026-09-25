# LaunchBrief

LaunchBrief turns a product idea into a short, saved launch brief. A signed-in user enters a product name, description, target customer, category, and optional goal or constraint. The app shows progress, then returns research notes and a recommendation covering the customer problem, positioning, and a small MVP scope. Users can revisit prior ideas, ask follow-up questions, and create a PowerPoint deck from any completed brief.

Research notes are labeled as **model-generated assumptions**. LaunchBrief does not currently use an external research source, so it does not present those notes as sourced findings or invent citations.

## How it works

| Action | Cost | Result |
| --- | ---: | --- |
| Submit an idea | 1 credit | Saved brief and Trellini task |
| Send a follow-up | 1 credit | New saved brief in the same idea history and a Trellini task |
| Create a PPT deck | 1 credit | Five-slide `.pptx` saved for download |

The costs above apply when the credit gate is enabled. By default, users buy credit packs through Stripe Checkout. A signed Stripe webhook grants credits after payment. Credits are not seeded automatically. For testing before Stripe is configured, set the server-side `LAUNCHBRIEF_CREDIT_GATE_ENABLED=false`: signed-in users can create briefs, follow-ups, and decks without credits. The app hides Checkout while this mode is active. Set the flag to `true` (or remove it) to restore credit charging. Test mode applies to every signed-in LaunchBrief user and still uses the configured Anthropic API key.

The app uses Next.js for the interface and Volcano Auth, Database, Functions, and Storage for user accounts and saved work. Server-side Functions use TanStack AI with its Anthropic adapter to write briefs and use Trellini's standalone MCP server to record each prompt. Trellini is for the LaunchBrief owner to manage tasks; LaunchBrief users do not need Trellini accounts. The MCP snapshot bundled with LaunchBrief is described in [its provenance file](volcano/functions/_shared/trellini-mcp/PROVENANCE.md).

## Requirements

- Node.js and npm, plus the Volcano CLI and a Volcano project.
- A separate Trellini project with a board, destination column, and project service key for task tracking.
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
cp volcano/volcano.env.example volcano/volcano.env
cp web/.env.example web/.env.local
```

[`.env.example`](.env.example) is the complete field inventory. Its filled public URLs and Trellini IDs point to this repository's existing projects; replace them for your own instance. Keep populated environment files and service keys out of Git. `NEXT_PUBLIC_*` values are browser-visible; all API and service keys belong in Volcano's server-side variables.

| Variables | Use |
| --- | --- |
| `VOLCANO_API_URL`, `VOLCANO_ANON_KEY`, `VOLCANO_SERVICE_KEY`, `VOLCANO_DATABASE` | LaunchBrief's Volcano API and database. Keep the service key server-side. |
| `NEXT_PUBLIC_VOLCANO_API_URL`, `NEXT_PUBLIC_VOLCANO_ANON_KEY`, `NEXT_PUBLIC_VOLCANO_DATABASE` | Browser connection to the LaunchBrief project. |
| `APP_BASE_URL` | LaunchBrief's public origin for Checkout redirects and links in Trellini task notes. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Brief generation and Trellini tool requests through TanStack AI. The default model is `claude-sonnet-5`. |
| `ANTHROPIC_BASE_URL` | Optional Anthropic-compatible proxy endpoint. It must support Messages API tool calls and structured outputs. |
| `LAUNCHBRIEF_CREDIT_GATE_ENABLED` | Server-side credit gate. Defaults to enabled; only `false` bypasses credit spending for signed-in users. The browser reads the mode from the private `credit-mode` Function. |
| `TRELLINI_API_URL`, `TRELLINI_SERVICE_KEY`, `TRELLINI_DATABASE` | Separate Trellini project API, service key, and database (`trellini` by default). |
| `TRELLINI_BOARD_ID`, `TRELLINI_COLUMN_ID` | Destination board and column UUIDs in Trellini. |
| `TRELLINI_CARD_URL_TEMPLATE` | Optional verified card link pattern using `{board_id}` and `{card_id}`. Leave empty without a confirmed deep-link format. |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CREDITS_PER_PACK` | Needed in paid mode for Stripe Checkout, webhook verification, and the number of credits granted by one purchased pack. |

The Trellini service key has privileged access to its project. LaunchBrief checks that the configured column belongs to the board, sends only server-controlled card fields to MCP, and saves a task ID only when MCP returns a valid one. Keep the service key in the Function environment.

## Run locally

From the repository root, start Volcano and deploy the local resources:

```sh
volcano start
volcano variables deploy
volcano functions deploy --all
volcano config deploy
volcano migrations deploy --all -d app
volcano storage bucket create launchbrief-decks --allowed-mime-type application/vnd.openxmlformats-officedocument.presentationml.presentation
npm run dev
```

Open `http://localhost:3000`. The migrations create the idea, conversation, and credit tables with owner-scoped read policies. The Volcano CLI does not track applied migrations, so run the full migration set only against a fresh database. The deck bucket must be private and available before using the PPT action.

For Stripe purchases, point a Stripe webhook at the deployed `stripe-webhook` HTTP Function URL and subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Set `STRIPE_WEBHOOK_SECRET` from that endpoint. `STRIPE_PRICE_ID` must identify one whole credit pack; `CREDITS_PER_PACK` is the number of credits granted for that single line item. Complete a test purchase and confirm the credit balance before using paid flows. To test without Stripe, set `LAUNCHBRIEF_CREDIT_GATE_ENABLED=false` in the server variables and deploy them; brief, follow-up, and deck actions do not spend credits in this mode.

## Deploy

Use cloud URLs and keys in `volcano/volcano.env` and `web/.env.local`, then select the LaunchBrief project. For a fresh project, deploy its resources with the Volcano CLI:

```sh
volcano login
volcano use <launchbrief-project>
volcano cloud variables deploy
volcano cloud functions deploy --all
volcano cloud config deploy
volcano cloud storage bucket create launchbrief-decks --allowed-mime-type application/vnd.openxmlformats-officedocument.presentationml.presentation
volcano cloud frontends deploy --name web --path .
```

Provision the `app` database and apply the files in `volcano/migrations/` in order before using the app. `volcano migrations deploy --all -d app` connects directly to the configured database and does not track applied migrations; confirm its target and use it only for a fresh database. Deploy Trellini separately; this repository does not modify Trellini.

Before inviting users, verify sign-up and sign-in, a paid test Checkout and credit grant, an idea submission and Trellini task, a follow-up, a saved brief after signing out and back in, and PPT creation and download. The Anthropic key must have usable API credits for brief generation.

## Validate changes

```sh
npm test
npm run build
```

The tests cover credit spending and refund behavior, Stripe webhook validation, and the Trellini task-call guard. The current research notes remain assumptions until an external source provider and a source-verification contract are added. Brief generation waits for Anthropic and Trellini in one Function request; production use should measure its execution time and use a durable runner if it exceeds the Function limit.
