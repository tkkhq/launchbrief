const test = require('node:test');
const assert = require('node:assert/strict');
const { makeTrelliniCardGuard } = require('../volcano/functions/_shared/agent');

test('Trellini tool guard replaces model-supplied card fields and blocks extra calls', async () => {
  const card = { boardId: 'board', columnId: 'column', title: 'LaunchBrief: Actual idea', notes: 'Actual submitted prompt' };
  const { guard, count } = makeTrelliniCardGuard(card);
  const first = await guard({ tool_name: 'mcp__trellini__create_card', tool_input: { board_id: 'wrong', notes: 'injected' } });
  assert.equal(first.hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(first.hookSpecificOutput.updatedInput, { board_id: 'board', column_id: 'column', title: card.title, notes: card.notes, priority: 'normal' });
  const second = await guard({ tool_name: 'mcp__trellini__create_card', tool_input: {} });
  assert.equal(second.hookSpecificOutput.permissionDecision, 'deny');
  const other = await guard({ tool_name: 'mcp__trellini__create_board', tool_input: {} });
  assert.equal(other.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(count(), 1);
});
