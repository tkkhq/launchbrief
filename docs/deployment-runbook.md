# LaunchBrief deployment runbook

Use this runbook for a new LaunchBrief instance in a Volcano account. LaunchBrief runs in your Volcano project. Trellini can be an instructor-owned shared deployment or a separately owner-operated project. Commands are run from the named repository root; check the selected project before every cloud change. The commands below match Volcano CLI v0.36.0 and the checked-in application code. Recheck `volcano <command> --help` if your CLI differs.

The Free-account lab uses one participant-owned LaunchBrief project and one frontend, with the instructor-owned Trellini board at https://trellini.volcano.run. The facilitator distributes participant instructions separately. No Pro coupon or participant Trellini deployment is required. This runbook also retains a manual owner-operated Trellini deployment path.

## 1. Collect values and verify the source

| Value | Where to get it |
| --- | --- |
| LaunchBrief project ID, API URL, browser and server keys | Your own Volcano account and supported CLI key commands. |
| Trellini connection | Shared lab: confirmed hosted MCP URL and your Trellini user session token. Owner-operated stdio: Trellini project API URL and service key. |
| Trellini board and column UUIDs | Shared lab: facilitator-supplied IDs, verified through hosted MCP. Owner-operated: a board and column in your Trellini project. |
| Model credential | An API key that can call the configured Anthropic model. LaunchBrief uses TanStack AI's Anthropic adapter; the checked-in default is `claude-sonnet-5.5`. |
| Stripe values, if charging for credits | A Stripe secret key, a **one-time** credit-pack Price ID, the number of credits in that pack, and a webhook signing secret after the endpoint is registered. |
| LaunchBrief public URL | `volcano cloud frontends list` after the first frontend deployment. Use it for `APP_BASE_URL`. |

Use [`.env.example`](../.env.example) as a field inventory. Its prefilled URL and Trellini IDs belong to another instance; **replace them all** for a new account. Do not copy real keys into Git, the browser's `NEXT_PUBLIC_*` variables, or a shared lab handout. The root `.env` path used below is gitignored.

Anyone administering a participant's Volcano project can access that project's deployed secrets. `ANTHROPIC_BASE_URL` is an optional endpoint setting, not a proxy service supplied by this repository. To share an instructor-owned model key without disclosing it to project owners, operate a separate proxy under instructor control; otherwise use each participant's own key.

## 2. Preflight

Install Node.js/npm and the Volcano CLI. Authenticate with `volcano login` if `volcano projects list` does not work. Login requires completing the browser device-code flow.

From the LaunchBrief repository root:

```sh
which volcano
volcano projects list
npm ci
npm ci --prefix volcano/functions
npm test
npm run build
```

The repository contains the Volcano scaffold already; do not run `volcano init` over it. A fresh cloud deployment needs a new database. Cloud migrations have no applied-migration tracking, so **run `--all` only on a fresh database**.

## 3. Prepare Trellini first

For the Free-account lab, sign up on https://trellini.volcano.run and open the shared board. Use your signed-in session's MCP panel to obtain the actual MCP endpoint and token, and the lab handout for the shared board/column UUIDs. Use `lab/launchbrief.env.example` for your private `.env`:

```dotenv
TRELLINI_MCP_TRANSPORT=http
TRELLINI_MCP_URL=<confirmed-hosted-mcp-endpoint>
TRELLINI_ACCESS_TOKEN=<your-own-trellini-session-token>
TRELLINI_BOARD_ID=<shared-board-uuid>
TRELLINI_COLUMN_ID=<shared-column-uuid>
```

Run `node lab/scripts/list-trellini-targets.mjs` after installing Function dependencies to verify read access. The website URL alone does not establish the MCP endpoint. Never distribute the instructor's Trellini service key. Copied user tokens expire; retrieve a fresh one and redeploy LaunchBrief variables when needed. Then proceed to section 4, creating only your LaunchBrief project. Shared prompts are visible to the group, and Trellini's existing collaborative permissions permit edits.

For a manual owner-operated Trellini deployment outside the shared-board lab, run these commands from the **Trellini** repository root. Replace every `YOUR_*` token with your own project value. The example uses `us-east-1` and PostgreSQL `16`:

```sh
volcano projects create YOUR_TRELLINI_PROJECT_NAME
volcano projects list
volcano use YOUR_TRELLINI_PROJECT_ID
volcano projects list
volcano cloud databases create trellini --region us-east-1 --pg-version 16
volcano cloud databases get trellini
volcano cloud databases migration up --all -d trellini
```

With Trellini selected, obtain its browser key and create a server-only integration key if you do not already have one:

```sh
volcano projects keys anon list YOUR_TRELLINI_PROJECT_ID
volcano projects keys service create launchbrief-integration YOUR_TRELLINI_PROJECT_ID
```

