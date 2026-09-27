# Bounded-wait MCP spike

Throwaway Node 24 TypeScript (built-in type stripping), no packages or install step.
See [findings](../../docs/research/bounded-wait-mcp.md). `server.ts` is intentionally
not a reusable, fully conformant MCP implementation.

## Smoke tests

```sh
node experiments/bounded-wait/test.ts
```

Tests JSON and SSE modes, bearer authentication, hostile Origin/Host, malformed
and oversized bodies, initialize/list/call, question queueing, replies, timeout,
one-waiter limit, explicit cancellation, and HTTP disconnect cleanup.

## Real terminal clients

Requires installed/authenticated `opencode` and `codex`; does not log in, run
Claude, or modify either client's global configuration. OpenCode reuses the
existing `oai/astralow` provider configuration on the test machine. Change that
model in `run.ts` for another environment. Codex uses its existing ChatGPT auth
with `--ignore-user-config`, `--ephemeral`, and a read-only sandbox. Its tool
approval is explicitly scoped to this test server (`approve`, not `auto`).

Each case gets its own server/port/token and client directory. `PWD` **must**
match the child working directory for OpenCode. The runner closes child stdin;
otherwise noninteractive CLIs wait for additional input rather than run.
It runs independent cases concurrently, without asking clients to research,
change files, or spawn agents. A 13-minute watchdog bounds each CLI invocation.
Use a fresh output directory: the runner refuses to append to previous runs.

```sh
BW_RUN_ROOT="$HOME/worktrees/bounded-wait-rerun" node experiments/bounded-wait/run.ts \
  opencode:30:default:0 opencode:120:default:0 opencode:600:default:0 \
  opencode:30:5:0 opencode:30:5:1000 opencode:idleloop:default:0 \
  codex:30:default:0 codex:120:default:0 codex:600:default:0 \
  codex:120:150:0 codex:600:660:0 codex:120:default:10000 \
  codex:30:5:0 codex:30:5:1000 codex:idleloop:default:0
```

Case format: `client:waitSeconds:clientTimeoutSeconds|default:progressIntervalMs`.
Append `:code` to test OpenCode's Code Mode instead of direct tools. Additional
long-wait diagnostics used `opencode:600:660:0`, `opencode:600:660:10000`, and
`opencode:600:660:700000`. The last flushes SSE headers immediately but schedules
its first progress event after the wait would already finish, isolating headers
from periodic progress.

`loop` performs three wait/answer cycles; `idleloop` first allows one 30-second
server timeout, then performs three question/answer cycles. Questions are sent
to `/ask` one second after the server receives each eligible wait call.
No additional user prompts are submitted during the loop.

Logs are raw local evidence; don't publish them blindly. Produce the compact
shareable record (omits raw client identifiers and credentials) with:

```sh
node experiments/bounded-wait/summarize.ts "$HOME/worktrees/bounded-wait-rerun"
```

`results.json` is the committed record from this experiment, including server
elapsed times and client-reported errors. CLI wall time also includes startup
and model turns; it is **not** the MCP call duration.

## Manual server

```sh
export BW_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')"
BW_PORT=8765 node experiments/bounded-wait/server.ts
# Another terminal with the same token:
curl -H "Authorization: Bearer $BW_TOKEN" --data 'why?' http://127.0.0.1:8765/ask
```

Set `BW_PROGRESS_MS=1000` to use request-scoped SSE; otherwise tool results use
plain JSON. Only a supplied MCP progress token permits actual progress events.
`answer` records text in the JSONL server log. Stop the server with SIGTERM.
The harness automatically terminates its servers when their clients exit.

## Deliberate omissions

One consumer, in-memory queue, no durable question IDs/acknowledgments, no replay,
no OAuth, no sessions, no multiple windows, no cancellation ownership across
clients, no lifecycle state enforcement, incomplete JSON-RPC/schema/version/
Accept validation, no bounded queue, and no SSE resumption. Disconnect cleanup
is specific to this disposable waiting operation, not a general claim that an
HTTP disconnect cancels MCP execution. The spike must not be shipped unchanged.
