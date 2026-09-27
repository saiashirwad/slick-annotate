# Terminal MCP → running VS Code extension

## Recommendation

Start with **one authenticated Streamable HTTP endpoint per running extension instance**, bound to `127.0.0.1` on an OS-assigned port. Expose a native “Copy MCP connection command” command for explicit window selection. Add a stdio discovery shim only when stable configuration across restarts or stdio-only clients earns the extra code. These are design recommendations based on the standard transports and Node’s built-in server APIs, not an implemented bridge. [T25][T26][NET][HTTP]

For portable Tours, make questions available through ordinary tools (explicit read or bounded wait), not an assumed ability to wake an idle agent. **MCP can send notifications; that is not a portable conversation-injection API.** Claude Code Channels offer an opt-in, client-specific push path, worth a separate Tour interaction decision rather than a baseline dependency. [PAT26][TOOLS][CLAUDE][CHANNEL]

Research date: 2026-09-27. Resolves [How can a terminal MCP client talk to the running VS Code extension?](https://github.com/saiashirwad/slick-annotate/issues/2). This is source research, not a runtime interoperability test. Recommendations and proposed contracts below are explicitly distinguished from documented behavior.

## 1. Where the server lives

A desktop/local or remote VS Code extension host runs Node.js, whereas a web extension host runs in a browser worker. Consequently, a Node HTTP listener can live inside the running Node extension, dispatching directly to its state and VS Code APIs; a browser-only extension cannot use that implementation unchanged. The current manifest has a `main` entry, startup activation, and no runtime dependencies. [HOST][HTTP][MANIFEST]

`vscode.lm.registerMcpServerDefinitionProvider` supplies server configurations **to VS Code as an MCP client**. It is not an API that exposes the extension to terminal clients. A terminal bridge must actually implement a server/listener or communicate with a separate server process. [VSMCP]

For the initial design, require the terminal and extension host to share a machine/network namespace. In SSH, WSL, containers, and Codespaces, the extension host may be remote; `127.0.0.1` means that host, not necessarily the desktop. Hosting location or authenticated forwarding must be an explicit later choice, not an accidental assumption. [HOST]

## 2. Concrete transport choices

| Choice | Concrete arrangement | Trade-off / recommendation |
| --- | --- | --- |
| Direct Streamable HTTP | Terminal client → `http://127.0.0.1:<port>/mcp` → extension’s Node server. HTTP supports an independently running server and multiple clients. [T25][T26] | Recommended first: no terminal helper process. Publish the endpoint explicitly; a changed port requires updated client configuration. |
| stdio shim → HTTP | Client spawns a small Node executable; it reads newline-delimited JSON-RPC from stdin, discovers the chosen extension endpoint, and forwards to HTTP. [T25][HTTP] | Recommended compatibility option: stable executable configuration, but discovery and transport conversion become our responsibility. Full conversion must handle JSON **and** SSE, not just one `fetch` per line. [T25][T26] |
| stdio shim → private IPC | Client spawns a helper that relays framed JSON-RPC over a Unix socket/Windows named pipe to the extension. Node `net` supports both. Client-facing transport remains standard stdio; the private leg is our custom transport. [NET][T25] | Small bidirectional framing, but socket permissions, Windows security, stale paths, and packaging need explicit treatment. Current MCP even recommends reusing stdio framing for custom byte-stream transports. [NET][T26OV] |
| Legacy HTTP+SSE / WebSocket | Older HTTP+SSE is deprecated; Claude Code additionally documents WebSocket support via JSON configuration. [T26][CLAUDE] | Do not make either the portable baseline: use standard Streamable HTTP or stdio. |

A terminal client cannot simply attach its stdin/stdout to the already-running extension: standard MCP stdio means a **client-launched subprocess**. The shim is that subprocess, not another copy of VS Code or a second owner of Annotation/Session state. This conclusion follows from the stdio lifecycle. [T25]

### Protocol versions must be explicit

There are two materially different protocol eras in the current primary sources:

- **2025-11-25:** `initialize` → server version/capabilities → `notifications/initialized`; HTTP POST returns JSON or SSE. GET may open a server-message SSE stream or return 405. Protocol-level session IDs are optional. [L25][T25]
- **2026-07-28:** per-request version/capability metadata replaces the connection handshake; HTTP has no standalone GET stream or protocol sessions. `subscriptions/listen` opens a request-scoped notification stream. Sampling/elicitation use multi-round-trip input results, not independent server JSON-RPC requests. [T26OV][T26][PAT26]
- Claude Code documents both SDK generations, negotiation controls, and legacy operation. A claim of “any MCP client” must mean a declared, tested version/transport intersection, not every optional feature or every historical client. [CLAUDE][L25]

**Recommended implementation boundary:** first implement and test the narrow 2025-11-25 tools-only profile described below; negotiate that version honestly rather than pretending it is the latest. If adopting 2026-07-28, implement its metadata and compatibility rules separately. Claude Code’s current docs describe legacy negotiation via `MCP_PROTOCOL_NEGOTIATION=legacy`; verify the actual installed client before shipping. [L25][T26][CLAUDE]

## 3. Discovery and several windows

MCP’s transport specification describes an endpoint or launched process, not a VS Code window-discovery registry. The following is a **proposed local contract**, not an MCP feature. Node can allocate a port with `listen(0, '127.0.0.1')` and report it with `server.address()`. VS Code exposes workspace folders, workspace-file identity, and extension global storage. [T25][NET][VSAPI]

1. **First version:** each running extension instance binds independently. Its native command copies its exact URL and client setup instructions. Choosing the command in the intended window is the selection mechanism. Never silently connect to “the first open port.”
2. **If automatic discovery is added:** write one descriptor per random instance ID into an extension-owned, user-private directory, outside the repository. Include `{instanceId, pid, endpoint, workspaceFile, folders, startedAt}` and a protected credential reference (or token in a strictly private descriptor). Publish only after listening; delete only that instance’s descriptor during disposal.
3. **Selection:** accept an explicit instance ID; otherwise match canonical workspace-folder URIs against an explicit workspace argument or terminal cwd. In multi-root workspaces match the full folder set as metadata, not merely folder zero. If two windows match the same folder/workspace, fail with candidates and require explicit selection.
4. **Staleness/reload:** check endpoint identity with authenticated traffic, not PID alone. Refuse stale or mismatched instance IDs. A reload creates a fresh instance/token; do not automatically replay a mutating tool after a broken connection. Reconnect and have the caller decide whether to retry.
5. **Several agents:** separate connection/request bookkeeping from VS Code window state. Require Tour/application IDs for mutations and eventual question/reply routing; never use an MCP transport session ID as the persistent Tour ID.

These rules are recommendations to avoid cross-window writes, supported by the available workspace identity APIs and transport session semantics; they are not claims that VS Code or MCP implements this registry. For the smallest author-only setup, stop at step 1. [VSAPI][T25][T26]

## 4. Localhost safety

Both HTTP revisions require validating a present `Origin` and returning 403 for an invalid origin; they recommend loopback-only binding and authentication. Localhost binding alone is insufficient protection against browser-origin/DNS-rebinding attacks. [T25][T26]

**Proposed safety policy:**

- Bind literal `127.0.0.1`, not `0.0.0.0` or an omitted host. Accept only the expected Host/port; reject every present Origin unless explicitly allowlisted. Permit Origin-absent terminal requests only with valid authentication. No wildcard CORS.
- Generate a random per-instance bearer secret; authenticate every endpoint before exposing state or executing actions. Keep secrets out of URLs, repository files, logs, and issue comments. Owner-only descriptor permissions on Unix; use appropriate user-only ACLs on Windows. Same-user malware is outside this modest local boundary.
- Treat the bearer scheme as a **custom local authentication arrangement**, not a complete implementation of MCP OAuth discovery. MCP permits custom negotiated authentication; Claude Code supports configured Authorization headers. Clients without custom-header support can use the stdio shim, whose credentials remain on its private leg. [B25][CLAUDE]
- Bound body sizes, concurrency, execution time, and input schemas; require paths to resolve within the selected workspace unless the user explicitly grants more. Do not expose arbitrary `executeCommand` or shell execution. Refuse bridge mutations in untrusted workspaces. These are proposed controls grounded in MCP’s input/access/rate-limit requirements and VS Code’s `workspace.isTrusted` API. [TOOLS][VSAPI]
- Dispose listeners/connections when the extension deactivates. Node’s `server.close()` stops new HTTP connections; active requests may need explicit cancellation/connection shutdown. [HTTP]

A random port is discovery information, not a credential. An MCP session ID is also not a substitute for the proposed bearer authentication. [T25][T26]

## 5. Claude Code configuration

The following uses documented CLI syntax; the URL/token are placeholders supplied by the proposed extension command, not an existing Slick feature. Run from the desired project. Local scope is private to that project in `~/.claude.json`; project scope writes `.mcp.json`, so do not commit an instance token there. [CLAUDE]

```sh
claude mcp add --transport http --scope local slick \
  http://127.0.0.1:PORT/mcp \
  --header "Authorization: Bearer YOUR_INSTANCE_TOKEN"
claude mcp get slick
claude mcp list
# In the interactive client: /mcp
```

For a future shim (path and arguments are proposed):

```sh
claude mcp add --transport stdio --scope local slick \
  -- node /absolute/path/to/slick-mcp-bridge.mjs \
  --workspace /absolute/path/to/workspace
```

The `--` separates Claude options from executable arguments. Keep shim diagnostics on stderr; stdout must contain only newline-delimited MCP messages. The executable needs an available Node runtime; the extension’s embedded Node host is not by itself a terminal `node` installation. [CLAUDE][T25][HOST]

On endpoint/token change, update the configuration (remove/add if needed) and reconnect through `/mcp`. A discovery shim can avoid rewriting the URL by resolving it each time the client starts it, but Claude Code documents that stdio servers do not automatically reconnect. [CLAUDE]

## 6. Can a Tour talk back?

| Mechanism | What the sources guarantee | Tour consequence |
| --- | --- | --- |
| Tools/list/resource notifications | Legacy MCP can send server messages over stdio or HTTP SSE; current MCP delivers opted-in change notifications through `subscriptions/listen`. Claude Code refreshes tools/prompts/resources on list changes. [T25][PAT26][CLAUDE] | Notification delivery is not a guarantee that the agent starts reasoning or answers a question. Do not abuse `tools/list_changed` or logging as chat. |
| Sampling | Legacy `sampling/createMessage` requests model generation through a client that advertises sampling; model access/permissions remain client-controlled. Current MCP carries input requests in an `InputRequiredResult` and retry. [SAMPLE][PAT26] | Can support nested model work, but not a portable “resume the main conversation” mechanism. The cited Claude Code MCP reference does not establish sampling support; inspect capabilities rather than assuming it. |
| Elicitation | Requests information **from the human through the MCP client**; it is nested interaction, not the human asking the model a question. Claude Code documents form and URL elicitation support. Current MCP uses multi-round-trip results. [ELICIT][PAT26][CLAUDE] | Useful for collecting a choice during a tool operation. It does not implement “ask the agent from a VS Code Thread.” |
| Tool result / bounded wait | A client calls `tools/call`, and the server returns content; client timeouts remain relevant. [TOOLS][L25][CLAUDE] | Proposed portable route: queue a question in VS Code; `read_tour_events` or `wait_for_tour_event(timeout)` returns it, and `reply_to_tour_question` writes the answer. The client must actually call the tool; no promise of idle wakeup. |
| Claude Code Channels | A server declares `experimental['claude/channel']`, emits `notifications/claude/channel`, and is explicitly opted in. The official build contract uses a local stdio subprocess; events queue into Claude’s session and a standard reply tool supplies the return path. [CHANNEL] | A real push option for Claude Code, not standard-client interoperability. A shim could relay authenticated extension events and expose replies as tools. |

Channels are a research preview. Custom servers require `--dangerously-load-development-channels server:<name>` and user confirmation during the preview; organization policy still applies. Delivery is not acknowledged by the protocol, so event IDs and a reply/ack tool would be application responsibilities. Claude Code also warns that channels are not registered on negotiated MCP 2026-07-28 connections. Keep a channel adapter explicitly on the supported legacy path and test it independently. [CHANNEL][CLAUDE]

**Correction to the map’s premise:** “MCP is request-driven, so VS Code can’t push” is too absolute. Legacy MCP supports server-originated messages, current MCP supports subscribed notifications, and Claude-specific Channels can trigger a session response. What is absent from the cited portable contracts is an unconditional, cross-client “new user turn” operation. The map body is otherwise intentionally left unchanged; this research is its corrective pointer. [T25][PAT26][CHANNEL]

## 7. Smallest dependency-free implementation supported by the evidence

The smallest defensible design found here is a **tools-only, JSON-response HTTP server using `node:http` inside the extension**, with no Express or MCP SDK dependency. This is a derivation from the normative wire contract and Node APIs, **not a claim to have found or tested the world’s shortest third-party implementation**. MCP permits implementing only required base/lifecycle behavior plus selected capabilities; legacy Streamable HTTP permits JSON responses, optional session IDs, and 405 for an unsupported GET stream. [B25][L25][T25][HTTP]

Minimal implementation outline (not production code):

```text
activate:
  create authenticated HTTP handler
  listen on (0, 127.0.0.1); publish address to the native copy command

/mcp:
  validate host/origin/auth, method, content type, accept, size, version
  GET -> 405 (no SSE); unsupported methods -> 405
  POST -> parse and validate one JSON-RPC message (not a batch)
    initialize -> supported protocolVersion, serverInfo, capabilities:{tools:{}}
    notifications/initialized -> 202, empty body
    ping -> result:{}
    tools/list -> fixed tool definitions with valid inputSchema
    tools/call -> validate arguments; invoke allowlisted extension operation
                  return content:[{type:"text",text:...}]
    unknown request -> JSON-RPC method-not-found error
    accepted notification -> 202, empty body (never a JSON-RPC reply)
  return request result/error with matching id as application/json

deactivate:
  stop accepting calls; cancel pending work; close connections/listener
```

The outline’s wire behavior follows [T25][L25][TOOLS]; Node supplies the HTTP listener and streaming primitives. [HTTP] Before calling this implementation conformant, add all message/error validation, lifecycle/version handling, cancellation behavior, input access controls and rate limits—not just the happy-path switch. Do not advertise subscriptions, sampling, elicitation, or dynamic lists that it cannot serve. [B25][L25][TOOLS]

If a shim is needed, the smallest **private-IPC** version is a bidirectional byte relay with newline framing plus connection/auth/error/EOF handling; it leaves protocol dispatch in the extension. An **HTTP** shim is larger because SSE parsing, concurrent requests, and (for the legacy protocol) server-request responses and session headers must be handled correctly. Restricting it to this JSON-only profile can simplify it, but then label it a Slick-specific adapter, not a general MCP HTTP proxy. [NET][T25][T26OV]

**Recommendation on dependencies:** dependency-free is feasible for the narrow profile, not automatically lower maintenance once two protocol eras, SSE, and Channels are required. The official Channels example uses the MCP SDK. Revisit that trade-off when the Tour interaction decision selects push or nested client input. [CHANNEL][T26]

## 8. Verification still required before implementation is accepted

Research resolves feasibility and the recommended boundary, not compatibility. Proposed acceptance checks:

- Actual Claude Code version, negotiated protocol, and client capabilities recorded; initialize/list/call/error flows checked with both Claude Code and a second independent client.
- Two different workspaces, a multi-root workspace, and two windows for the same workspace: never mutate the wrong instance.
- Reload/stale descriptor/port reuse: explicit failure and reconnect, no silent replay.
- Missing/wrong token, foreign Origin, invalid Host, oversized body, malformed JSON, unknown methods, and out-of-workspace path inputs rejected.
- If push is chosen: demonstrate a VS Code question reaching an idle Claude Code session, then route its reply to the correct question; separately demonstrate the portable non-Channel fallback.

## Primary sources

All links below were consulted for this research (API references link to the relevant symbols where practical). Protocol links are revision-pinned; vendor documentation can change.

- [T25] [MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
- [L25] [MCP 2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
- [B25] [MCP 2025-11-25 base protocol, optional features, custom auth](https://modelcontextprotocol.io/specification/2025-11-25/basic).
- [T26OV] [MCP 2026-07-28 transport overview and custom byte-stream framing](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports).
- [T26] [MCP 2026-07-28 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).
- [PAT26] [MCP 2026-07-28 message patterns](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns).
- [SAMPLE] [MCP 2025-11-25 sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling).
- [ELICIT] [MCP 2025-11-25 elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation).
- [TOOLS] [MCP 2025-11-25 tools and security requirements](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
- [CLAUDE] [Claude Code MCP reference: transports, scopes, runtimes, notifications, elicitation, timeouts](https://code.claude.com/docs/en/mcp).
- [CHANNEL] [Claude Code Channels reference: contract, example, preview controls, delivery](https://code.claude.com/docs/en/channels-reference).
- [HOST] [VS Code extension host runtimes and locations](https://code.visualstudio.com/api/advanced-topics/extension-host).
- [VSMCP] [VS Code MCP developer guide and definition providers](https://code.visualstudio.com/api/extension-guides/ai/mcp#register-an-mcp-server-in-your-extension).
- [VSAPI] [VS Code API declarations](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts): `workspace.workspaceFolders`, `workspace.workspaceFile`, `workspace.isTrusted`, `ExtensionContext.globalStorageUri`.
- [NET] [Node net API: IPC, listen, address, errors](https://nodejs.org/api/net.html).
- [HTTP] [Node v24 HTTP API source documentation](https://github.com/nodejs/node/blob/v24.0.0/doc/api/http.md): built-in client/server, `createServer`, `listen`, `close`, `closeAllConnections`.
- [MANIFEST] [Slick manifest at research base cb75be1](https://github.com/saiashirwad/slick-annotate/blob/cb75be1/package.json).
