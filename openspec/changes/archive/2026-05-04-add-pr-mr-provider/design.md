## Context

Iteration 9 之后，系统已经具备以下能力：

- `Coordinator Surface` 可以根据 task/project/attempt/workspace/workflow/human request 生成 agent-facing Markdown 和 machine JSON。
- `Coordinator Agent Tools executor` 已经能执行 plan、attempt、workspace、workflow、human request 相关工具。
- `Workflow Protocol Adapter` 只通过 workflow protocol 消费 `handoff.kind`，不会读取 `.workflow` private state。
- `Daemon Runtime` 能唤醒 agent、执行 agent tool 请求、桥接 agent artifact，并做最小 retry/reconciliation。

缺口是 PR/MR lifecycle。当前 surface 在 `workflow handoff pr_ready`、PR/MR open、merge_waiting 时仍以 `ask_human` 兜底，不能跑通 P0 E2E 的 review/approval/merge。

本轮不改变总体分层：`Coordinator Core` 仍是唯一状态机和策略校验者；PR/MR provider 只是 execution adapter；outer agent 只能通过 surface 暴露的 narrow tools 请求动作；operator approval 只能从 CLI/API/Web 进入。

## Goals / Non-Goals

**Goals:**

- 定义并实现 `PullRequestProvider` port，支持 GitHub/GitLab 形态。
- P0 落地一个真实 CLI provider 路径，使用 `gh` 或 `glab`，由 project registry 的 `prProviderKind` 决定。
- 提供 `FakePullRequestProvider` 作为另一个 provider 的 contract stub 和测试实现。
- 实现 Core service：
  - `createPullRequest`
  - `updatePullRequest`
  - `inspectPullRequestReview`
  - `requestMergeApproval`
  - `approveMerge` / `rejectMerge` operator-only
  - `mergeAfterApproval`
- 更新 surface/tool visibility，让 PR/MR tools 只在符合契约的 state 中出现。
- 保持 tool 参数窄：title、pr id、artifact path、reason、strategy；PR/MR body、approval 问题、review summary 等复杂内容走 artifact。
- 所有 create/update/merge 外部副作用 operation-first、inspect-before-create、记录 event 和 sanitized tool result。

**Non-Goals:**

- 不做 unsafe auto-merge。
- 不让 daemon 自己判断 review 语义或批准 merge。
- 不实现 GitHub/GitLab API adapter；第一轮真实路径优先 CLI。
- 不做完整 checks/CI provider；validation snapshot 第一轮由程序生成最小 contract 或 operator 提供，后续可在独立 change 接入真实 checks。
- 不实现 conflict-resolution workflow，只在 merge conflict 时进入 blocked/handoff 并记录需要 future workflow。
- 不让 agent 直接调用 `approve_merge` / `reject_merge` / operator-only API。

## Decisions

### 1. `PullRequestProvider` 是 adapter，不拥有状态机

Provider interface 只表达外部平台动作：

- inspect current PR/MR by branch or external id。
- create PR/MR。
- update PR/MR body/title。
- inspect review snapshot。
- merge PR/MR。

Core service 负责：

- 校验 task/attempt/workspace/workflow handoff。
- 生成 operation idempotency key。
- 维护 `pull_requests` record。
- 创建 human request / merge approval。
- 更新 task status。
- 写 event 和 artifact record。

这样可以保持和 `AgentProvider`、`WorkflowProtocolAdapter` 相同的边界：adapter 执行副作用，Core 决定是否允许副作用。

### 2. 真实 provider 优先 CLI，Fake provider 做 contract stub

`CliPullRequestProvider` 根据 `providerKind` 使用：

- `gh` for GitHub。
- `glab` for GitLab。

第一轮真实 CLI path 的最小命令：

- inspect existing PR/MR by head branch。
- create PR/MR with title/body/base/head。
- update title/body。
- inspect review summary。
- merge squash。

测试不依赖真实网络或认证，通过注入 runner 验证 command shape。`FakePullRequestProvider` 用于 contract tests、daemon/tool tests 和本机无凭证场景。

