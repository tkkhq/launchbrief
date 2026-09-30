const labels = { queued: 'Organizing idea…', tracking: 'Recording request…', writing: 'Writing brief…', complete: 'Ready', failed: 'Failed' };

export function getSidebarIdeas(ideas, turns, pendingIdea) {
  const latest = new Map();
  for (const turn of turns) {
    const previous = latest.get(turn.idea_id);
    if (!previous || new Date(turn.created_at) >= new Date(previous.created_at)) latest.set(turn.idea_id, turn);
  }
  const entries = ideas.map(idea => ({ ...idea, statusLabel: labels[latest.get(idea.id)?.status] || idea.category }));
  if (pendingIdea && !ideas.some(idea => idea.id === pendingIdea.id)) {
    entries.unshift({ ...pendingIdea, isPending: true, statusLabel: pendingIdea.status === 'failed' ? 'Failed' : 'Preparing brief…' });
  }
  return entries;
}
