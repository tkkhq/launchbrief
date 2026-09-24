const { client, reply, one } = require('./_shared/core');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function grantCredits(db, sessionId, userId, credits) {
  for (let ordinal = 1; ordinal <= credits; ordinal++) {
    const existing = await one(db.from('launch_credits').select('id,user_id').eq('stripe_session_id', sessionId).eq('ordinal', ordinal).limit(1), 'Checking grant');
    if (existing) {
      if (existing.user_id !== userId) throw new Error('Grant belongs to another user');
      continue;
    }
    const { error } = await db.insert('launch_credits', { user_id: userId, stripe_session_id: sessionId, ordinal });
    if (error) {
      const raced = await one(db.from('launch_credits').select('id,user_id').eq('stripe_session_id', sessionId).eq('ordinal', ordinal).limit(1), 'Rechecking grant');
      if (!raced || raced.user_id !== userId) throw new Error(`Grant failed: ${error.message}`);
    }
  }
}

exports.handler = async (event) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) return reply(503, { error: 'Webhook is not configured.' });
  const header = Object.entries(event.headers || {}).find(([name]) => name.toLowerCase() === 'stripe-signature')?.[1];
  const signature = Array.isArray(header) ? header[0] : header;
  if (!signature || typeof event.body !== 'string') return reply(400, { error: 'Missing Stripe signature or body.' });
  let stripeEvent;
  let stripe;
  try {
    const Stripe = require('stripe');
    stripe = new Stripe(key);
    const raw = event.is_base64_encoded ? Buffer.from(event.body, 'base64') : event.body;
    stripeEvent = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (error) {
    return reply(400, { error: 'Invalid Stripe signature.' });
  }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(stripeEvent.type)) return reply(200, { received: true });
  const session = stripeEvent.data.object;
  const userId = session.metadata?.launchbrief_user_id;
  const credits = Number(session.metadata?.launchbrief_credits);
  if (session.mode !== 'payment' || session.payment_status !== 'paid' || !UUID.test(userId || '') || session.client_reference_id !== userId || !Number.isInteger(credits) || credits < 1 || credits > 1000) return reply(400, { error: 'Invalid paid Checkout session.' });
  try {
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
    if (items.has_more || items.data.length !== 1 || !session.metadata?.launchbrief_price_id || items.data[0].price?.id !== session.metadata.launchbrief_price_id || items.data[0].quantity !== 1) return reply(400, { error: 'Checkout price does not match the credit pack.' });
    const db = await client(null, true);
    await grantCredits(db, session.id, userId, credits);
    return reply(200, { received: true });
  } catch (error) {
    console.error('Credit grant failed', error);
    return reply(500, { error: 'Credit grant failed; Stripe should retry.' });
  }
};

exports.grantCredits = grantCredits;
