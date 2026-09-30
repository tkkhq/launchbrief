# Lab handout: values and links

Each participant uses the Volcano CLI to create and deploy one LaunchBrief project containing one frontend and its backend resources on a Free Volcano account. Shared Trellini is an instructor-owned MCP integration point.

| Item | Value / facilitator action |
| --- | --- |
| Shared Trellini website | https://trellini.volcano.run |
| Shared board name / browser link | Fill from the deployed board; do not invent a card deep link |
| `TRELLINI_MCP_URL` | `https://trellini.volcano.run/mcp` |
| `TRELLINI_BOARD_ID` | `f8a06b4a-19ba-477b-a9a5-d3e942605736` |
| `TRELLINI_COLUMN_ID` | `dc83b534-1d38-4754-96cd-852827ce1c8d` |
| Volcano sign-up / dashboard | Fill with the actual lab environment link |
| Volcano API URL | Fill with the API URL for participants' LaunchBrief projects |
| CLI installation and environment setup | Supply official installation instructions and how to target this same environment |
| Database region / PostgreSQL version | Supply supported values for this lab environment |
| LaunchBrief repository | https://github.com/tkkhq/launchbrief |
| Model access | Supply authorized participant-key instructions or a separately operated compatible proxy; this repository does not supply a proxy |
| Credit gate | `LAUNCHBRIEF_CREDIT_GATE_ENABLED=true`; idea, follow-up, and PPT each cost 1 credit |
| Stripe test-mode setup | Price: `price_1ULCbePUwxhzJA7t25FgsIzG`; `CREDITS_PER_PACK=5`. Supply `STRIPE_SECRET_KEY` privately; do not put secrets in this handout |
| Webhook setup | Register each instance's actual `stripe-webhook` HTTP URL, enable `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and store its own `STRIPE_WEBHOOK_SECRET` privately |
| Test credit purchase | Buy one test pack and confirm a balance of 5. The idea, follow-up, and PPT use 3 credits, leaving 2 for further exercises. Supply documented test-payment instructions |
| Agentic plugin installation | Supply supported installation instructions |
| Support | Fill with a contact channel where participants can ask for help without posting credentials |

## Trellini connection variables

Copy these five fields into your private `.env`:

```dotenv
TRELLINI_MCP_TRANSPORT=http
TRELLINI_MCP_URL=https://trellini.volcano.run/mcp
TRELLINI_ACCESS_TOKEN=<your-own-full-session-token>
TRELLINI_BOARD_ID=f8a06b4a-19ba-477b-a9a5-d3e942605736
TRELLINI_COLUMN_ID=dc83b534-1d38-4754-96cd-852827ce1c8d
```

Replace the token placeholder: sign in at https://trellini.volcano.run, open the gear menu → MCP connection panel → **Other**, and copy the entire token after `Bearer ` from the Authorization header. Do not include the `Bearer ` prefix or the JSON wrapper. Keep the token private in `.env` and server-side project variables. No `TRELLINI_DATABASE`, `TRELLINI_API_URL`, or Trellini service key is needed in HTTP mode. These are the Trellini fields; LaunchBrief's own project, model, and Stripe fields are also required by the environment template.

The board and column IDs above were supplied by the facilitator. Verify authenticated access and their relationship before generation:

```sh
node lab/scripts/list-trellini-targets.mjs
```

Match both IDs in the helper's results. Do not distribute the facilitator's service key or include participant tokens in this handout.

Confirm the session-token lifetime on the deployed Trellini project. When it expires, the participant retrieves a fresh token from Trellini, updates `.env`, and redeploys LaunchBrief variables. No frontend deployment is needed for a token-only change.

The shared board receives original idea and follow-up prompts. Use sample content suitable for everyone in the lab to read. Other participants cannot open a private LaunchBrief idea merely because its link appears in Trellini.