Store the integration key privately for LaunchBrief's `TRELLINI_SERVICE_KEY`. For the owner-facing board, provision Trellini's own browser variables `NEXT_PUBLIC_VOLCANO_API_URL`, `NEXT_PUBLIC_VOLCANO_ANON_KEY`, and `NEXT_PUBLIC_VOLCANO_DATABASE=trellini` in that **Trellini** project. Keep any `VOLCANO_SERVICE_KEY` used by Trellini's own backend server-side. From the Trellini root, use a gitignored private variable file and deploy its main frontend and config:

```sh
volcano cloud variables deploy --file .env
volcano cloud frontends deploy --name web --path .
volcano cloud config deploy --dry-run
volcano cloud config deploy
volcano cloud frontends list
```

Create `.env` yourself with values from the Trellini project; do not reuse LaunchBrief's file. Review the config dry run for any Trellini Functions or schedulers that have not been deployed, and follow Trellini's own instructions for those features. Sign in as the Trellini owner and create or confirm the destination board and column. For a manual deployment, verify the project's email-confirmation setting before the lab; LaunchBrief's own config explicitly sets it to `false`.

Trellini's README says its full board UI needs a browser key with realtime permissions and, for attachments, storage permissions. The current CLI's `volcano projects keys anon create` help only promises an auth-only key. Provision and verify those extra permissions using a supported Trellini/Volcano setup path before relying on those UI features; this runbook does not invent a CLI flag for them. In default `TRELLINI_MCP_TRANSPORT=stdio` mode, LaunchBrief's backend task creation uses the bundled Trellini **stdio** MCP server ([snapshot provenance](../volcano/functions/_shared/trellini-mcp/PROVENANCE.md)) and a Trellini service key; it does not require Trellini's HTTP `mcp-server` Function or a Trellini end-user password. If you deploy a different Trellini revision, verify that its MCP `create_card` tool and database fields still match the bundled snapshot before testing LaunchBrief.

Record `TRELLINI_BOARD_ID` and `TRELLINI_COLUMN_ID` from that project. LaunchBrief verifies their relationship before creating a card. Leave `TRELLINI_CARD_URL_TEMPLATE` unset unless Trellini establishes a verified card deep-link format; do not guess one. The Trellini card notes link back to the LaunchBrief idea. LaunchBrief currently saves the returned card ID but does not display a clickable Trellini task link in its UI, even if a task URL is stored.

## 4. Create LaunchBrief resources

Switch to the **LaunchBrief** repository root. Replace the `YOUR_*` tokens, create or select its project, then confirm the selection before every cloud step:

```sh
volcano projects create YOUR_LAUNCHBRIEF_PROJECT_NAME
volcano projects list
volcano use YOUR_LAUNCHBRIEF_PROJECT_ID
volcano projects list
volcano projects keys anon list YOUR_LAUNCHBRIEF_PROJECT_ID
volcano projects keys service create launchbrief-server YOUR_LAUNCHBRIEF_PROJECT_ID
volcano cloud databases create app --region us-east-1 --pg-version 16
volcano cloud databases get app
volcano cloud databases migration up --all -d app
volcano cloud storage bucket create launchbrief-decks --allowed-mime-type application/vnd.openxmlformats-officedocument.presentationml.presentation
```

If no usable LaunchBrief browser key exists, create one with `volcano projects keys anon create YOUR_KEY_NAME YOUR_LAUNCHBRIEF_PROJECT_ID`. The `launchbrief-decks` bucket starts private with owner-scoped policies; it does not need public access. The `app` migrations create ideas, turns, and credits with user-scoped reads.

For the shared lab, copy `lab/launchbrief.env.example`, use HTTP mode as described in section 3, and keep `LAUNCHBRIEF_CREDIT_GATE_ENABLED=true`. Supply Stripe test-mode Checkout fields before deployment, then complete section 6 to register the webhook and buy at least three test credits before generation. For an owner-operated stdio deployment outside the lab, create a private, gitignored `.env` in the LaunchBrief repository root. Replace every placeholder below with a value from **your** projects. The `NEXT_PUBLIC_*` entries are browser-visible. All other keys stay server-side. The following standalone example starts in no-credit test mode so Stripe can be added later.

```dotenv
VOLCANO_SERVICE_KEY=<launchbrief-service-key>
VOLCANO_DATABASE=app
NEXT_PUBLIC_VOLCANO_API_URL=<launchbrief-volcano-api-url>
NEXT_PUBLIC_VOLCANO_ANON_KEY=<launchbrief-anon-key>
NEXT_PUBLIC_VOLCANO_DATABASE=app
ANTHROPIC_API_KEY=<model-api-key>
ANTHROPIC_MODEL=claude-sonnet-5.5
LAUNCHBRIEF_CREDIT_GATE_ENABLED=false
TRELLINI_MCP_TRANSPORT=stdio
TRELLINI_API_URL=<trellini-volcano-api-url>
TRELLINI_SERVICE_KEY=<trellini-service-key>
TRELLINI_DATABASE=trellini
TRELLINI_BOARD_ID=<trellini-board-uuid>
TRELLINI_COLUMN_ID=<trellini-column-uuid>
```

