## Context

本轮开始前已重新阅读根目录 `AGENTS.md`、`docs/AGENTS.md`、`docs/roadmap.md`、`docs/contracts.md`、`docs/execution-workspace.md`、`docs/project-registry.md`、`docs/coordinator-surface.md`、`docs/agent-tools.md`、`docs/daemon.md`、`docs/operations.md`、`docs/workflow-protocol.md`，并检查了现有 `pr-mr-provider` 与 `agent-provider-runtime` 规格。

当前状态：

- `AgentProvider Runtime` 已同时提供 `CodexProvider`、`ClaudeCodeProvider` 和 `FakeAgentProvider`，且已有 contract tests。
- `PullRequestProvider` interface 已支持 `github`、`gitlab`、`fake` kind。
- `CliPullRequestProvider` 已有 GitHub/GitLab 分支，但测试和规格主要以 GitHub/fake 为主。
- `Coordinator Core` 已负责 workflow `pr_ready` gate、operation/idempotency、approval snapshot、merge policy、recovery decision。

因此本轮选择先补 GitLab PR/MR provider contract，而不是再扩 AgentProvider 或新增平台抽象。

## Goals / Non-Goals

**Goals:**

- 让 GitLab `glab` 路径成为 P1 可验收的第二真实 PR/MR platform。
- 让 GitLab 与 GitHub 共用同一个 `PullRequestProvider` abstraction，Core 不感知品牌语义。
- 保持 CLI runner 参数窄，只传 command、args、cwd、timeout，不传复杂 project/task JSON。
- 将 GitLab 输出转换为有限 external fact：external id、url、source/target branch、head/base sha、review status、validation id、mergeable、state summary。
- 通过 contract tests 验证 GitLab inspect-before-create、create、update、inspect review、merge 命令形态和解析。

**Non-Goals:**

- 不新增 Coordinator Agent tools。
- 不改变 Coordinator Surface 可见性。
- 不改变 merge approval 必须人工显式审批的规则。
- 不接入 GitLab Issues / task source。
- 不实现 GitLab API adapter。
- 不实现真实网络 smoke；本机未安装或未登录 `glab` 时仍通过 runner contract tests 验收。

## Decisions

1. **复用 `CliPullRequestProvider`，不新增 GitLab 专属 runtime。**

   原因：现有 provider abstraction 已将 PR/MR 外部副作用隔离在 adapter 内，Core 按 project `prProviderKind` 选择 provider。新增专属 runtime 会让品牌语义更容易进入 Core。

   替代方案：新增 `GitLabPullRequestProvider` 类。暂不采用，因为当前差异主要是 CLI 命令与字段解析，拆类会增加重复和测试成本。若未来 GitLab API adapter 复杂化，可在同一 interface 后拆分。

2. **GitLab 命令按官方 `glab mr` reference 固化为窄参数。**

   - list：`glab mr list --source-branch <head> --target-branch <base> --state opened -F json`
   - create：`glab mr create --title <title> --description <body> --target-branch <base> --source-branch <head> --squash-before-merge --yes`
   - update：`glab mr update <id|branch> --title <title> --description <body> --yes`
   - view：`glab mr view <id|branch> -F json`
   - merge：`glab mr merge <id|branch> --squash --yes --sha <headSha>`

   原因：这些命令保持高层语义、参数窄，并能与现有 Core operation/recovery 契约结合。

3. **解析层只输出有限 external fact。**

   GitLab 输出字段差异通过 adapter 归一化，例如 `source_branch` / `target_branch`、`web_url`、`sha`、`merge_status`、`detailed_merge_status`、`blocking_discussions_resolved`。解析结果不得携带 raw output。

4. **malformed JSON 继续受控失败。**

   inspect-before-create 的 JSON 解析失败必须阻断 create，不能当成 absent。review inspect 对无法解析的文本输出可降级为 `unknown` summary，但不得推进 merge readiness。

5. **文档更新只记录已落地事实，不调整核心方案。**

   本轮不改变既有设计边界，因此不需要重新征询设计取舍；实现必须在已确认契约内完成。

## Risks / Trade-offs

- `glab` 不同版本 JSON 字段可能有差异 → 解析层兼容常见字段，并用 malformed/fallback 测试保护；未来真实 smoke 发现差异后在 provider adapter 内收敛。
- 本机未安装 `glab` 无法做外部 smoke → 使用 runner contract tests 验证命令、cwd、解析和 Core 交互；roadmap 记录后续可补认证环境 smoke。
- GitLab review/CI 状态与 GitHub reviewDecision 不完全等价 → 本轮只归一化为 `approved`、`changes_requested`、`review_required`、`unknown` 等有限状态；Core 仍以 approval snapshot 和 validation id 校验 merge。
- `glab mr create` 文本输出可能只给 URL → create 阶段允许用 URL 作为 external id；后续 inspect review 会刷新更完整 snapshot。
