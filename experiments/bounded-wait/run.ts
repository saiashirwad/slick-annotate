import { spawn } from 'node:child_process';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(process.env.BW_RUN_ROOT || resolve(import.meta.dirname, 'runs'));
const cases = process.argv.slice(2);
// Examples: opencode:600:default:0 codex:120:default:0 codex:600:660:0
async function run(spec: string) {
  const [client, secondsText, limit, progressText] = spec.split(':');
  const seconds = Number(secondsText), progress = Number(progressText);
  const dir = resolve(root, spec.replaceAll(':', '-'));
  await mkdir(root, { recursive: true });
  await mkdir(dir); // Refuse to mix a new run with old append-only evidence.
  const token = randomBytes(24).toString('hex');
  const env = { ...process.env, PWD: dir, BW_TOKEN: token, BW_PROGRESS_MS: String(progress) };
  const server = spawn(process.execPath, [resolve(import.meta.dirname, 'server.ts')], { env });
  let port: number;
  let waits = 0;
  const ready = new Promise<void>(done => {
    server.stdout.on('data', async chunk => {
      await appendFile(resolve(dir, 'server.jsonl'), chunk);
      for (const line of String(chunk).trim().split('\n')) {
        const event = JSON.parse(line);
        if (event.event === 'listening') { port = event.port; done(); }
        if (spec.includes('loop') && event.event === 'request' && event.params?.name === 'wait_for_question') {
          if (spec.includes('idleloop') && ++waits === 1) continue;
          setTimeout(() => fetch(`http://127.0.0.1:${port}/ask`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'What is 2 + 2?' }), 1000);
        }
      }
    });
  });
  await ready;
  const url = `http://127.0.0.1:${port!}/mcp`;
  const prompt = spec.includes('loop')
    ? 'Test only the bounded MCP tools. Perform exactly three cycles: wait_for_question(timeout_seconds=30), answer the returned question using answer(text), then immediately wait again without asking me. If a wait times out, immediately wait again without asking me; do not answer the timeout. After three answers stop. No shell, files, or other tools.'
    : `Test only the bounded MCP tools. Call wait_for_question exactly once with timeout_seconds=${seconds}. Do not shorten this duration. Wait for its result even if slow. Then report the result or error and stop; do not retry. No shell, files, or other tools.`;
  let args: string[];
  if (client === 'opencode') {
    const bounded: any = { type: 'remote', url, oauth: false, codemode: spec.endsWith(':code'), headers: { Authorization: 'Bearer {env:BW_TOKEN}' } };
    if (limit !== 'default') bounded.timeout = { execution: Number(limit) * 1000 };
    await writeFile(resolve(dir, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'oai/astralow', snapshots: false, mcp: { servers: { bounded, pencil: { type: 'local', command: ['node', '-e', ''], disabled: true } } } }, null, 2));
    args = ['run', '--standalone', '--print-logs', '--auto', '--format', 'json', prompt];
  } else {
    args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--json', '-s', 'read-only', '-c', `mcp_servers.bounded.url="${url}"`, '-c', 'mcp_servers.bounded.bearer_token_env_var="BW_TOKEN"', '-c', 'mcp_servers.bounded.required=true', '-c', 'mcp_servers.bounded.default_tools_approval_mode="approve"'];
    if (limit !== 'default') args.push('-c', `mcp_servers.bounded.tool_timeout_sec=${limit}`);
    args.push(prompt);
  }
  await writeFile(resolve(dir, 'case.json'), JSON.stringify({ spec, prompt, args }, null, 2));
  const started = Date.now();
  const child = spawn(client, args, { cwd: dir, env, detached: true });
  child.stdin.end();
  child.stdout.on('data', chunk => appendFile(resolve(dir, 'client.jsonl'), chunk));
  child.stderr.on('data', chunk => appendFile(resolve(dir, 'stderr.log'), chunk));
  const watchdog = setTimeout(() => process.kill(-child.pid!, 'SIGTERM'), 780000);
  const code = await new Promise(done => child.on('exit', done));
  clearTimeout(watchdog);
  server.kill('SIGTERM');
  const result = { spec, code, elapsedMs: Date.now() - started };
  await writeFile(resolve(dir, 'exit.json'), JSON.stringify(result));
  console.log(result);
}
await Promise.all(cases.map(run));
