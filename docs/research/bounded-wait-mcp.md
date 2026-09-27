# Bounded-wait MCP in terminal agents

## Recommendation

Use **30-second bounded waits**, return a normal `{timeout:true}` tool result on
idle, and explicitly instruct the Tour-authoring agent to repeat
**wait → answer → wait** until the user stops it. Set a **60-second client tool
execution timeout explicitly** rather than relying on vendor defaults. A longer
wait can reduce idle model turns, but it must have a correspondingly larger
client budget, and should remain an opt-in tuning choice. Progress notifications
are **not a way around a hard client deadline**.

A dependency-free, tools-only Streamable HTTP implementation is small enough to
consider: this spike is **80 physical lines** of Node TypeScript, including
security checks, instrumentation, queueing, two tools, cancellation, and optional
SSE progress. That demonstrates wire feasibility, not production completeness.
Keep the first bridge JSON-only with short waits; SSE is unnecessary for that
baseline. If ten-minute waits are required, OpenCode needs more than a larger
execution budget: SSE with 10s progress succeeded where silent JSON failed.
Use OpenCode's direct-tool configuration (`codemode:false`) for the measured
baseline. **A silent ten-minute JSON wait is not a portable default:** OpenCode
failed after about 356s, and Codex's default execution budget is 300s in the
installed version. These limits do not rule out short bounded waiting. Claude Code has
additional documented idle/first-byte/backgrounding behavior and was **not run**.