### 3. PR/MR body 与 approval 内容走 artifact

Agent tools 参数保持：

```text
create_pr --title <short-title> --body-artifact <path>
update_pr --pr <pr-id> --body-artifact <path>
request_merge_approval --pr <pr-id> --artifact <path>
merge_after_approval --pr <pr-id>
```

复杂正文由当前 surface `artifact_root` 下的 Markdown artifact 承载，工具只接收相对路径。读取 artifact 时复用 `Coordinator Agent Tools executor` 已有 containment 规则。

### 4. Merge approval snapshot 绑定当前 PR/MR 状态

`requestMergeApproval` 会创建 `merge_approval` kind 的 `HumanRequest`，问题 artifact 中包含当前 PR/MR snapshot。operator 通过 `approveMerge` 明确审批时，Core 保存 approval artifact 和 request status。

`mergeAfterApproval` 执行前必须重新 inspect PR/MR，并校验：

- `pr_id`
- `head_sha`
- `base_sha`
- `merge_strategy`
- `validation_run_id`
- review snapshot 没有 blocking。

第一轮 `validation_run_id` 可以是最小本地 snapshot id，例如 `manual-validation:<pr-id>:<head-sha>`，但必须进入 approval snapshot；后续真实 CI/checks 接入时替换来源。

### 5. Surface 只暴露当前已实现工具

本轮之后：

- `pr_ready` handoff 可暴露 `create_pr`。
- PR/MR open 可暴露 `inspect_review`、`update_pr`、`ask_human`。
- review clean 但 approval missing 可暴露 `request_merge_approval`。
- approval valid 可暴露 `merge_after_approval` 和 `inspect_review`。

如果 project 缺少 `prProviderKind` 或 workspace branch/base 信息不足，surface 不暴露 PR/MR 副作用工具，只暴露 `ask_human` 或 inspect 类工具，并在 denied/recovery 中说明 blocker。

### 6. Daemon 只负责调用现有 surface/tool executor

本轮无需让 daemon 直接调用 PR/MR provider。daemon 仍只解析 outer agent 的 `coordinator-tool` 请求并交给 `executeCoordinatorAgentTool`；工具是否可见由 surface 决定。

## Risks / Trade-offs

- [Risk] CLI 输出格式不稳定或本机未登录 `gh`/`glab` → Mitigation: provider runner 可注入；CLI provider 失败返回受控 error，Fake provider 覆盖 contract tests；真实认证问题不自动重试到无限。
- [Risk] merge approval snapshot 字段第一轮不足 → Mitigation: 至少绑定 head/base/strategy/validation id/review status；任何缺失都不暴露 `merge_after_approval`。
- [Risk] PR/MR provider 引入外部副作用重复创建 → Mitigation: create 使用 `pr:create:<attempt-id>:<branch>` idempotency key，并 inspect-before-create 复用同 head branch PR/MR。
- [Risk] Agent surface 暴露过多内部字段 → Mitigation: Markdown 只展示 PR/MR 摘要和可行动 blocker；工具 result 只返回 sanitized `kind/id/status/url/nextStep`。
- [Risk] 本轮同时改 surface/tools/db/provider，范围较大 → Mitigation: OpenSpec tasks 分层推进，先 DB/Core contract，再 surface/tools，再 CLI/API，并通过 subagent review 专门检查过度设计和边界污染。

## Migration Plan

1. 新增 migration，补齐 `pull_requests` 字段和可选 `pr_reviews` / approval snapshot 字段。
2. 在 DB repository 增加 pull request 相关读写方法，保持旧表兼容。
3. 新增 `pr-mr-provider.ts` 和 tests。
4. 更新 surface 和 agent tools executor。
5. 更新 CLI/API operator-only 入口。
6. 运行 `openspec validate --all --strict`、`pnpm test`、`pnpm typecheck`、`pnpm build`。

Rollback：本轮新增 migration 不应破坏已有表；代码回滚后新增列/表可留存。若 provider operation 创建了外部 PR/MR，回滚不能自动删除外部资源，必须由 operator 手动处理。
