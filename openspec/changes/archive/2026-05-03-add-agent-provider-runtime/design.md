# Design: add agent provider runtime

## 本轮边界

本轮新增 `AgentProvider Adapter / Coordinator Agent Runtime`。它让外层 agent 能基于当前 `Coordinator Surface` 做一次非交互决策，并把本次决策过程落库、落 artifact、落 event。

本轮不实现 agent tools executor。也就是说，provider 输出可以包含建议、下一步、报告，但不会在本轮由 runtime 自动解析并执行工具调用。真实工具执行留给 Iteration 8。

## 模块

在 `packages/core` 新增 `agent-provider-runtime.ts`：

- `AgentProvider` interface
- `CodexProvider`
- `ClaudeCodeProvider`
- `FakeAgentProvider`
- `runCoordinatorAgentSession(context, input)`
- `inspectAgentSession(context, input)`

Provider interface 保持窄：

```ts
type AgentProvider = {
  id: "codex" | "claude-code" | "fake" | string;
  kind: "codex" | "claude-code" | "fake" | string;
  capabilities: string[];
  run(input: AgentProviderRunInput): AgentProviderRunResult;
};
```

`run` 只接收：

- `sessionId`
- `cwd`
- `promptPath`
- `outputPath`
- `transcriptPath`
- `timeoutMs`
- `metadata` 的短字段

不传复杂 task/workflow JSON。完整上下文已经写入 prompt/surface artifact。

## DB 读写

补齐 `agent_sessions` repository：

- `createAgentSession`
- `getAgentSession`
- `getActiveAgentSessionByTask`
- `updateAgentSession`

本轮只要求 outer session active uniqueness。已有文档中“一个 task 同时最多一个 active Coordinator Agent decision loop”通过 partial unique index 约束：

```sql
ON agent_sessions(task_id, role)
WHERE role = 'outer' AND status IN ('planned', 'starting', 'running', 'stalled', 'unknown')
```

agent session 字段继续保持第一版最小。`transcript_path` 记录 transcript 相对路径；prompt/surface/final response 通过 artifact store 和 event artifact refs 追踪。

## Runtime 流程

`runCoordinatorAgentSession`：

1. 读取 task/project。
2. 生成 `Coordinator Surface`，并保存 JSON/Markdown surface snapshot。
3. 选择 provider：优先 input.providerId，其次 project.outerAgentDefaultProvider。
4. 创建 `agent:session:<task-id>:outer:<provider-id>:<request-id>` operation；`request-id` 由 operator/API 显式传入，未传时使用稳定默认值 `task-v<task.stateVersion>`。
5. 获取 `task-agent` lock。
6. 创建 `starting` agent session record。
7. 创建 session 目录，写 prompt/surface/transcript 初始 artifact。
8. 更新 operation `running`，更新 session `running`。
9. 调用 provider。
10. provider 成功后写 final response、transcript，更新 session `completed`，operation `succeeded`，append `agent.session_completed` event。
11. provider 失败时更新 session `failed` 或 `unknown`，operation `failed` 或 `unknown`，append failure event。

说明：

- 进程启动后进入 side effect window；若 provider 执行结果不确定，operation 应进入 `unknown`。
- lock TTL 至少为 `timeoutMs + 60_000`；provider completion/failure 必须使用 fresh timestamp 做 fencing，不能复用启动时的 `now`。
- 本轮默认非流式运行，timeout 由 provider runner 负责。
- outer provider 的运行 cwd 固定为 sessionRoot，不指向 project repo 或 workspace repo。P0 第一条闭环前，planning-only session 是必要能力；无 workspace 时使用 `<workspaceRoot>/<project-id>/sessions/<session-id>` 作为 sessionRoot。

## Provider 命令形态

### CodexProvider

默认命令：

```bash
codex exec --cd <sessionRoot> --sandbox read-only --ask-for-approval never --skip-git-repo-check --output-last-message <outputPath> -
```

为避免超长命令参数，prompt 通过 `stdin` 传入 runner。命令参数只包含 cwd、sandbox、approval、output path 等短字段。outer Coordinator Agent 本轮只做决策，不获得 repo 写权限。

### ClaudeCodeProvider

默认命令：

```bash
claude --bare --print --permission-mode dontAsk --tools "" --output-format text
```

同样通过 `stdin` 传入 prompt，并将 stdout 写入 final response。`--bare` 与空 tools 用于避免 hidden memory 和直接工具执行进入本轮边界。

### FakeAgentProvider

用于 contract tests，不执行外部进程，返回确定性 final response。

## Artifact

session artifact root：

```text
<workspace-or-project-coordinator-root>/sessions/<session-id>/
```

其中 project planning-only 场景使用 project registry 的 workspace root 下临时 coordinator session root：

```text
<workspaceRoot>/<project-id>/sessions/<session-id>/
```

本轮 artifact path 以绝对 path 落库，后续 UI 可直接引用；agent tools artifact payload 仍只允许 `<workspace>/coordinator/artifacts/` 下相对路径，本轮不改变该规则。

## 可观测性

必须记录事件：

- `agent.session_created`
- `agent.session_started`
- `agent.session_completed`
- `agent.session_failed`

event payload 只保存 provider id、role、surface id、status、短 summary、artifact refs。完整 prompt/transcript/final response 写文件，不塞入大 JSON。

## CLI/API

新增 operator-only 调试入口：

- CLI: `agent run --db <path> --task <task-id> [--provider <provider-id>] [--timeout-ms <ms>]`
- CLI: `agent inspect --db <path> --session <agent-session-id>`
- API: `POST /tasks/:taskId/agent-sessions`
- API: `GET /agent-sessions/:agentSessionId`

这些入口不得加入 Coordinator Surface available tools。

## 风险与后续

- 本轮没有 daemon/watchdog，因此 provider hang 只能依赖单命令 timeout。
- 本轮不解析工具调用，避免在 Iteration 7 污染 Iteration 8 的 agent tools 边界。
- 后续 Iteration 8 需要在同一 session/event 结构上追加 tool trace。
