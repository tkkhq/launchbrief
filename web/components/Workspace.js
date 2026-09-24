'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getVolcano } from '../lib/volcano';

const emptyForm = { product_name: '', description: '', target_customer: '', category: '', goal: '' };
function unpack(value) { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return null; } }
function messageOf(error) { return error?.message || 'Something went wrong. Please try again.'; }

export default function Workspace({ initialIdeaId = null }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [authMode, setAuthMode] = useState('signin');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [ideas, setIdeas] = useState([]);
  const [turns, setTurns] = useState([]);
  const [credits, setCredits] = useState(0);
  const [selectedId, setSelectedId] = useState(initialIdeaId);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [followup, setFollowup] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deckBusy, setDeckBusy] = useState(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [progress, setProgress] = useState('');
  const selectedIdea = ideas.find(i => i.id === selectedId) || null;
  const selectedTurns = useMemo(() => turns.filter(t => t.idea_id === selectedId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)), [turns, selectedId]);

  const loadData = useCallback(async () => {
    if (!getVolcano().auth.user()) return;
    setLoadingData(true);
    const db = getVolcano();
    const [ideaRes, turnRes, creditRes] = await Promise.all([
      db.from('launch_ideas').select('id,product_name,description,target_customer,category,goal,created_at').order('created_at', { ascending: false }).limit(100),
      db.from('launch_turns').select('id,idea_id,prompt,kind,status,research_notes,recommendation,error_message,task_card_id,task_url,deck_status,deck_path,created_at').order('created_at', { ascending: false }).limit(200),
      db.from('launch_credits').select('id').is('spent_at', null).limit(1000),
    ]);
    const error = ideaRes.error || turnRes.error || creditRes.error;
    if (error) setDataError(messageOf(error));
    else { setIdeas(ideaRes.data || []); setTurns(turnRes.data || []); setCredits((creditRes.data || []).length); setDataError(''); }
    setLoadingData(false);
  }, []);

  useEffect(() => {
    let active = true;
    const volcano = getVolcano();
    volcano.initialize().then(({ user: current }) => { if (active) { setUser(current); setBooting(false); } }).catch(e => { if (active) { setDataError(messageOf(e)); setBooting(false); } });
    const unsubscribe = volcano.auth.onAuthStateChange(next => { if (active) setUser(next); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => { if (user) loadData(); else { setIdeas([]); setTurns([]); setCredits(0); } }, [user, loadData]);
  useEffect(() => {
    if (!user || (!submitting && !turns.some(t => t.status === 'tracking' || t.status === 'writing'))) return;
    const timer = setInterval(loadData, 2500);
    return () => clearInterval(timer);
  }, [user, turns, submitting, loadData]);
  useEffect(() => { if (initialIdeaId) setSelectedId(initialIdeaId); }, [initialIdeaId]);
  useEffect(() => {
    if (!user || !window.location.search.includes('checkout=success')) return;
    const before = Number(sessionStorage.getItem('launchbrief_balance_before_checkout') || credits);
    if (credits > before) { setProgress('Credits added to your balance.'); const done = setTimeout(() => setProgress(''), 3000); return () => clearTimeout(done); }
    setProgress('Waiting for Stripe payment confirmation…');
    const timer = setInterval(loadData, 3000);
    const limit = setTimeout(() => { clearInterval(timer); setProgress(''); }, 60000);
    return () => { clearInterval(timer); clearTimeout(limit); };
  }, [user, credits, loadData]);

  async function handleAuth(event) {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true); setAuthNotice('');
    try {
      const auth = getVolcano().auth;
      if (authMode === 'signup') {
        const { session, error } = await auth.signUp({ email: authForm.email.trim(), password: authForm.password });
        if (error) throw error;
        setAuthNotice('Account created. Check your email to verify it, then sign in.');
        if (!session) setAuthMode('signin');
      } else if (authMode === 'forgot') {
        const { error } = await auth.resetPasswordForEmail(authForm.email.trim());
        if (error) throw error;
        setAuthNotice('If this email has an account, a reset link is on its way.');
      } else {
        const { error } = await auth.signIn({ email: authForm.email.trim(), password: authForm.password });
        if (error) throw error;
      }
    } catch (error) { setAuthNotice(messageOf(error)); }
    finally { setAuthBusy(false); }
  }

  async function invoke(name, payload) {
    const { data, error } = await getVolcano().functions.invoke(name, payload);
    if (error) throw new Error(data?.error || error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function submitIdea(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setActionError(''); setProgress('Saving your idea and checking your credit…');
    const ideaId = crypto.randomUUID(), turnId = crypto.randomUUID();
    try {
      const promise = invoke('generate-brief', { kind: 'initial', idea_id: ideaId, turn_id: turnId, ...form });
      setSelectedId(ideaId);
      setProgress('Recording the prompt in Trellini and writing the brief…');
      await promise;
      await loadData();
      setForm(emptyForm); setProgress('');
      router.push(`/ideas/${ideaId}`);
    } catch (error) { setActionError(messageOf(error)); setProgress(''); setSelectedId(null); await loadData(); }
    finally { setSubmitting(false); }
  }

  async function submitFollowup(event) {
    event.preventDefault();
    if (submitting || !selectedIdea) return;
    setSubmitting(true); setActionError(''); setProgress('Recording your follow-up and writing the new brief…');
    try {
      await invoke('generate-brief', { kind: 'followup', idea_id: selectedIdea.id, turn_id: crypto.randomUUID(), prompt: followup });
      setFollowup(''); await loadData(); setProgress('');
    } catch (error) { setActionError(messageOf(error)); setProgress(''); await loadData(); }
    finally { setSubmitting(false); }
  }

  async function createDeck(turn) {
    if (deckBusy) return;
    setDeckBusy(turn.id); setActionError('');
    try { await invoke('create-deck', { turn_id: turn.id, operation_id: crypto.randomUUID() }); await loadData(); }
    catch (error) { setActionError(messageOf(error)); await loadData(); }
    finally { setDeckBusy(null); }
  }

  async function downloadDeck(turn) {
    setActionError('');
    const { data, error } = await getVolcano().storage.from('launchbrief-decks').download(turn.deck_path);
    if (error) { setActionError(messageOf(error)); return; }
    const url = URL.createObjectURL(data);
    const link = document.createElement('a'); link.href = url; link.download = `LaunchBrief-${selectedIdea?.product_name || 'deck'}.pptx`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function buyCredits() {
    if (checkoutBusy) return;
    setCheckoutBusy(true); setActionError('');
    try { const { url } = await invoke('create-checkout', { checkout_id: crypto.randomUUID() }); sessionStorage.setItem('launchbrief_balance_before_checkout', String(credits)); window.location.assign(url); }
    catch (error) { setActionError(messageOf(error)); setCheckoutBusy(false); }
  }

  if (booting) return <main className="center-state" role="status">Opening LaunchBrief…</main>;
  if (!user) return <main className="auth-shell"><div className="auth-brand"><span className="brand-mark">L<span>✦</span></span><p className="eyebrow">A clearer way to launch</p><h1>Great ideas deserve a sharper start.</h1><p className="lede">Turn a product thought into a focused brief, a practical first scope, and a place to pick up the conversation later.</p><div className="auth-feature"><span>01</span><p>Honest research notes</p><span>02</span><p>A focused recommendation</p><span>03</span><p>An optional presentation</p></div></div><div className="auth-card"><p className="eyebrow">Welcome to LaunchBrief</p><h2>{authMode === 'signup' ? 'Create your account' : authMode === 'forgot' ? 'Reset your password' : 'Sign in to continue'}</h2><p className="muted">Your ideas and briefs stay in your workspace.</p><form onSubmit={handleAuth}><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" autoComplete="email" value={authForm.email} onChange={e => setAuthForm({ ...authForm, email: e.target.value })} required />{authMode !== 'forgot' && <><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} value={authForm.password} onChange={e => setAuthForm({ ...authForm, password: e.target.value })} required /></>}<button className="primary wide" disabled={authBusy} aria-busy={authBusy}>{authBusy ? 'Please wait…' : authMode === 'signup' ? 'Create account' : authMode === 'forgot' ? 'Send reset link' : 'Sign in'}</button><span role="status" className="form-status">{authBusy ? 'Working…' : ''}</span></form>{authNotice && <p className="notice" role="alert">{authNotice}</p>}<div className="auth-links">{authMode !== 'signin' && <button onClick={() => { setAuthMode('signin'); setAuthNotice(''); }}>Sign in</button>}{authMode !== 'signup' && <button onClick={() => { setAuthMode('signup'); setAuthNotice(''); }}>Create account</button>}{authMode === 'signin' && <button onClick={() => { setAuthMode('forgot'); setAuthNotice(''); }}>Forgot password?</button>}</div></div></main>;
  return <div className="app-shell"><aside className="sidebar"><Link href="/" onClick={() => setSelectedId(null)} className="brand"><span className="brand-mark small">L<span>✦</span></span><span>LaunchBrief</span></Link><button className="new-button" onClick={() => { setSelectedId(null); setActionError(''); router.push('/'); }}>＋ &nbsp; New idea</button><div className="side-heading">YOUR IDEAS <span>{ideas.length}</span></div><nav aria-label="Prior ideas" className="idea-list">{ideas.length === 0 ? <p className="side-empty">Your ideas will show up here.</p> : ideas.map(idea => <Link key={idea.id} href={`/ideas/${idea.id}`} onClick={() => setSelectedId(idea.id)} className={`idea-link ${selectedId === idea.id ? 'active' : ''}`}><span className="idea-icon">✦</span><span><strong>{idea.product_name}</strong><small>{idea.category}</small></span></Link>)}</nav><div className="side-bottom"><div className="credit-card"><span>AVAILABLE CREDITS</span><strong>{credits}</strong><p>1 brief or follow-up = 1 credit<br />1 PPT deck = 1 credit</p><button onClick={buyCredits} disabled={checkoutBusy}>{checkoutBusy ? 'Opening…' : 'Buy credits ↗'}</button></div><div className="user-row"><span className="avatar">{(user.email || 'U')[0].toUpperCase()}</span><span className="user-email">{user.email}</span><button onClick={() => getVolcano().auth.signOut()} aria-label="Sign out" title="Sign out">↪</button></div></div></aside><main className="main-area"><header className="topbar"><span className="mobile-brand">LaunchBrief</span><span className="topbar-right"><span className="top-credits">✦ &nbsp;{credits} credits</span><button onClick={buyCredits} disabled={checkoutBusy} className="top-buy">Buy credits</button><button onClick={() => getVolcano().auth.signOut()} className="top-signout">Sign out</button></span></header><div className="content">{authNotice && <p className="notice" role="alert">{authNotice}</p>}{dataError && <p className="error" role="alert">{dataError}</p>}{actionError && <p className="error" role="alert">{actionError}</p>}{progress && <p className="progress" role="status"><span className="pulse" />{progress}</p>}{!selectedIdea && submitting && selectedId ? <section className="pending-panel" role="status"><span className="eyebrow accent">YOUR LAUNCH BRIEF</span><h1>Finding the clearest way forward.</h1><p>We’re recording this idea in Trellini, then shaping a focused recommendation. You can return to this idea later.</p><span className="pulse" /></section> : !selectedIdea ? <section className="new-content"><div className="intro"><span className="eyebrow accent">FROM SPARK TO STRATEGY</span><h1>What are you<br /><em>building next?</em></h1><p>Tell us the essentials. We’ll turn your idea into a short launch brief with clear assumptions and a focused first step.</p></div><form className="idea-form" onSubmit={submitIdea}><div className="form-head"><span className="step-tag">01 / THE IDEA</span><span className="cost-pill">✦ &nbsp;1 credit</span></div><div className="field-grid"><div className="field"><label htmlFor="product-name">Product name <b>*</b></label><input id="product-name" value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} maxLength={120} placeholder="e.g. Fieldnote" required /></div><div className="field"><label htmlFor="category">Product category <b>*</b></label><input id="category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} maxLength={120} placeholder="e.g. Productivity" required /></div></div><div className="field"><label htmlFor="description">Describe the idea <b>*</b></label><textarea id="description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} maxLength={2000} placeholder="What does it do? What makes you excited about it?" rows={4} required /></div><div className="field"><label htmlFor="customer">Target customer <b>*</b></label><input id="customer" value={form.target_customer} onChange={e => setForm({ ...form, target_customer: e.target.value })} maxLength={500} placeholder="e.g. Freelance designers juggling multiple clients" required /></div><div className="field"><label htmlFor="goal">Goal or constraint <span>(optional)</span></label><input id="goal" value={form.goal} onChange={e => setForm({ ...form, goal: e.target.value })} maxLength={1000} placeholder="e.g. Launch in six weeks with a small team" /></div><div className="form-footer"><p>Your brief is saved to your workspace.</p><button className="primary" type="submit" disabled={submitting || credits < 1} aria-busy={submitting}>{submitting ? 'Creating brief…' : 'Create launch brief →'}</button></div>{credits < 1 && <p className="subtle-alert">You need a credit to create a brief. <button type="button" onClick={buyCredits}>Buy credits</button></p>}</form></section> : <section className="brief-content"><Link href="/" onClick={() => setSelectedId(null)} className="back-link">← &nbsp; All ideas</Link><div className="brief-title"><div><span className="eyebrow accent">LAUNCH WORKSPACE / {selectedIdea.category.toUpperCase()}</span><h1>{selectedIdea.product_name}</h1><p>{selectedIdea.description}</p></div><span className="idea-date">Created {new Date(selectedIdea.created_at).toLocaleDateString()}</span></div><div className="idea-facts"><div><span>TARGET CUSTOMER</span><strong>{selectedIdea.target_customer}</strong></div>{selectedIdea.goal && <div><span>GOAL / CONSTRAINT</span><strong>{selectedIdea.goal}</strong></div>}</div>{selectedTurns.length === 0 && <div className="empty-result" role="status">{submitting || loadingData ? 'Your brief is being prepared…' : 'No brief is saved for this idea yet.'}</div>}{selectedTurns.map((turn, index) => { const notes = unpack(turn.research_notes) || []; const rec = unpack(turn.recommendation); return <article className="turn" key={turn.id}><div className="turn-header"><span className="round-number">{String(index + 1).padStart(2, '0')}</span><div><span className="eyebrow">{turn.kind === 'initial' ? 'INITIAL BRIEF' : 'FOLLOW-UP'}</span><h2>{turn.kind === 'initial' ? 'Your launch direction' : turn.prompt}</h2></div><span className={`status ${turn.status}`}>{turn.status === 'complete' ? 'Ready' : turn.status === 'failed' ? 'Failed' : turn.status === 'tracking' ? 'Tracking in Trellini' : 'Writing brief'}</span></div>{turn.status === 'failed' && <p className="error">{turn.error_message || 'This run failed.'}</p>}{turn.status !== 'complete' && turn.status !== 'failed' && <div className="working" role="status"><span className="pulse" />{turn.status === 'tracking' ? 'Creating a Trellini task…' : 'Writing your brief…'}</div>}{rec && <div className="result-grid"><div className="result-main"><section className="result-card"><span className="section-kicker">01 / THE OPPORTUNITY</span><h3>Customer problem</h3><p>{rec.customer_problem}</p></section><section className="result-card"><span className="section-kicker">02 / THE STORY</span><h3>Positioning</h3><p>{rec.positioning}</p></section><section className="result-card"><span className="section-kicker">03 / THE FIRST RELEASE</span><h3>Small MVP scope</h3><ol>{(rec.mvp_scope || []).map((item, i) => <li key={i}>{item}</li>)}</ol></section></div><aside className="research-card"><span className="section-kicker">RESEARCH NOTES</span><h3>What we know<br />and what we don’t</h3><p className="research-intro">These are model-generated assumptions, not verified external research.</p>{notes.map((note, i) => <div className="note" key={i}><span>ASSUMPTION</span><p>{note.text}</p></div>)}</aside></div>}{turn.status === 'complete' && <div className="result-actions"><div>{turn.task_url ? <a href={turn.task_url} target="_blank" rel="noopener noreferrer" className="task-link">View Trellini task ↗</a> : turn.task_card_id ? <span className="task-pending">Trellini task recorded · direct link not configured</span> : null}</div><div>{turn.deck_status === 'ready' ? <button className="secondary" onClick={() => downloadDeck(turn)}>↓ &nbsp; Download PPT deck</button> : <button className="secondary" onClick={() => createDeck(turn)} disabled={Boolean(deckBusy) || credits < 1}>{deckBusy === turn.id ? 'Creating deck…' : 'Create PPT deck · 1 credit'}</button>}</div></div>}</article>; })}<form className="followup-form" onSubmit={submitFollowup}><span className="section-kicker">KEEP THE CONVERSATION GOING</span><h2>Want to explore another angle?</h2><label htmlFor="followup">Follow-up prompt</label><textarea id="followup" value={followup} onChange={e => setFollowup(e.target.value)} rows={3} maxLength={4000} placeholder="e.g. Make the MVP viable for a solo founder…" required /><div><span>✦ &nbsp;1 credit per follow-up</span><button className="primary" disabled={submitting || credits < 1}>{submitting ? 'Working…' : 'Send follow-up →'}</button></div></form></section>}</div></main></div>;
}
