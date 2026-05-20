## Context

现有实现把 workflow start 建模为 `start_workflow_run --profile <profile-id>`，并要求 profile 来自 workflow capabilities 的 implemented profiles。这适合 operator 明确调试，但不适合作为外层 Agent 的决策接口：外层 Agent 不拥有 workflow profile 语义真相，也不应随着 workflow 工程升级同步静态注册表。

用户确认的新边界是：

```text
Coordinator 决定是否启动 workflow。
Workflow 决定使用哪条内部流程。
人类可以显式指定 workflow；Agent 不可以替人选择。
```

因此本变更需要同时收紧 agent-facing tool、调整 Core workflow start 语义、保存审计字段，并保持 daemon inspect-only 和 workflow private state 边界不变。

## Goals / Non-Goals

**Goals:**

- 让 outer Coordinator Agent 启动 workflow 时不选择具体 profile。
- 支持 human explicit workflow selection 作为 operator/task 输入透传给 workflow runtime。
- 支持 omitted/default/auto 作为 workflow runtime 自动选择语义。
- 持久化 requested selection 与 actual profile，便于 operator、timeline、summary 和恢复逻辑理解。
- 保留 operator-only capabilities/start/status/action 调试能力，但不把 profile catalogue 变成 agent 决策面。

**Non-Goals:**

- 不在 Coordinator 中实现 workflow profile 推理器。
- 不让 daemon 根据 workflow status/debug 字段执行 workflow action。
- 不新增 agent-facing workflow action tool。
- 不把 workflow capabilities 变成 Coordinator 静态 registry。
- 不直接修改 workflow 工程内部 private state。

## Decisions

### Decision 1: agent-facing `start_workflow_run` 不接受 profile

外层 Agent 只能请求启动 workflow。Core 从 task/operator context 中读取 optional human explicit selection；如果没有，则以 auto/default 语义调用 workflow runtime。

替代方案是把 capabilities 暴露给 Agent，让 Agent 选择 profile。该方案被拒绝，因为 Agent 不了解 workflow profile 的完整语义，也会造成 Coordinator 随 workflow 升级同步注册表。

### Decision 2: `default/auto/omitted` 统一为 runtime auto selection

Core 内部使用一个明确 selection model：

```text
source: human_explicit | runtime_auto
requestedProfile: string | null
requestedAlias: default | auto | null
```

`default` 与 `auto` 不持久化为 actual profile；它们只表达“让 workflow 自主选择”。真正执行后的 profile 必须来自 workflow protocol start/status 返回。

### Decision 3: human explicit selection 是 operator input，不是 Agent decision

Web/CLI/manual task 创建可以保存人类显式选择。Core 可以用 capabilities 校验该 selection 是否被当前 workflow runtime 声明支持；如果 workflow runtime 无法校验或拒绝，系统进入受控 failure / operator attention / human-needed，而不是回退给 outer Agent 猜测。

### Decision 4: operation idempotency 需要从 profile-id key 迁移到 selection key

现有 `workflow:start:<attempt-id>:<profile-id>` 假设 profile 在 start 前已知。新语义下 auto selection 启动前没有 actual profile，因此 operation idempotency key 应基于 attempt 与 requested selection：

```text
workflow:start:<attempt-id>:auto
workflow:start:<attempt-id>:human:<profile-id>
```

start 成功后再把 workflow 返回的 actual profile 写入 workflow run record 和 event。

### Decision 5: capabilities 只服务 operator/debug 与 human explicit 校验

capabilities 仍是稳定 protocol 能力，用于：

- operator 页面展示。
- CLI/API 调试。
- human explicit selection 的受控校验。
- start/status mismatch 的恢复诊断。

它不得进入 outer Agent 的 profile 决策面。

## Risks / Trade-offs

- [Risk] workflow 工程当前可能尚未支持 omitted/default/auto start。  
  Mitigation: Adapter 先按 protocol capability/失败码做受控失败；必要时在 workflow 工程补齐后再开启真实 auto smoke。Coordinator 侧不得用 fallback profile 猜测代替 runtime selection。

- [Risk] 旧 CLI/API/operator start 依赖必填 profile。  
  Mitigation: 保留 operator-only explicit profile 参数，但将其语义标为 human/operator explicit selection；同时支持省略 profile 进入 auto。

- [Risk] active workflow run 复用和 mismatch 检查原本依赖 requested profile。  
  Mitigation: 复用 active run 时以 external run id 和 actual profile 为准；requested selection 仅用于审计和 idempotency。若 status 返回 profile 与 persisted actual profile 冲突，仍进入 protocol consistency violation。

- [Risk] 增加字段需要 migration。  
  Mitigation: 新字段使用 nullable/default 兼容旧数据库；旧 workflow run 的 actual profile 可从既有 `profile_id` 回填或显示为 unknown。

## Migration Plan

1. 新增或调整 DB 字段，兼容旧 `profile_id`。
2. 更新 workflow adapter selection model 与 operation idempotency key。
3. 更新 agent tool executor 和 surface 文案，使 outer Agent 不再传 profile。
4. 更新 CLI/API/Web operator 入口，把 profile 解释为 human/operator explicit selection。
5. 更新 docs/specs/tests。
6. build core/cli/api；如已有 API 进程，需要重启后新语义才生效。

## Open Questions

- workflow 工程是否已支持 `workflow protocol start` 省略 `--workflow`，或 `--workflow default/auto`。如果尚未支持，本 change 需要在 coordinator 侧受控失败并记录对 workflow 工程的依赖。