Do not deploy literal angle-bracket placeholders. Omit optional blank variables. Keep `web/.env.local` for local development only; cloud builds must receive the correct `NEXT_PUBLIC_*` values from project variables, not stale localhost values packaged with the frontend.

Deploy the variables, Functions, frontend, and config from the LaunchBrief root:

```sh
volcano cloud variables deploy --file .env
volcano cloud variables list
volcano cloud functions deploy --all
volcano cloud frontends deploy --name web --path .
volcano cloud config deploy --dry-run
volcano cloud config deploy
volcano cloud functions list
volcano cloud frontends list
```

Review the config dry run before applying it. The config makes brief/deck/Checkout Functions private, makes the Stripe webhook a public HTTP Function, and disables LaunchBrief email confirmation. Wait for the frontend and Functions to become active. Capture the frontend URL from `volcano cloud frontends list`, add `APP_BASE_URL=<that-url>` to `.env`, then propagate it:

```sh
volcano cloud variables deploy --file .env
volcano cloud variables list
```

`APP_BASE_URL` is used in Trellini card notes and Stripe redirects. The first deploy can build without it, but brief generation needs it before testing. If you later change a browser-visible `NEXT_PUBLIC_*` value, deploy the variables **and redeploy the frontend** so its build uses the new value.

## 5. Optional no-credit check outside the lab

With `LAUNCHBRIEF_CREDIT_GATE_ENABLED=false`, sign-in is still required and Checkout is hidden. Use the deployed LaunchBrief URL to:

1. Create a LaunchBrief account and sign in. Confirm no email confirmation is required.
2. Submit a free-text idea. Its provisional entry should appear in **Your ideas** immediately. Wait for the organized idea, assumption-labeled research notes, and recommendation.
3. In Trellini, confirm exactly one card was created in the selected column and its notes contain the original prompt and a link to the LaunchBrief idea.
4. Send a follow-up and confirm a second saved turn and Trellini card. Create and download a PPT deck.
5. Sign out and back in. Confirm the idea, briefs, follow-up, and deck remain available.

In this mode briefs, follow-ups, and decks do not spend credits, but they still call the configured model. Research notes are model-generated assumptions; this app has no external research provider and must not be presented as having sourced findings.

Useful read-only checks while diagnosing a failure:

```sh
volcano cloud variables list
volcano cloud functions logs generate-brief --type runtime
volcano cloud functions logs create-deck --type runtime
volcano cloud frontends logs web --type build
volcano cloud storage bucket list
```

## 6. Configure credits (required for the lab)

Create a one-time Stripe Price representing one credit pack. In `.env`, set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `CREDITS_PER_PACK` to the pack's positive integer credit count. Get the deployed webhook Function's **actual HTTP URL** from `volcano cloud functions get stripe-webhook`; register that URL in Stripe for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Set `STRIPE_WEBHOOK_SECRET` to the resulting endpoint signing secret. Do not infer a Function URL or put Stripe secrets in `NEXT_PUBLIC_*` variables.

When all four Stripe values are present, change `LAUNCHBRIEF_CREDIT_GATE_ENABLED=true` and deploy the updated file:

```sh
volcano cloud variables deploy --file .env
volcano cloud variables list
```

Run a Stripe test purchase. Confirm the webhook grants exactly `CREDITS_PER_PACK` credits once, then confirm an idea or follow-up costs one credit and PPT creation costs one credit. The app does not seed credits automatically. If Checkout or granting fails, inspect `create-checkout` and `stripe-webhook` runtime logs and the Stripe endpoint delivery result before inviting users.

For the lab, use Stripe test-mode values, keep the gate `true`, run `node lab/scripts/check-env.mjs ready` after supplying `APP_BASE_URL` and `STRIPE_WEBHOOK_SECRET`, and buy one five-credit pack (`CREDITS_PER_PACK=5`) for the idea, follow-up, and PPT checkpoints. Those three actions leave two credits. Complete the saved-history and shared-board checks from section 5 with credit charging enabled.

## 7. Updating or rolling back

For code-only updates, run the local tests/build, select the LaunchBrief project, and deploy only the changed Function(s) or frontend. `volcano cloud frontends deploy --name web --path .` uploads the current working tree; a frontend redeploy from a stored archive does not pick up new source.

For rollback, check out a known good code revision and redeploy its affected frontend/Functions. Restore prior variable values separately if they changed. Do not rerun the full migration set or delete the database as a rollback method; migrations are not tracked or automatically reversible.
