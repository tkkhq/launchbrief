/**
 * Raw REST calls against Volcano's Query API using the service key — the
 * same pattern already used server-side in web-public's board route and
 * volcano/functions/weekly-digest.js. The service key bypasses RLS entirely,
 * so every tool that touches a board/column/card must itself check the
 * board's org_id against LEGACY_ORG_ID before mutating anything (see
 * ownership.ts) — there is no RLS backstop here like there is for the app.
 */
import { VolcanoRealtime } from '@volcano.dev/sdk/realtime';
const API_URL = requireEnv('VOLCANO_API_URL');
const SERVICE_KEY = requireEnv('VOLCANO_SERVICE_KEY');
const DATABASE = requireEnv('VOLCANO_DATABASE');
function requireEnv(name) {
    const value = process.env[name];
    if (!value)
        throw new Error(`Missing required env var ${name} (see mcp/.env.example)`);
    return value;
}
async function request(endpoint, body) {
    const res = await fetch(`${API_URL}/databases/${encodeURIComponent(DATABASE)}/query/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`${endpoint} on "${body.table}" failed: ${res.status} ${detail}`);
    }
    return res.json();
}
export async function selectRows(table, opts = {}) {
    const json = await request('select', { table, ...opts });
    return (json.data ?? []);
}
export async function selectOne(table, filters, select) {
    const rows = await selectRows(table, { select, filters, limit: 1 });
    return rows[0] ?? null;
}
export async function insertRow(table, values) {
    const json = await request('insert', { table, values });
    const row = json.data?.[0];
    if (!row)
        throw new Error(`insert into "${table}" returned no row`);
    return row;
}
export async function updateRows(table, values, filters) {
    const json = await request('update', { table, values, filters });
    return (json.data ?? []);
}
export async function deleteRows(table, filters) {
    const json = await request('delete', { table, filters });
    return json.count ?? (json.data ?? []).length;
}
/**
 * A service-key insert must supply an explicit value for every column
 * defaulted to `auth.uid()`/`auth.email()` — leaving one to resolve to NULL
 * (the documented behavior of auth.uid() under a service role) gets rejected
 * with a NOT NULL violation even on columns the schema itself marks nullable
 * (VOLCANO-BUGS.md #19). None of these columns carry a foreign key to a real
 * user row, so any UUID is accepted here; this one just reads as "not a
 * person" wherever it shows up (e.g. a card's "created by" chip).
 */
export const MCP_ACTOR = { id: '99999999-9999-9999-9999-999999999999', email: 'mcp-bot@panas.local' };
/**
 * The catch-all org this app backfilled every board into (see
 * web/lib/types.ts's LEGACY_ORG_ID) — the only org that exists in practice,
 * since the app itself has no org creation/switching UI.
 */
export const LEGACY_ORG_ID = '00000000-0000-0000-0000-000000000001';
const GAP = 1000;
/** Mirrors web/lib/board.ts's positionBetween so MCP-created rows sort the same way the app's fractional drag-drop positioning does. */
export function positionBetween(before, after) {
    if (before === null && after === null)
        return GAP;
    if (before === null)
        return after - GAP;
    if (after === null)
        return before + GAP;
    return (before + after) / 2;
}
/**
 * Service-key writes never fire `postgres_changes` (VOLCANO-BUGS #21), so a
 * connected browser client would otherwise only see this tool's writes on
 * its next unrelated reload. This mirrors `useBoard.ts`'s own
 * `notifyChange()` — same channel name, same message shape — so every
 * mutating tool call reaches watching clients like an in-app write would.
 * One connection is kept alive for this long-running stdio process rather
 * than reconnecting per call.
 */
let realtimeConn = null;
function getRealtimeConn() {
    if (!realtimeConn) {
        realtimeConn = (async () => {
            const realtime = new VolcanoRealtime({ apiUrl: API_URL, anonKey: '', accessToken: SERVICE_KEY, databaseName: DATABASE });
            await realtime.connect();
            return realtime;
        })();
    }
    return realtimeConn;
}
async function notifySync(channelName) {
    try {
        const realtime = await getRealtimeConn();
        const bus = realtime.channel(channelName, { type: 'broadcast' });
        await bus.subscribe();
        await bus.send({ type: 'sync', by: 'mcp-bot' });
    }
    catch (err) {
        // Best-effort: a missed live update degrades to "refresh to see it," the
        // status quo before this existed — never worth failing the tool call over.
        console.error(`[mcp] notify on ${channelName} failed:`, err instanceof Error ? err.message : err);
    }
}
export function notifyBoardChange(boardId) {
    return notifySync(`panas-board-${boardId}`);
}
/** The boards-home list has its own separate channel (useBoards.ts) — a board isn't "in" any one board's channel until someone's already viewing it. */
export function notifyBoardsListChange() {
    return notifySync('panas-boards');
}
/**
 * Mirrors the app's own upload (Board.tsx's uploadAttachments -> the SDK's
 * storage.upload, which is POST /storage/{bucket}/{path} with the file as
 * multipart form field "file") — same bucket, same auth pattern as every
 * other write here.
 */
const ATTACHMENT_BUCKET = 'card-files';
export async function uploadAttachmentFile(path, bytes, contentType, fileName) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), fileName);
    const res = await fetch(`${API_URL}/storage/${encodeURIComponent(ATTACHMENT_BUCKET)}/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}` },
        body: form,
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Upload to storage failed: ${res.status} ${detail}`);
    }
}
/** Mirrors web/lib/board.ts's attachmentPath. */
export function attachmentPath(boardId, cardId, fileName) {
    const safe = fileName
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'file';
    return `boards/${boardId}/cards/${cardId}/${Date.now()}-${safe}`;
}
