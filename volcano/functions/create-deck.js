const { client, reply, identity, one, claimCredit, refundCredit } = require('./_shared/core');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  const auth = identity(event);
  if (!auth) return reply(401, { error: 'Sign in to create a deck.' });
  if (!UUID.test(event.turn_id || '') || !UUID.test(event.operation_id || '')) return reply(400, { error: 'Invalid request identifiers.' });
  const db = await client(null, true);
  const turn = await one(db.from('launch_turns').select('id,idea_id,status,research_notes,recommendation,deck_status,deck_path').eq('id', event.turn_id).eq('user_id', auth.user_id).limit(1), 'Reading brief');
  if (!turn || turn.status !== 'complete') return reply(404, { error: 'Completed brief not found.' });
  if (turn.deck_status === 'ready' && turn.deck_path) return reply(200, { path: turn.deck_path });
  const idea = await one(db.from('launch_ideas').select('product_name,target_customer,category').eq('id', turn.idea_id).eq('user_id', auth.user_id).limit(1), 'Reading idea');
  if (!idea) return reply(404, { error: 'Idea not found.' });
  const charged = await claimCredit(db, auth.user_id, event.operation_id);
  if (!charged) return reply(402, { error: 'You need one credit to create a deck.' });
  if (charged === 'prior') return reply(200, { status: 'creating' });
  try {
    const claim = await db.update('launch_turns', { deck_status: 'creating' }).eq('id', turn.id).eq('user_id', auth.user_id).in('deck_status', ['none', 'failed']);
    if (claim.error || !claim.data?.length) throw new Error('Deck creation is already in progress');
    const pptxgen = require('pptxgenjs');
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'LaunchBrief';
    pptx.subject = `Launch brief for ${idea.product_name}`;
    pptx.title = `${idea.product_name} launch brief`;
    const rec = typeof turn.recommendation === 'string' ? JSON.parse(turn.recommendation) : turn.recommendation;
    const notes = typeof turn.research_notes === 'string' ? JSON.parse(turn.research_notes) : turn.research_notes;
    const slide = (title, lines) => {
      const s = pptx.addSlide();
      s.background = { color: 'F7F7F2' };
      s.addText('LAUNCHBRIEF', { x: 0.7, y: 0.35, w: 4, h: 0.25, fontFace: 'Aptos', fontSize: 10, bold: true, color: 'B45330', charSpacing: 2 });
      s.addText(title, { x: 0.7, y: 1, w: 11.8, h: 0.8, fontFace: 'Aptos Display', fontSize: 30, bold: true, color: '18352E' });
      s.addText(lines.join('\n\n'), { x: 0.75, y: 2.1, w: 11.8, h: 4.4, fontFace: 'Aptos', fontSize: 18, color: '263B35', breakLine: false, valign: 'top', margin: 0.05 });
      s.addText('LaunchBrief  •  Working draft', { x: 0.7, y: 7.05, w: 6, h: 0.2, fontSize: 9, color: '697B74' });
    };
    slide(idea.product_name, [`For ${idea.target_customer}`, idea.category]);
    slide('Customer problem', [rec.customer_problem]);
    slide('Positioning', [rec.positioning]);
    slide('Small MVP scope', rec.mvp_scope.map((x, i) => `${i + 1}. ${x}`));
    slide('Research notes', notes.map(n => `ASSUMPTION — ${n.text}`));
    const data = await pptx.write({ outputType: 'nodebuffer' });
    const path = `${auth.user_id}/${turn.idea_id}/${turn.id}.pptx`;
    const userDb = await client(auth.access_token);
    const uploaded = await userDb.storage.from('launchbrief-decks').upload(path, new Blob([data]), { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    if (uploaded.error) throw new Error(`Uploading deck: ${uploaded.error.message}`);
    const saved = await db.update('launch_turns', { deck_status: 'ready', deck_path: path, updated_at: new Date().toISOString() }).eq('id', turn.id).eq('user_id', auth.user_id);
    if (saved.error) throw new Error(`Saving deck: ${saved.error.message}`);
    return reply(200, { path });
  } catch (error) {
    await db.update('launch_turns', { deck_status: 'failed' }).eq('id', turn.id).eq('user_id', auth.user_id);
    if (charged === 'new') {
      try { await refundCredit(db, event.operation_id); } catch (refundError) { console.error(refundError); }
    }
    return reply(500, { error: 'Deck creation failed. Any charged credit was returned if possible.' });
  }
};