Research date: 2026-09-27. Resolves
[Does a bounded-wait MCP tool work in real terminal agents?](https://github.com/saiashirwad/slick-annotate/issues/9)
for [Map: agent bridge and tours](https://github.com/saiashirwad/slick-annotate/issues/1).
This is an executed experiment, not just protocol research. No VS Code, Claude
CLI, research subagents, or global configuration edits were used.

## Experiment and evidence

- Node **v24.21.0**, native TypeScript stripping, `node:http`, `node:crypto`, zero runtime dependencies.
- OpenCode **v2.0.18**, `opencode run --standalone --auto --format json`, existing `oai/astralow` model/provider; direct MCP tools (`codemode:false`).
- Codex **0.157.1**, already signed into ChatGPT; `codex exec --ignore-user-config --ephemeral --json -s read-only`; recorded call metadata identifies model `gpt-6-astra`.
- Per-case loopback server with random port and bearer token. All endpoints require authentication. Present Origin is rejected; Host must match the literal loopback endpoint. No token is logged.
- Server advertises **2025-11-25**, tools only, no protocol session. OpenCode requested that revision; Codex requested **2025-06-18** and accepted the server's **2025-11-25** response, initialized, listed, and called tools successfully.
- No question is injected in timing cases: success means the client receives the actual server timeout result after the requested duration. Loop cases receive a question through authenticated HTTP `/ask` one second after the wait begins.
- [Spike and reproduction instructions](../../experiments/bounded-wait/README.md), [server](../../experiments/bounded-wait/server.ts), [runner](../../experiments/bounded-wait/run.ts), [smoke tests](../../experiments/bounded-wait/test.ts), [compact measured evidence](../../experiments/bounded-wait/results.json).

The runner gives each CLI a fresh prompt, not a delegated research assignment.
Its only assigned job is to exercise the two tools. OpenCode sometimes made a
tool-catalog discovery call despite the prompt's no-other-tools restriction;
there were no research, file-editing, or shell tasks delegated to the clients.
Timings below refer to server request lifetime, not total CLI wall time (which
includes model generation and startup).
Single trials are interoperability evidence, not a statistical reliability study.
An additional OpenCode **Code Mode** run passed both 30s and 120s waits; the
600s and cancellation baseline uses direct tools, avoiding an extra execution
layer. Code Mode was not tested for a ten-minute wait or the repeated loop.

## Measurements

| Client / configuration | Server wait | Wire response | Observed outcome |
| --- | ---: | --- | --- |
| OpenCode, default execution budget, direct tools | 30s | JSON | Success, 30.001s |
| OpenCode, default execution budget, direct tools | 120s | JSON | Success, 120.001s |
| OpenCode, default execution budget, direct tools | 600s | JSON | Failure, transport `TimeoutError`; socket closed at 355.554s |
| Codex, no timeout override | 30s | JSON | Success, 30.002s |
| Codex, no timeout override | 120s | JSON | Success, 120.002s |
| Codex, no timeout override | 120s | SSE, progress every 10s | Success, 120.001s; 11 progress events |
| Codex, no timeout override | 600s | JSON | Failure, client reports timeout after 300s |
| Codex, explicit 150s budget | 120s | JSON | Success, 120.001s |
| Codex, explicit 660s budget | 600s | JSON | Success, 600.002s |

| OpenCode follow-up, explicit 660s execution budget | Server wait | Wire response | Observed outcome |
| --- | ---: | --- | --- |
| Direct tools | 600s | JSON | Failure again, socket closed at 353.831s |
| Direct tools | 600s | SSE, progress every 10s | Success, 600.003s; 59 progress events |
| Direct tools | 600s | SSE headers immediately, no progress before completion | Failure: stream disconnected at 354.688s; client finally reported `Request timed out` at 660.068s |

Raising OpenCode's execution budget alone did **not** fix its silent JSON
request. Its log attributes the JSON error to `mcp http request failed` with
`TimeoutError`, not the explicit tool execution deadline. SSE with periodic
progress did survive, while **headers alone did not**. In that control the
server released the disconnected waiter; OpenCode remained pending until its
660s execution deadline, then sent cancellation. This supports a separate
transport-idleness limit, but does not identify the underlying runtime timer
with certainty. A ten-minute wait needs both a sufficient execution budget and
periodic transport activity on this OpenCode build; short JSON waits avoid both
extra configuration and SSE maintenance.

### Client deadlines and progress

**Codex documentation drift matters:** the current MCP guide says the default
is 60 seconds, but the source tag matching the installed **0.157.1** defines
`DEFAULT_TOOL_TIMEOUT = Duration::from_secs(300)` (and startup 30s, not the
guide's 10s). The connection manager uses that constant when no override is
present. That explains why the unconfigured 120-second JSON wait succeeds.
Use an explicit timeout rather than building a contract around either default.
See the [version-pinned constant][codexsource] and [selection logic][codexmanager].

OpenCode with a deliberately short **5-second execution timeout** cancels a
30-second wait at approximately five seconds. Sending progress every second does
not extend that deadline. Codex with `tool_timeout_sec=5` likewise returns
`timed out awaiting tools/call after 5s`, with or without one-second progress.
This isolates client timeout from the server's ordinary timeout result.

OpenCode sent `notifications/cancelled` at **5.003s** without progress and
**5.002s** with progress. Codex sent **no cancellation notification** in these
trials: it reported the five-second error, while the server waiter remained
until connection/CLI teardown (8.306s and 7.426s respectively). The harness
also terminates the server when the CLI exits, so those latter times are not
claimed as Codex's timeout precision. An interactive client's behavior after
that error is untested. Do not rely on a client timeout to immediately release
a waiter or acknowledge a question.

Both clients supply a progress token on actual wait requests. The server sends
proper `notifications/progress` in the POST's SSE response, not fake logging or
an unrelated GET stream. The smoke tests also parse those events. Receiving
progress does not itself mean the agent is reasoning during the wait.

### The loop actually ran

Both clients completed **three wait → answer cycles** from one initial prompt,
recording `4` in response to `What is 2 + 2?`, then waiting again without another
human message. In a second test, both first waited **30 seconds with no question**,
received `{timeout:true}`, immediately called wait again, and subsequently
completed three question/answer cycles. Thus they handle the idle timeout path,
not merely three prequeued questions.

This proves a finite instructed loop, **not** permanent autonomous availability.
It does not test hours of repetition, context compaction, cancellation through a
TUI, laptop sleep, network changes, or restarting an exited client. Once the
agent ends its turn/session, the HTTP queue cannot wake it. Expose the listening
state in VS Code and give the human a clear way to resume the same author.

### Authentication and harness pitfalls

Successful calls passed the server's bearer check, with OpenCode's configured
Authorization header and Codex's `bearer_token_env_var`. Raw tests reject missing
and wrong tokens with 401, hostile Origin/Host with 403, malformed/oversized
bodies, and concurrent waiters. Both JSON and SSE response paths pass tests for
question delivery, answer recording, server timeout, queueing, explicit
cancellation, and disconnect cleanup.

Two initial trial sets were setup failures, excluded from the timing evidence:

1. Leaving spawned CLI stdin open made the CLIs wait for more input. Close it.
2. OpenCode uses inherited `PWD` when establishing the session location. Merely
   setting Node's `spawn({cwd})` left it reading the launching worktree's config,
   not the generated test config. Set `PWD` to the case directory too.
3. Codex's `default_tools_approval_mode="auto"` rejected these unannotated tools
   in a noninteractive read-only run: `MCP tool call requires approval, but
   approval policy is never`. Setting this **test server alone** to `"approve"`
   permits the calls without disabling the command sandbox. Production setup
   needs explicit user authorization for the bridge, not blanket tool approval.

The corrected OpenCode trials use project-local config and a private standalone
server. Codex uses invocation-only `-c` overrides and ignores user config, while
retaining existing authentication. Scratch directories remain under
`~/worktrees`; nothing was written in the main checkout.

## Small server, real maintenance boundary

`server.ts` implements initialize, initialized notification, ping, list tools,
wait, answer, explicit cancellation, JSON results, and optional request-scoped
SSE progress. GET returns 405, allowed for a server with no standalone SSE
stream. Protocol sessions and a permanent notification stream are not required
for this tools-only profile. The runtime has no package manifest or install step.

The saved line count includes blank lines, comments, schemas, all diagnostics,
and the private `/ask` endpoint—not just a cherry-picked dispatch function.
No official SDK comparison was run; it was optional. A larger SDK buys protocol
validation and lifecycle coverage that this short spike deliberately lacks.

**Do not ship the spike unchanged.** It has one global consumer, no durable
question IDs/acknowledgments, no session/owner isolation, no bounded queue, no
replay, incomplete JSON-RPC/argument/lifecycle/version/Accept validation, and no
SSE resumption. A disconnected waiting request releases its waiter; that is an
application-specific cleanup policy, not the MCP rule for arbitrary operations.
MCP explicitly says a disconnect should not automatically mean cancellation.
Before production, make question delivery acknowledgment-based so a question
isn't lost between a completed HTTP response and an actual agent reply. Route
replies by question and Tour identity, not “whichever waiter is current.”

For this author's minimal bridge, a hand-rolled **narrow, tested profile** remains
reasonable. If it grows to multiple protocol eras, Channels, subscriptions,
resumption, OAuth, or nested client requests, prefer the SDK rather than growing
a second protocol framework inside the extension.

## Claude Code: documentation only

No `claude` command was executed. The current [MCP reference][claude] documents:

- HTTP MCP entries with `type:"http"`, URL and Authorization headers; project
  `.mcp.json` is supported. Custom local token headers do not require OAuth.
- `MCP_TOOL_TIMEOUT` and per-server `timeout` in milliseconds. Per-server timeout
  is a **hard wall-clock limit**; progress does not extend it. Values below 1000
  are ignored. The documented unset global default is about **28 hours**.
- A separate HTTP/SSE **first-response-byte timer** uses the greatest of 60s,
  the explicit effective tool timeout, and `MCP_TIMEOUT`; the unset 28h default
  does not enter that comparison. A silent long JSON response therefore needs
  explicit configuration, even with a large nominal tool default.
- HTTP/SSE/WebSocket idle timeout defaults to **five minutes**; stdio to
  **30 minutes**. `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` changes/disables the check;
  a per-server timeout of at least 1000ms acts as an idle-timeout floor.
- Main-conversation tool calls exceeding **two minutes** automatically background
  in supported versions. Limits still apply; the result arrives as a task
  notification. Noninteractive calls normally do not auto-background unless
  explicitly enabled. This changes “one foreground wait” semantics.
- Channels are a separate opt-in push path, not portable MCP behavior; the
  documented newer 2026-07-28 negotiation does not register channel servers.

Consequently, the 30s server wait / explicit 60s client budget is deliberately
below Claude's first-byte and background thresholds too, but remains **untested
on Claude Code**. Do not turn the docs into a claim of measured compatibility.

## Why not wait forever?

A 30s idle timeout creates roughly **120 tool-result/model continuation cycles
per hour** if the client keeps looping. The parked call itself does not require
continuous model generation, but each timeout/reissue does. Larger waits trade
lower idle-turn cost for more client-specific configuration and longer visible
blocking. There is no guarantee an agent will loop forever or that context will
remain intact. Start short and explicit; allow a longer user-selected wait only
with a tested client budget and a visible stop/resume affordance.

This resolves the transport feasibility decision. The map still owns the
application contract; this experiment does not decide durable Tour/question
storage or implement the VS Code bridge.

## Sources

Primary sources consulted on 2026-09-27; vendor defaults may change. Measurements
above are tied to the installed versions rather than inferred from these pages.

- [MCP 2025-11-25 Streamable HTTP transport][transport]: JSON/SSE results, 202
  notifications, optional sessions, GET 405, Origin checks, cancellation versus
  disconnection, and protocol headers.
- [OpenCode V2 MCP configuration][oc]: remote headers, direct/Code Mode tools,
  execution timeout configuration and documented 12-hour default.
- [OpenCode V2 CLI][occli] and [configuration][occonfig]: `run`, standalone
  service, and project-local configuration.
- [Codex MCP configuration][codex]: bearer token environment, startup/tool
  timeouts, approval modes, HTTP transport; page currently says 60s tool default.
- [Claude Code MCP reference][claude]: timeouts, HTTP config, auto-backgrounding,
  protocol negotiation, Channels.

[transport]: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
[oc]: https://opencode.ai/v2/docs/mcp-servers
[occli]: https://opencode.ai/v2/docs/cli
[occonfig]: https://opencode.ai/v2/docs/config
[codex]: https://developers.openai.com/codex/mcp
[claude]: https://code.claude.com/docs/en/mcp
[codexsource]: https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/codex-mcp/src/rmcp_client.rs#L103-L104
[codexmanager]: https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/codex-mcp/src/connection_manager.rs#L333-L340
