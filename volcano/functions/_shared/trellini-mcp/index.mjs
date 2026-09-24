import './load-env.mjs';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { attachmentPath, deleteRows, insertRow, LEGACY_ORG_ID, MCP_ACTOR, notifyBoardChange, notifyBoardsListChange, positionBetween, selectRows, updateRows, uploadAttachmentFile, } from './volcano.mjs';
import { requireBoard, requireCard, requireColumn } from './ownership.mjs';
import { BOARD_TEMPLATES } from './templates.mjs';
const Accent = z.enum(['violet', 'cyan', 'amber', 'rose', 'lime', 'slate']);
const Priority = z.enum(['low', 'normal', 'high']);
const TemplateId = z.enum(BOARD_TEMPLATES.map((t) => t.id));
// Mirrors the card-files bucket's own server-side allowlist (web/lib/types.ts's
// ALLOWED_ATTACHMENT_TYPES) — checked here first for a friendlier error than
// the bucket's own rejection.
const MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.zip': 'application/zip',
};
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function fail(message) {
    return { content: [{ type: 'text', text: message }], isError: true };
}
const server = new McpServer({ name: 'panas-board', version: '0.1.0' });
server.registerTool('list_boards', {
    title: 'List boards',
    description: "Lists every board on the team's Panas instance, with column and card counts.",
    inputSchema: {},
}, async () => {
    const boards = await selectRows('boards', {
        filters: [{ column: 'org_id', operator: 'eq', value: LEGACY_ORG_ID }],
        order: [{ column: 'created_at', ascending: false }],
    });
    const cards = await selectRows('cards', { select: ['board_id'] });
    const counts = new Map();
    for (const c of cards)
        counts.set(c.board_id, (counts.get(c.board_id) ?? 0) + 1);
    return ok(boards.map((b) => ({
        id: b.id,
        name: b.name,
        visibility: b.visibility,
        card_count: counts.get(b.id) ?? 0,
        created_by_email: b.created_by_email,
        created_at: b.created_at,
    })));
});
server.registerTool('get_board', {
    title: 'Get board',
    description: 'Fetches one board — its columns and cards, in position order — by id.',
    inputSchema: { board_id: z.string().uuid() },
}, async ({ board_id }) => {
    try {
        const board = await requireBoard(board_id);
        const [columns, cards] = await Promise.all([
            selectRows('board_columns', { filters: [{ column: 'board_id', operator: 'eq', value: board_id }] }),
            selectRows('cards', { filters: [{ column: 'board_id', operator: 'eq', value: board_id }] }),
        ]);
        columns.sort((a, b) => a.position - b.position);
        cards.sort((a, b) => a.position - b.position);
        return ok({
            board: { id: board.id, name: board.name, visibility: board.visibility, label_palette: board.label_palette },
            columns: columns.map((col) => ({
                id: col.id,
                title: col.title,
                accent: col.accent,
                is_done: col.is_done,
                cards: cards
                    .filter((c) => c.column_id === col.id)
                    .map((c) => ({
                    id: c.id,
                    title: c.title,
                    notes: c.notes,
                    assignee: c.assignee || null,
                    priority: c.priority,
                    labels: c.labels,
                    completed_at: c.completed_at,
                })),
            })),
        });
    }
    catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
    }
});
server.registerTool('create_board', {
    title: 'Create board',
    description: 'Creates a new board, optionally seeded with one of the built-in templates: ' +
        BOARD_TEMPLATES.map((t) => `"${t.id}" (${t.title})`).join(', ') +
        '. Omit template for a single blank column.',
    inputSchema: { name: z.string().min(1), template: TemplateId.optional() },
}, async ({ name, template }) => {
    const board = await insertRow('boards', {
        name,
        org_id: LEGACY_ORG_ID,
        created_by: MCP_ACTOR.id,
        created_by_email: MCP_ACTOR.email,
    });
    const columnSpecs = template
        ? BOARD_TEMPLATES.find((t) => t.id === template).columns
        : [{ title: 'New column', accent: 'violet', is_done: false }];
    const columns = [];
    let lastPosition = null;
    for (const spec of columnSpecs) {
        const position = positionBetween(lastPosition, null);
        lastPosition = position;
        columns.push(await insertRow('board_columns', {
            board_id: board.id,
            title: spec.title,
            accent: spec.accent,
            is_done: spec.is_done,
            position,
            created_by: MCP_ACTOR.id,
        }));
    }
    await notifyBoardsListChange();
    return ok({ board: { id: board.id, name: board.name }, columns: columns.map((c) => ({ id: c.id, title: c.title })) });
});
server.registerTool('create_column', {
    title: 'Create column',
    description: 'Adds a new column to the end of a board.',
    inputSchema: {
        board_id: z.string().uuid(),
        title: z.string().min(1),
        accent: Accent.optional(),
        is_done: z.boolean().optional(),
    },
}, async ({ board_id, title, accent, is_done }) => {
    try {
        await requireBoard(board_id);
        const [last] = await selectRows('board_columns', {
            filters: [{ column: 'board_id', operator: 'eq', value: board_id }],
            order: [{ column: 'position', ascending: false }],
            limit: 1,
        });
        const column = await insertRow('board_columns', {
            board_id,
            title,
            accent: accent ?? 'violet',
            is_done: is_done ?? false,
            position: positionBetween(last?.position ?? null, null),
            created_by: MCP_ACTOR.id,
        });
        await notifyBoardChange(board_id);
        return ok({ id: column.id, title: column.title });
    }
    catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
    }
});
server.registerTool('create_card', {
    title: 'Create card',
    description: 'Adds a new card to the end of a column.',
    inputSchema: {
        column_id: z.string().uuid(),
        title: z.string().min(1),
        notes: z.string().optional().describe('Rendered as Markdown (GFM: tables, task lists, strikethrough, fenced code) in the app.'),
        priority: Priority.optional(),
        labels: z.array(z.string()).optional(),
    },
}, async ({ column_id, title, notes, priority, labels }) => {
    try {
        const { column, board } = await requireColumn(column_id);
        const [last] = await selectRows('cards', {
            filters: [{ column: 'column_id', operator: 'eq', value: column_id }],
            order: [{ column: 'position', ascending: false }],
            limit: 1,
        });
        const values = {
            board_id: board.id,
            column_id: column.id,
            title,
            position: positionBetween(last?.position ?? null, null),
            created_by: MCP_ACTOR.id,
            created_by_email: MCP_ACTOR.email,
        };
        if (notes !== undefined)
            values.notes = notes;
        if (priority !== undefined)
            values.priority = priority;
        // JSONB column — the query API needs a pre-serialized JSON string on
        // the wire, not the native array (VOLCANO-BUGS.md #17).
        if (labels !== undefined)
            values.labels = JSON.stringify(labels);
        const card = await insertRow('cards', values);
        await notifyBoardChange(board.id);
        return ok({ id: card.id, title: card.title });
    }
    catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
    }
});
server.registerTool('update_card', {
    title: 'Update card',
    description: "Patches a card's title, notes, assignee, priority, labels, or deadline. Setting a deadline only " +
        'starts the staleness-escalation emoji once its durable execution is started separately — this tool ' +
        'just sets the column value. Pass deadline: null to clear it (turns escalation off for the card).',
    inputSchema: {
        card_id: z.string().uuid(),
        title: z.string().min(1).optional(),
        notes: z.string().optional().describe('Rendered as Markdown (GFM: tables, task lists, strikethrough, fenced code) in the app.'),
        assignee: z.string().optional(),
        priority: Priority.optional(),
        labels: z.array(z.string()).optional(),
        deadline: z.string().datetime().nullable().optional().describe('ISO 8601 timestamp, or null to clear it'),
    },
}, async ({ card_id, title, notes, assignee, priority, labels, deadline }) => {
    try {
        const { board } = await requireCard(card_id);
        const values = { updated_at: new Date().toISOString() };
        if (title !== undefined)
            values.title = title;
        if (notes !== undefined)
            values.notes = notes;
        if (assignee !== undefined)
            values.assignee = assignee;
        if (priority !== undefined)
            values.priority = priority;
        if (labels !== undefined)
            values.labels = JSON.stringify(labels);
        if (deadline !== undefined)
            values.deadline = deadline;
        const [updated] = await updateRows('cards', values, [{ column: 'id', operator: 'eq', value: card_id }]);
        await notifyBoardChange(board.id);
        return ok({ id: updated.id, title: updated.title });
    }
    catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
    }
});
server.registerTool('move_card', {
    title: 'Move card',
    description: 'Moves a card to a (possibly different) column at a given position. Moving into a column ' +
        'marked "done" stamps completed_at, same as dragging it there in the app; moving out clears it.',
    inputSchema: {
        card_id: z.string().uuid(),
        column_id: z.string().uuid(),
        index: z.number().int().min(0).optional().describe('0-based position within the destination column; omit to append at the end'),
    },
}, async ({ card_id, column_id, index }) => {
    try {
        const { card } = await requireCard(card_id);
        const { column: destination, board: destBoard } = await requireColumn(column_id);
        const { board: cardBoard } = await requireColumn(card.column_id);
        if (destBoard.id !== cardBoard.id)
            return fail('Cannot move a card to a column on a different board');
        const siblings = (await selectRows('cards', { filters: [{ column: 'column_id', operator: 'eq', value: column_id }] }))
            .filter((c) => c.id !== card_id)
            .sort((a, b) => a.position - b.position);
        const at = index === undefined ? siblings.length : Math.min(index, siblings.length);
        const before = at > 0 ? siblings[at - 1].position : null;
        const after = at < siblings.length ? siblings[at].position : null;
        const values = {
            column_id,
            position: positionBetween(before, after),
            updated_at: new Date().toISOString(),
            completed_at: destination.is_done ? new Date().toISOString() : null,
            completed_by: null,
            completed_by_email: null,
        };
        const [updated] = await updateRows('cards', values, [{ column: 'id', operator: 'eq', value: card_id }]);
        await notifyBoardChange(destBoard.id);
        return ok({ id: updated.id, column_id: updated.column_id, completed_at: updated.completed_at });
    }
    catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
    }
});
server.registerTool('delete_card', {
    title: 'Delete card',
    description: 'Permanently deletes a card.',
    inputSchema: { card_id: z.string().uuid() },
}, async ({ card_id }) => {
    try {
        const { board } = await requireCard(card_id);
        await deleteRows('cards', [{ column: 'id', operator: 'eq', value: card_id }]);
        await notifyBoardChange(board.id);
        return ok({ deleted: true });
    }
    catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
    }
});
server.registerTool('attach_file', {
    title: 'Attach file',
    description: 'Attaches a local file (image, PDF, or a few other types — same allowlist the app itself enforces) to a card, ' +
        'the same way dragging a file onto the card panel does. file_path is a path on this machine, not a URL.',
    inputSchema: {
        card_id: z.string().uuid(),
        file_path: z.string().min(1).describe('Absolute path to the file on disk'),
    },
}, async ({ card_id, file_path }) => {
    try {
        const { board } = await requireCard(card_id);
        const stats = await stat(file_path).catch(() => null);
        if (!stats || !stats.isFile())
            return fail(`No file at "${file_path}"`);
        if (stats.size > MAX_ATTACHMENT_BYTES) {
            return fail(`"${file_path}" is ${stats.size} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte limit`);
        }
        const fileName = file_path.split('/').pop() || 'file';
        const mimeType = MIME_BY_EXT[extname(fileName).toLowerCase()];
        if (!mimeType) {
            return fail(`Unsupported file type "${extname(fileName)}" — allowed: ${Object.keys(MIME_BY_EXT).join(', ')}`);
        }
        const bytes = await readFile(file_path);
        const path = attachmentPath(board.id, card_id, fileName);
        await uploadAttachmentFile(path, bytes, mimeType, fileName);
        const attachment = await insertRow('card_attachments', {
            board_id: board.id,
            card_id,
            path,
            name: fileName,
            size: stats.size,
            mime_type: mimeType,
            uploaded_by: MCP_ACTOR.id,
            uploaded_by_email: MCP_ACTOR.email,
        });
        await notifyBoardChange(board.id);
        return ok({ id: attachment.id, name: attachment.name });
    }
    catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
    }
});
server.registerTool('search_cards', {
    title: 'Search cards',
    description: 'Finds cards whose title or notes contain the given text, optionally scoped to one board.',
    inputSchema: { query: z.string().min(1), board_id: z.string().uuid().optional() },
}, async ({ query, board_id }) => {
    try {
        let boardIds;
        if (board_id) {
            boardIds = [(await requireBoard(board_id)).id];
        }
        else {
            const boards = await selectRows('boards', {
                select: ['id'],
                filters: [{ column: 'org_id', operator: 'eq', value: LEGACY_ORG_ID }],
            });
            boardIds = boards.map((b) => b.id);
        }
        if (boardIds.length === 0)
            return ok([]);
        const scope = { column: 'board_id', operator: 'in', value: boardIds };
        const like = `%${query}%`;
        const [byTitle, byNotes] = await Promise.all([
            selectRows('cards', { filters: [scope, { column: 'title', operator: 'ilike', value: like }], limit: 25 }),
            selectRows('cards', { filters: [scope, { column: 'notes', operator: 'ilike', value: like }], limit: 25 }),
        ]);
        const byId = new Map();
        for (const c of [...byTitle, ...byNotes])
            byId.set(c.id, c);
        return ok([...byId.values()].map((c) => ({
            id: c.id,
            board_id: c.board_id,
            title: c.title,
            notes: c.notes,
            completed_at: c.completed_at,
        })));
    }
    catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
    }
});
const transport = new StdioServerTransport();
await server.connect(transport);
