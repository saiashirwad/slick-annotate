import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

// Deliberately narrow, stateless 2025-11-25 tools-only spike; not a general MCP server.
const token = process.env.BW_TOKEN || randomBytes(24).toString('hex');
const progress = Number(process.env.BW_PROGRESS_MS || 0);
const queue: string[] = [];
const pending = new Map<string | number, (value: object) => void>();
const log = (event: string, data: object = {}) => console.log(JSON.stringify({ at: Date.now(), event, ...data }));
const tools = [
  { name: 'wait_for_question', description: 'Wait for a question or a bounded timeout. On timeout you may wait again.', inputSchema: { type: 'object', properties: { timeout_seconds: { type: 'number', minimum: 0, maximum: 660 } }, required: ['timeout_seconds'], additionalProperties: false } },
  { name: 'answer', description: 'Record a reply to the question.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
];
const server = createServer(async (req, res) => {
  const status = (code: number) => { res.writeHead(code); res.end(); };
  if (req.headers.origin || req.headers.host !== `127.0.0.1:${(server.address() as any).port}`) return status(403);
  if (req.headers.authorization !== `Bearer ${token}`) { log('unauthorized', { hasHeader: !!req.headers.authorization }); return status(401); }
  if (req.method !== 'POST') return status(405);
  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 16384) return status(413);
    }
    if (req.url === '/ask') {
      const waiter = pending.values().next().value;
      if (waiter) waiter({ question: body }); else queue.push(body);
      log('ask', { question: body });
      return status(202);
    }
    if (req.url !== '/mcp') return status(404);
    if (!req.headers['content-type']?.includes('application/json')) return status(415);
    const m = JSON.parse(body);
    if (Array.isArray(m) || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return status(400);
    log('request', { id: m.id, method: m.method, params: m.params });
    const json = (value: object) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...value })); };
    if (m.id === undefined) {
      if (m.method === 'notifications/cancelled') pending.get(m.params?.requestId)?.({ cancelled: true });
      return status(202);
    }
    if (m.method === 'initialize') return json({ result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'bounded-wait-spike', version: '0.1.0' } } });
    if (m.method === 'ping') return json({ result: {} });
    if (m.method === 'tools/list') return json({ result: { tools } });
    if (m.method !== 'tools/call') return json({ error: { code: -32601, message: 'Method not found' } });
    const a = m.params?.arguments;
    const result = (value: object, isError = false) => ({ result: { content: [{ type: 'text', text: JSON.stringify(value) }], isError } });
    if (m.params.name === 'answer' && typeof a?.text === 'string') {
      log('answer', { text: a.text });
      return json(result({ recorded: true }));
    }
    if (m.params.name !== 'wait_for_question' || !Number.isFinite(a?.timeout_seconds) || a.timeout_seconds < 0 || a.timeout_seconds > 660) return json(result({ error: 'Invalid tool or arguments' }, true));
    if (pending.size) return json(result({ error: 'Only one waiter per spike server' }, true));
    if (queue.length) return json(result({ question: queue.shift() }));
    const started = Date.now();
    const pt = m.params._meta?.progressToken;
    const sse = progress > 0;
    if (sse) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.flushHeaders(); }
    let timer: NodeJS.Timeout;
    let heartbeat: NodeJS.Timeout | undefined;
    const cleanup = () => { clearTimeout(timer); clearInterval(heartbeat); pending.delete(m.id); };
    const finish = (value: object) => {
      cleanup();
      log('finish', { id: m.id, elapsedMs: Date.now() - started, ...value });
      if (sse) res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, ...result(value) })}\n\n`);
      else json(result(value));
    };
    pending.set(m.id, finish);
    timer = setTimeout(() => finish({ timeout: true }), a.timeout_seconds * 1000);
    if (sse) heartbeat = setInterval(() => {
      if (pt === undefined) return log('progress-unavailable', { id: m.id });
      const params = { progressToken: pt, progress: (Date.now() - started) / 1000, total: a.timeout_seconds };
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params })}\n\n`);
      log('progress', { id: m.id });
    }, progress);
    res.on('close', () => { if (pending.has(m.id)) { log('disconnect', { id: m.id, elapsedMs: Date.now() - started }); cleanup(); } });
  } catch (error) { log('error', { message: String(error) }); if (!res.headersSent) status(400); else res.end(); }
});
server.requestTimeout = 0;
server.listen(Number(process.env.BW_PORT || 0), '127.0.0.1', () => log('listening', { port: (server.address() as any).port }));
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
