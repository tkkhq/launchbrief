const { client, reply, identity, required, one, claimCredit, refundCredit } = require('./_shared/core');
const { createTrelliniTask, writeBrief } = require('./_shared/agent');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  const auth = identity(event);
  if (!auth) return reply(401, { error: 'Sign in to create a brief.' });
  const initial = event.kind === 'initial';
  if (!['initial', 'followup'].includes(event.kind) || !UUID.test(event.turn_id || '') || !UUID.test(event.idea_id || '')) return reply(400, { error: 'Invalid request identifiers.' });
  if (initial && ![event.product_name, event.description, event.target_customer, event.category].every(v => required(v, 2000))) return reply(400, { error: 'Complete the required idea fields.' });
  if (!initial && !required(event.prompt, 4000)) return reply(400, { error: 'Enter a follow-up prompt.' });
  if (initial && event.goal && !required(event.goal, 1000)) return reply(400, { error: 'Goal is too long.' });
  const db = await client(null, true);
  let idea = initial ? null : await one(db.from('launch_ideas').select('id,product_name,description,target_customer,category,goal').eq('id', event.idea_id).eq('user_id', auth.user_id).limit(1), 'Reading idea');
  if (!initial && !idea) return reply(404, { error: 'Idea not found.' });
  const existing = await one(db.from('launch_turns').select('id,status').eq('id', event.turn_id).eq('user_id', auth.user_id).limit(1), 'Checking turn');
  if (existing) return reply(200, { turn_id: existing.id, status: existing.status });
  const missing = ['OPENAI_API_KEY','TRELLINI_API_URL','TRELLINI_SERVICE_KEY','TRELLINI_BOARD_ID','TRELLINI_COLUMN_ID','APP_BASE_URL'].filter(k => !process.env[k]);
  if (missing.length) return reply(503, { error: `Service is not configured: ${missing.join(', ')}` });
  const charged = await claimCredit(db, auth.user_id, event.turn_id);
  if (!charged) return reply(402, { error: 'You need one credit to create a brief.' });
  if (charged === 'prior') return reply(200, { turn_id: event.turn_id, status: 'tracking' });
  let turnCreated = false;
  try {
    if (initial) {
      idea = { id: event.idea_id, user_id: auth.user_id, product_name: event.product_name.trim(), description: event.description.trim(), target_customer: event.target_customer.trim(), category: event.category.trim(), goal: (event.goal || '').trim() };
      const { error } = await db.insert('launch_ideas', idea);
      if (error) throw new Error(`Saving idea: ${error.message}`);
    }
    const prompt = initial ? [idea.description, idea.goal ? `Goal or constraint: ${idea.goal}` : ''].filter(Boolean).join('\n') : event.prompt.trim();
    const { error } = await db.insert('launch_turns', { id: event.turn_id, idea_id: idea.id, user_id: auth.user_id, prompt, kind: event.kind, status: 'tracking' });
    if (error) throw new Error(`Saving prompt: ${error.message}`);
    turnCreated = true;
    const task = await createTrelliniTask(idea, prompt, idea.id);
    const tracked = await db.update('launch_turns', { task_card_id: task.cardId, task_url: task.taskUrl, status: 'writing', updated_at: new Date().toISOString() }).eq('id', event.turn_id).eq('user_id', auth.user_id);
    if (tracked.error) throw new Error(`Saving Trellini task: ${tracked.error.message}`);
    const { data: past, error: pastError } = await db.from('launch_turns').select('prompt,recommendation').eq('idea_id', idea.id).eq('user_id', auth.user_id).eq('status', 'complete').order('created_at', { ascending: true }).limit(20);
    if (pastError) throw new Error(`Reading history: ${pastError.message}`);
    const brief = await writeBrief(idea, prompt, past || []);
    const saved = await db.update('launch_turns', { research_notes: JSON.stringify(brief.research_notes), recommendation: JSON.stringify(brief.recommendation), status: 'complete', updated_at: new Date().toISOString() }).eq('id', event.turn_id).eq('user_id', auth.user_id);
    if (saved.error) throw new Error(`Saving brief: ${saved.error.message}`);
    return reply(200, { turn_id: event.turn_id, status: 'complete' });
  } catch (error) {
    if (turnCreated) {
      await db.update('launch_turns', { status: 'failed', error_message: error.message, updated_at: new Date().toISOString() }).eq('id', event.turn_id).eq('user_id', auth.user_id);
    }
    try { await refundCredit(db, event.turn_id); } catch (refundError) { console.error(refundError); }
    return reply(500, { error: 'Brief generation failed. The credit was returned if possible.', turn_id: turnCreated ? event.turn_id : null });
  }
};
