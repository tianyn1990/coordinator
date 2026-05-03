# Design: Coordinator Agent Tools executor

## 设计原则

本轮严格沿用 `docs/agent-tools.md`、`docs/coordinator-surface.md`、`docs/contracts.md` 和 `docs/operations.md` 的边界：

- tool 是外层 agent 的行动边界，不是数据库字段搬运接口。
- 当前 tool 是否可调用，以当前 Coordinator Surface 的 `available_tools` 为准。
- agent tool 参数使用 id、enum、短字符串、artifact path，避免复杂 JSON。
- 复杂计划、human question 等内容由 agent 写入 artifact，再通过相对 artifact path 传给 tool。
- Coordinator Core 是唯一策略校验与状态迁移入口。

## 执行入口

新增 Core service：

```text
executeCoordinatorAgentTool(ctx, input)
```

输入只包含：

- `taskId`
- `toolName`
- `args`
- `actor`
- 可选 `agentSessionId`
- 可选 `requestId`

service 内部流程：

1. 从 DB 构建当前 `Coordinator Surface`。
2. 检查 `toolName` 是否存在于 surface `available_tools`。
3. 解析并校验窄参数。
4. 执行对应 Core action。
5. 写入 `agent_tool_call` event，记录 args summary、状态、artifact refs 和错误。
6. 返回简短机器结果。

## Artifact 校验

工具 artifact 参数只接受相对当前 surface `artifact_root` 的路径。

pre-workspace planning 阶段使用 task-local artifact root：

```text
<workspace-root>/<project-id>/<task-id>/_task/coordinator/artifacts/
```

workspace ready 后使用 attempt workspace artifact root：

```text
<workspace>/coordinator/artifacts/
```

校验规则：

- 不允许绝对路径。
- 不允许 `..` path segment。
- 不允许空路径。
- 必须 realpath containment 在 artifact root 内。
- 文件必须存在。
- 第一版限制文件大小，避免把大日志当作 tool payload。

## P0 工具行为

### write_execution_plan / revise_execution_plan

- 从 artifact 读取 Markdown。
- 写入 `execution_plans`。
- 记录 artifact。
- 不解析复杂计划结构；后续可以再补 plan steps parser。

### create_attempt

- 基于当前 task 创建 attempt。
- reason 是短字符串。
- 不让 agent 传 branch、workspace path 或 repo path。

### create_workspace

- 接收 attempt id。
- 复用 `createAttemptWorkspace`，不重复实现 git worktree 副作用。

### start_workflow_run

- 接收 profile id。
- Iteration 8 不接受 provider 参数；inner provider 仍由 project/workflow 配置决定，后续如需开放 provider 选择应通过独立 change 增加契约。
- profile 由已有 workflow adapter 校验 capabilities。
- 复用 `startWorkflowRun`。

### inspect_workflow_run

- 接收 workflow run id。
- 复用 `inspectWorkflowRun`。
- 只按 protocol 输出更新 DB，不读取 `.workflow` private state。

### ask_human

- 创建 human request。
- question 使用 artifact path。
- 本轮只实现 created/waiting 基础状态，为后续 Web human review 接入口打底。

## CLI/API 边界

提供 operator 调试入口：

- CLI：`agent-tool execute`
- API：`POST /tasks/:taskId/agent-tools`

这些是 operator 调试入口，不属于 Coordinator Surface。真正 agent 能否使用 tool 仍取决于 surface 可见性。

## 数据模型

如现有表已覆盖 execution plan 与 human request，则仅补必要 repository 方法。

如果需要最小迁移，本轮只补充字段或索引，不引入通用 DAG、persona、hidden memory 或 source-specific 状态机。

## 可观测性

每次 tool call 必须 append event：

```text
type = agent_tool_call
summary = <toolName> <status>
payload_json = args summary / result summary / failure code
artifact_refs = referenced artifacts
```

失败也要记录 event，便于 UI timeline 和后续 daemon recovery。
