import { LEGACY_ORG_ID, selectOne } from './volcano.mjs';
/**
 * The service key bypasses RLS entirely, so unlike the app itself, nothing
 * here stops a tool from touching a board outside this app's one org unless
 * we check for it ourselves. Every mutating tool resolves its target through
 * one of these before writing anything.
 */
export async function requireBoard(boardId) {
    const board = await selectOne('boards', [
        { column: 'id', operator: 'eq', value: boardId },
        { column: 'org_id', operator: 'eq', value: LEGACY_ORG_ID },
    ]);
    if (!board)
        throw new Error(`No board "${boardId}" in this app's org`);
    return board;
}
export async function requireColumn(columnId) {
    const column = await selectOne('board_columns', [{ column: 'id', operator: 'eq', value: columnId }]);
    if (!column)
        throw new Error(`No column "${columnId}"`);
    const board = await requireBoard(column.board_id);
    return { column, board };
}
export async function requireCard(cardId) {
    const card = await selectOne('cards', [{ column: 'id', operator: 'eq', value: cardId }]);
    if (!card)
        throw new Error(`No card "${cardId}"`);
    const { column, board } = await requireColumn(card.column_id);
    return { card, column, board };
}
