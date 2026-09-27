import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Produce a shareable record without client session IDs, credentials, or full prompts.
const summaries: object[] = [];
for (const root of process.argv.slice(2)) {
  for (const name of await readdir(root)) {
    const dir = resolve(root, name);
    let exit: any;
    try { exit = JSON.parse(await readFile(resolve(dir, 'exit.json'), 'utf8')); } catch { continue; }
    const events = (await readFile(resolve(dir, 'server.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
    const calls = events.filter(e => e.event === 'request' && e.method === 'tools/call');
    if (!calls.length) continue;
    const client = (await readFile(resolve(dir, 'client.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
    const messages = client.flatMap(e => e.type === 'text' ? [e.part.text] : e.item?.type === 'agent_message' ? [e.item.text] : []);
    const errors = client.flatMap(e => e.part?.state?.error ? [e.part.state.error] : e.item?.error ? [e.item.error] : []);
    summaries.push({ ...exit, handshake: events.find(e => e.method === 'initialize')?.params, calls: calls.map(e => ({ id: e.id, tool: e.params.name, arguments: e.params.arguments, progressTokenSupplied: e.params._meta?.progressToken !== undefined })), outcomes: events.filter(e => ['finish', 'disconnect', 'answer'].includes(e.event)).map(({ at, ...event }) => event), progressCount: events.filter(e => e.event === 'progress').length, cancellations: events.filter(e => e.method === 'notifications/cancelled').map(e => e.params), messages, errors });
  }
}
await writeFile(resolve(import.meta.dirname, 'results.json'), JSON.stringify(summaries, null, 2) + '\n');
console.log(`Wrote ${summaries.length} completed cases`);
