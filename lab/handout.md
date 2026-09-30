# Lab handout: values and links

Each participant deploys one LaunchBrief project and one frontend on a Free Volcano account. Trellini is shared and instructor-owned.

| Item | Value / facilitator action |
| --- | --- |
| Shared Trellini website | https://trellini.volcano.run |
| Shared board name / browser link | Fill from the deployed board; do not invent a card deep link |
| `TRELLINI_MCP_URL` | `https://trellini.volcano.run/mcp` |
| `TRELLINI_BOARD_ID` | Fill with the shared board UUID |
| `TRELLINI_COLUMN_ID` | Fill with the shared destination column UUID |
| Volcano sign-up / dashboard | Fill with the actual lab environment link |
| Volcano API URL | Fill with the API URL for participants' LaunchBrief projects |
| CLI installation and environment setup | Supply official installation instructions and how to target this same environment |
| Database region / PostgreSQL version | Supply supported values for this lab environment |
| LaunchBrief repository | https://github.com/tkkhq/launchbrief |
| Model access | Supply authorized participant-key instructions or a separately operated compatible proxy; this repository does not supply a proxy |
| Credit gate | `LAUNCHBRIEF_CREDIT_GATE_ENABLED=true`; idea, follow-up, and PPT each cost 1 credit |
| Stripe test-mode setup | Price: `price_1ULCbePUwxhzJA7t25FgsIzG`. Supply `STRIPE_SECRET_KEY` privately and confirm matching `CREDITS_PER_PACK`; do not put secrets in this handout |
| Webhook setup | Register each instance's actual `stripe-webhook` HTTP URL, enable `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and store its own `STRIPE_WEBHOOK_SECRET` privately |
| Test credit purchase | Supply Stripe's documented test-payment instructions; participants need at least 3 credits and must see the granted balance before generation |
| Agentic plugin installation | Supply supported installation instructions |
| Support | Fill with a contact channel where participants can ask for help without posting credentials |

Participants obtain their own Trellini session token after signing up at the shared site. Keep it private in `.env.cloud` and server-side project variables. Do not distribute the facilitator's service key or include participant tokens in this handout.

Confirm the session-token lifetime on the deployed Trellini project. When it expires, the participant retrieves a fresh token from Trellini, updates `.env.cloud`, and redeploys LaunchBrief variables. No frontend deployment is needed for a token-only change.

The shared board receives original idea and follow-up prompts. Use sample content suitable for everyone in the lab to read. Other participants cannot open a private LaunchBrief idea merely because its link appears in Trellini.
