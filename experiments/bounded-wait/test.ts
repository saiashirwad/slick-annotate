import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';

for (const progress of ['0', '10']) {
  const child = spawn(process.execPath, [new URL('./server.ts', import.meta.url).pathname], { env: { ...process.env, BW_TOKEN: 'test-only', BW_PROGRESS_MS: progress } });
  const [chunk] = await once(child.stdout, 'data');
  const { port } = JSON.parse(String(chunk));
  const url = `http://127.0.0.1:${port}`;
  const headers = { Authorization: 'Bearer test-only', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const post = (path: string, body: string, signal?: AbortSignal) => fetch(`${url}${path}`, { method: 'POST', headers, body, signal });
  const call = (method: string, params = {}, id = 1) => post('/mcp', JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  const wait = (seconds: number, id = 2) => call('tools/call', { name: 'wait_for_question', arguments: { timeout_seconds: seconds }, _meta: { progressToken: `p${id}` } }, id);
  const notification = (method: string, params = {}) => post('/mcp', JSON.stringify({ jsonrpc: '2.0', method, params }));
  const delay = (ms: number) => new Promise(done => setTimeout(done, ms));
  try {
    assert.equal((await fetch(`${url}/mcp`)).status, 401);
    assert.equal((await fetch(`${url}/mcp`, { headers: { ...headers, Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${url}/mcp`, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal(await new Promise(done => get(`${url}/mcp`, { headers: { ...headers, Host: 'evil.example' } }, r => { r.resume(); done(r.statusCode); })), 403);
    assert.equal((await fetch(`${url}/mcp`, { headers })).status, 405);
    assert.equal((await post('/mcp', '{bad')).status, 400);
    assert.equal((await post('/mcp', 'x'.repeat(17000))).status, 413);
    assert.equal((await (await call('initialize')).json()).result.protocolVersion, '2025-11-25');
    assert.equal((await notification('notifications/initialized')).status, 202);
    assert.equal((await (await call('tools/list')).json()).result.tools.length, 2);
    assert.equal((await (await call('bogus')).json()).error.code, -32601);
    assert.equal((await (await call('tools/call', { name: 'wait_for_question', arguments: { timeout_seconds: -1 } })).json()).result.isError, true);
    const first = wait(1);
    await delay(50);
    assert.equal((await (await wait(1, 3)).json()).result.isError, true);
    assert.equal((await post('/ask', 'why?')).status, 202);
    const text = await (await first).text();
    if (progress !== '0') assert.match(text, /notifications\/progress/);
    assert.match(text, /why\?/);
    assert.equal((await (await call('tools/call', { name: 'answer', arguments: { text: 'because' } })).json()).result.isError, false);
    assert.match(await (await wait(0.02)).text(), /timeout/);
    await post('/ask', 'queued');
    assert.match(await (await wait(1)).text(), /queued/);
    const cancelled = wait(1);
    await delay(20);
    assert.equal((await notification('notifications/cancelled', { requestId: 2 })).status, 202);
    assert.match(await (await cancelled).text(), /cancelled/);
    const controller = new AbortController();
    const disconnected = post('/mcp', JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'wait_for_question', arguments: { timeout_seconds: 1 } } }), controller.signal).then(r => r.text()).catch(() => 'aborted');
    await delay(20);
    controller.abort();
    await disconnected;
    await delay(20);
    assert.match(await (await wait(0.02)).text(), /timeout/);
    console.log(`PASS progress=${progress}: auth, Origin, Host, GET, malformed/oversized body, initialize, notification, list, unknown method, validation, concurrency, ask, answer, timeout, queue, cancellation, disconnect cleanup`);
  } finally { child.kill('SIGTERM'); await once(child, 'exit'); }
}
