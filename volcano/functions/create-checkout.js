const { reply, identity } = require('./_shared/core');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  const auth = identity(event);
  if (!auth) return reply(401, { error: 'Sign in to buy credits.' });
  const { STRIPE_SECRET_KEY, STRIPE_PRICE_ID, APP_BASE_URL, CREDITS_PER_PACK } = process.env;
  const credits = Number(CREDITS_PER_PACK);
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !APP_BASE_URL || !Number.isInteger(credits) || credits < 1 || credits > 1000) return reply(503, { error: 'Checkout is not configured.' });
  try {
    const Stripe = require('stripe');
    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const success = new URL('/?checkout=success', APP_BASE_URL).toString();
    const cancel = new URL('/?checkout=cancel', APP_BASE_URL).toString();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: success,
      cancel_url: cancel,
      client_reference_id: auth.user_id,
      customer_email: auth.email || undefined,
      metadata: { launchbrief_user_id: auth.user_id, launchbrief_credits: String(credits), launchbrief_price_id: STRIPE_PRICE_ID },
    }, UUID.test(event.checkout_id || '') ? { idempotencyKey: event.checkout_id } : undefined);
    if (!session.url) throw new Error('Stripe returned no Checkout URL');
    return reply(200, { url: session.url });
  } catch (error) {
    console.error('Checkout failed', error);
    return reply(500, { error: 'Could not open checkout. Please try again.' });
  }
};
