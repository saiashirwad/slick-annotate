# In-editor chat with the Tour author

## Recommendation

Use **native comment-thread replies backed by the existing proposed MCP bridge**, with an explicit “stay available for Tour questions” workflow in the **same terminal agent conversation that authored the Tour**. Queue a question with its Step context; let the agent retrieve it with an ordinary read/bounded-wait tool and post its answer with a reply tool. This needs no second agent process, model credentials, ACP client, or webview. It is the smallest portable design for Claude Code, Codex and OpenCode, based on their documented MCP tool support—not a tested implementation. [CM][CX][OM][COMMENTS]

**Do not promise always-on chat with an idle arbitrary MCP client.** The agent must call the read/wait tool and continue the loop. For genuinely editor-initiated chat with Claude Code, offer **opt-in Claude Code Channels** as a second tier: a local stdio relay pushes questions into the authoring session and the same reply tool writes answers into VS Code. Channels preserve the live conversation but are Claude-specific, preview-gated, and add a helper process and delivery bookkeeping. [CHANNEL]

Do **not** adopt ACP or Plannotator's Ask AI process model as the default: they solve editor-owned agent conversations or side conversations, not portable attachment to an arbitrary running terminal agent. If a separate context fork is acceptable later, label it explicitly as another assistant, not “the Tour author.” [AT][AS][PC][PX]

Research date: 2026-09-27. Resolves [How can you chat with a terminal coding agent from inside VS Code?](https://github.com/saiashirwad/slick-annotate/issues/8) for [Map: agent bridge and tours](https://github.com/saiashirwad/slick-annotate/issues/1). Source research only; no runtime interoperability tests or extension implementation. Builds on [the transport decision](https://github.com/saiashirwad/slick-annotate/blob/research/mcp-bridge-transport/docs/research/mcp-bridge-transport.md). API/vendor docs are moving targets; Plannotator citations are commit-pinned.

## 1. Context continuity is the deciding constraint

Distinguish three things:

1. **Live continuation:** input reaches the already-running authoring conversation, with its current tools, approvals and agent state.
2. **Resume:** another runtime restores a saved conversation. This can preserve recorded history, but does not establish safe concurrent ownership with the old runtime.
3. **Fork/fresh side chat:** a separate conversation receives copied history or an assembled context packet. Its answers do not automatically enter the author's conversation.

A protocol session ID alone does not bridge these differences. ACP's optional load/resume operations restore sessions known to the agent implementation; they do not specify discovering and taking over arbitrary terminal processes. [AS][AT]

## 2. ACP: useful editor-agent protocol, not universal terminal attach

ACP standardizes editor/client ↔ coding-agent communication: JSON-RPC, session creation and prompts, streamed updates, cancellation and permission interaction. An extension can absolutely be an ACP client. Its UI can use native VS Code APIs; ACP does not require a webview. But that makes Slick responsible for an agent-client lifecycle rather than just supplying Tour tools. [AT][AS][AC]

The standard stdio transport explicitly says **the client launches the agent as a subprocess**. ACP currently lists Streamable HTTP as a draft and permits custom transports. Consequently, “ACP always creates a new conversation” is false (load/resume exist), while “ACP can attach to any CLI already running in a terminal” is also false. A daemon/custom transport can support shared runtime access, but only when that particular agent exposes it. [AT][AS]

| Agent | Documented ACP entry point | Consequence for the terminal author |
| --- | --- | --- |
| Claude | Zed's `@agentclientprotocol/claude-agent-acp` adapter uses the **Claude Agent SDK**, not a native interactive-terminal ACP switch. [CA] | SDK-backed runtime; no universal live-TUI attach contract. Session history restoration is not proof of live attachment. |
| Codex | `@agentclientprotocol/codex-acp`; adapter explicitly **starts Codex App Server** and translates ACP to it. [XA] | Another app-server lifecycle, not attachment to an arbitrary existing terminal process. |
| Gemini CLI | Native `gemini --acp`, JSON-RPC over stdio; current docs include loading previous sessions. Older client examples still use `--experimental-acp`. [G][AC] | Start in ACP mode; saved-session load is distinct from live terminal attachment. |
| OpenCode V2 | Native `opencode acp`; starts a **private server**, explicitly not the shared background service; supports create/list/load/resume/fork/close/delete. [OA] | Excellent editor-owned lifecycle, but the documented ACP command is specifically not a connection to the TUI's shared service. |

`session/load` must be capability-gated and replays history; `session/resume` is separately capability-gated and restores context without replay. Support for those methods does not guarantee that a normal CLI's IDs/storage are compatible with an adapter's IDs/storage. Verify the concrete implementation and avoid simultaneous writers. [AS]

**Decision:** ACP is a reasonable future choice if Slick becomes an agent launcher. It is excess scope and does not solve the present context-continuity requirement by itself.

## 3. Plannotator: feedback return and Ask AI are different mechanisms

The distinction is visible in its first-party README and source, inspected at `4b20581222077adfffba7b588856ceaa91496a47`:

### Review feedback returns to the original agent

For Claude plan review, `ExitPlanMode` triggers a `PermissionRequest` command hook. A local server opens the browser; the user's approve/deny decision and annotations become the hook result, allowing the original agent to proceed or revise. Code-review commands likewise return feedback to the invoking agent session. This preserves the author because the author is waiting on an operation; it is not an independently addressable conversational socket. [PR]

### Ask AI creates its own conversation

The browser talks to Plannotator's local HTTP API: `POST /api/ai/session` creates/forks a provider session; `POST /api/ai/query` submits a prompt and returns **SSE** messages with a `[DONE]` terminator. Disconnecting cancels the provider turn. This is Plannotator's own API, not ACP or a generic MCP push channel. [PE]

- **Claude:** its provider uses the Agent SDK. With parent context, it starts a fork using `resume: parentSessionId` and `forkSession: true`; subsequent queries resume the resolved **child** session. Without a parent it starts fresh with review context. Thus it can inherit recorded author history, but it is not typing into the blocked parent session. [PC]
- **Codex:** its provider directly spawns a long-lived `codex app-server` with piped stdio, sends JSON-RPC, and starts/resumes its own thread. The provider advertises `fork: false`; the endpoint falls back to a fresh context-built session even when parent metadata exists. The provider's limitation is not a Codex protocol limitation: Codex App Server itself now documents `thread/fork`. [PX][PE][APP]
- Plannotator's separately advertised annotate agent terminal is another feature; neither its existence nor normal feedback return means Ask AI attaches to the author's live terminal. [PR]

**Takeaway:** copy the small “agent waits; UI returns input” idea, not the full multi-provider chat infrastructure. Forking is useful if uninterrupted side questions matter more than keeping a single conversation, but disclose the boundary and explicitly send any resulting conclusions back to the author.

## 4. Other prior art and agent-specific attachment paths

### Claude Code IDE integration

Claude's VS Code extension bundles its own CLI for its graphical chat panel. The terminal CLI can separately connect using `/ide`; the IDE server supplies editor context, diagnostics and diffs. Its documented implementation is loopback WebSocket MCP with a per-activation auth token in a private `~/.claude/ide/<port>.lock` file. That is an editor-tool connection, not a documented API for Slick to submit a new user turn to the live CLI. [IDE]

The extension can resume past conversations and exposes `vscode://anthropic.claude-code/open?session=…&prompt=…`; the prompt is **prefilled, not submitted**, and a missing session can start fresh. Useful as an explicit handoff, not reliable inline question/answer routing. Do not reverse-engineer the private IDE socket to inject chat. [IDE]

### Codex IDE extension / App Server

OpenAI explicitly documents App Server as the interface powering rich clients including its VS Code extension. It exposes history, approval requests, streamed events, `thread/resume`, `turn/start`, and `turn/steer`. Standard use starts an app-server child over stdio. Current docs also offer an explicitly hosted listener plus `codex --remote …`, including WebSocket and Unix-socket endpoints. WebSocket transport is experimental/unsupported for production. [APP]

A deliberately shared app-server deployment is a possible real shared-runtime design: connect both the terminal and editor to that server and select the correct thread. It is not an automatic attach mechanism for every independently started terminal Codex, nor is it MCP-only. Authentication, approvals, concurrent input and versioned RPC schemas add code well beyond the proposed Tour bridge. [APP]

### OpenCode V2 shared service

OpenCode offers a stronger explicit alternative to its ACP mode: `@opencode/client` can discover a registered background service with `Service.discover()`, obtain auth headers, submit `session.prompt` for a session ID, and subscribe to events. Use the existing author session, not `session.create`. This is an agent-specific path toward true shared-session interaction; event subscriptions are live-only, so reconnect needs reconciliation. Do not mistake `opencode acp` (private server) for this shared-service client. [OC][OA]

### ACP Client for VS Code

`formulahendry/vscode-acp` demonstrates feasibility: it spawns configured agents, speaks ACP over stdio, restores sessions, handles permissions/files/terminals, and provides a **chat webview**. Its architecture is useful protocol prior art but violates Slick's no-webview constraint and is much broader than answering a Step question. [AC]

## 5. MCP-only options and today's support boundary

| Mechanism | Claude Code | Codex | OpenCode V2 | Fit |
| --- | --- | --- | --- | --- |
| Ordinary read/reply tools | Documented | Documented | Documented | Portable baseline; no idle wakeup. [CM][CX][OM] |
| Bounded wait tool returning a question | Built on ordinary tools; timeouts and automatic backgrounding apply | Default tool timeout is 60 seconds; configurable | Execution timeout defaults to 12 hours; configurable | Portable protocol pattern, **not** evidence all agents will autonomously keep waiting. [CM][CX][OM] |
| Claude Channels | Explicit preview support, startup opt-in | No equivalent support established by cited docs | No equivalent support established by cited docs | Genuine push into Claude's same session only. [CHANNEL] |
| Sampling | Support not established by consulted client reference | Support not established by consulted references | Support not established by consulted V2 reference | Optional capability; not a portable author-conversation API. [S][CM][CX][OM] |
| Elicitation | Documented interactive input; form/URL support | App Server exposes MCP form/URL elicitation requests to its client | Support not established by consulted V2 reference | Asks the **human** for input, not the model to answer an editor question. [E][CM][APP][OM] |

“Not established” is not a claim of proven nonimplementation: inspect negotiated capabilities and installed versions before enabling optional behavior. This investigation did not run handshake probes.

**Wait behavior:** propose a 30-second server-side wait (comfortably below Codex's documented 60-second default), returning `question`, `timeout`, or `closed`. Re-arm only during an explicitly requested Tour conversation. Cancellation/reload ends pending waits; preserve unanswered questions independently of the wait. Avoid an infinite tool call or an unbounded polling instruction. Every empty-result loop may incur model turns, so stop after a bounded idle period and show “not listening; ask the terminal agent to resume.” [CX][CM][OM]

Claude's current docs additionally say main-conversation MCP calls lasting two minutes automatically become background tasks (v2.1.212+); results later arrive as task notifications. Idle and wall-clock timeouts still apply. That offers a Claude-specific long-wait variant, but is not portable indefinite blocking. The short-wait baseline avoids depending on it. [CM]

**Channels:** the authoring Claude session spawns a local stdio MCP relay. It advertises `experimental['claude/channel']` and sends `notifications/claude/channel`; the session queues events and uses an ordinary reply tool. A custom channel currently needs `--dangerously-load-development-channels server:<name>` plus confirmation and applicable organization policy. Delivery is unacknowledged; a successful transport write is not proof Claude processed it. Keep event IDs and explicit reply/ack state. Channels do not register on connections negotiated to MCP 2026-07-28; use the documented legacy path. [CHANNEL][CM]

**Sampling/elicitation:** sampling generates a nested response from a client-selected model; the specification does not promise access to the main agent's authoring transcript. Elicitation gathers human input through the MCP client. Neither defines “inject this VS Code question as the next user turn in the author's conversation.” The 2025-11-25 forms cited here are capability-negotiated; do not conflate them with newer protocol wire formats. [S][E]

## 6. Native VS Code conversation surface

**Comments API is the best fit.** Microsoft’s sample uses a reply command receiving `vscode.CommentReply`, then appends a `Comment` with author/body to `thread.comments`. Slick already follows this pattern in `src/extension.ts` (`slick.annotate`). A dedicated Ask action can distinguish an ordinary Annotation from a question intended for the agent, retain the Step's thread, and show answers with an agent author label. Keep the thread expanded during chat rather than copying the current Annotation handler's unconditional collapse. [COMMENTS][LOCAL]

This is a design recommendation, not a proposed domain-model migration: preserve existing Annotation/Thread/Session meanings and decide persistence with the Tour work. A whole response per tool call is enough initially; token streaming and permission UI need not be reimplemented. Render agent Markdown as untrusted (do not enable arbitrary command links).

**`vscode.chat.createChatParticipant`: backend flexibility is not host independence.** The documented handler can call an arbitrary backend instead of `request.model`, so it need not use a Copilot model to produce an answer. However, Microsoft's guide/tutorial position participants inside the GitHub Copilot Chat experience, and the guide explicitly distinguishes non-chat functionality usable without installing Copilot. These sources do **not** establish a supported standalone, Copilot-free Chat-view host for an ordinary participant. Do not choose it as the guaranteed no-Copilot surface. [CHAT][TUTORIAL]

This is narrower than claiming that no VS Code build can ever show chat without Copilot: newer agent-host experiences and product settings are separate from the stable participant contract. An exact-version, clean-profile test without Copilot would be required before promising that setup. Comments already meet the native-only constraint without making this dependency gamble.

## 7. Minimal proposed interaction contract and acceptance checks

Reuse the authenticated per-window loopback bridge rather than adding an agent launcher. These names are illustrative, not implemented APIs:

1. Author registers a Tour with an opaque bridge-issued author binding. Do not confuse it with Slick's annotation Session or an MCP transport session ID. An MCP server does not portably know the author's native conversation ID; OpenCode's `_meta.sessionID` is an optional client-specific aid, not authorization. [OM]
2. Ask action records `{questionId, tourId, stepId, file, range, snippet, text}` and marks it queued. Capture Step context at submission, not whichever Step is active later.
3. `wait_for_tour_question(binding, timeout)` returns a pending question to the bound author. `reply_to_tour_question(binding, questionId, text)` appends the answer to its original thread. Deduplicate retries and reject cross-binding replies.
4. Display queued/answering/answered/disconnected explicitly. A connection is not proof an agent is listening. Closing the Tour cancels waits; do not silently send the question to a different agent.
5. Optional Claude channel delivers the same question envelope to the same bound conversation; reply acknowledgement removes it from the queue to avoid duplicate delivery through wait and push.

Keep local authentication, Origin checks, workspace restrictions and cancellation from the transport decision. Asking a question does not grant additional file/shell permissions; leave approvals in the terminal initially. Avoid PTY keystroke injection, clipboard automation and transcript-file mutation.

Before shipping, demonstrate: Claude and Codex answering two follow-ups with remembered author context; timeout/re-arm and stop behavior; out-of-order replies while changing Steps; duplicate/reconnect handling; two agents/windows never crossing replies; and a channel event waking an idle opted-in Claude session. Record actual client/protocol versions. No new implementation or persistence decision is implied by resolving this research ticket.

## Primary sources

- [AT] [ACP transports](https://agentclientprotocol.com/protocol/transports).
- [AS] [ACP session setup and capabilities](https://agentclientprotocol.com/protocol/session-setup).
- [CA] [Claude Agent SDK ACP adapter](https://github.com/zed-industries/claude-agent-acp).
- [XA] [Codex ACP adapter](https://github.com/agentclientprotocol/codex-acp).
- [G] [Gemini CLI ACP mode](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md).
- [OA] [OpenCode V2 ACP](https://opencode.ai/v2/docs/cli/acp/).
- [OC] [OpenCode V2 client and service discovery](https://opencode.ai/v2/docs/build/client/).
- [OM] [OpenCode V2 MCP support, timeouts and session metadata](https://opencode.ai/v2/docs/mcp-servers/).
- [AC] [ACP Client for VS Code README and architecture](https://github.com/formulahendry/vscode-acp).
- [PR] [Plannotator README: review hooks, Ask AI and agent terminal](https://github.com/backnotprop/plannotator/blob/4b20581222077adfffba7b588856ceaa91496a47/README.md).
- [PE] [Plannotator AI HTTP endpoints](https://github.com/backnotprop/plannotator/blob/4b20581222077adfffba7b588856ceaa91496a47/packages/ai/endpoints.ts#L288-L388).
- [PC] [Plannotator Claude SDK provider](https://github.com/backnotprop/plannotator/blob/4b20581222077adfffba7b588856ceaa91496a47/packages/ai/providers/claude-agent-sdk.ts) (`forkSession`, `buildQueryOptions`, resume/fork options).
- [PX] [Plannotator Codex App Server provider](https://github.com/backnotprop/plannotator/blob/4b20581222077adfffba7b588856ceaa91496a47/packages/ai/providers/codex-app-server.ts) (spawn, capabilities, `ensureThread`).
- [IDE] [Claude Code VS Code integration](https://code.claude.com/docs/en/vs-code) (bundled CLI, terminal integration, URI handler, built-in IDE MCP server).
- [APP] [Codex App Server protocol](https://developers.openai.com/codex/app-server).
- [CX] [Codex MCP support and configuration](https://developers.openai.com/codex/mcp).
- [CM] [Claude Code MCP reference](https://code.claude.com/docs/en/mcp) (timeouts/backgrounding, elicitation, protocol negotiation).
- [CHANNEL] [Claude Code Channels contract](https://code.claude.com/docs/en/channels-reference).
- [S] [MCP 2025-11-25 sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling).
- [E] [MCP 2025-11-25 elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation).
- [COMMENTS] [Microsoft Comments API sample](https://github.com/microsoft/vscode-extension-samples/blob/main/comment-sample/src/extension.ts).
- [LOCAL] [Slick reply handler at research base](https://github.com/saiashirwad/slick-annotate/blob/cb75be1/src/extension.ts#L108-L129).
- [CHAT] [VS Code Chat Participant API guide](https://code.visualstudio.com/api/extension-guides/ai/chat).
- [TUTORIAL] [Microsoft Chat sample README](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample).
