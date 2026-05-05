## Why

Iteration 12.5 的目标是补齐 P1 的第二套真实 provider / platform。当前 `CliPullRequestProvider` 已有 GitLab 分支，但规格和测试主要证明 GitHub/fake 路径；需要把 GitLab PR/MR CLI 路径提升为明确可验收的第二真实平台，避免 P1 目标停留在“代码里可选”。

## What Changes

- 固化 GitLab `glab` PR/MR provider contract，覆盖 inspect-before-create、create、update、inspect review、merge after approval 的窄命令形态。
- 补强 GitLab JSON 输出解析，统一将 `glab` 字段转换为有限 external fact，不把 raw output 泄漏到 Core 或 agent-facing surface。
- 补充 GitLab provider contract tests、failure/malformed tests 和最小 merge/readiness 路径测试。
- 更新 PR/MR provider OpenSpec 与设计文档中的已落地事实。
- 不新增 Coordinator Agent tools，不改变 Core 状态机、merge approval 语义或 workflow handoff 语义。

## Capabilities

### New Capabilities

### Modified Capabilities

- `pr-mr-provider`: 明确 GitLab CLI 作为第二套真实 PR/MR platform，要求其遵守同一 provider abstraction、operation/idempotency、inspect-before-create、merge approval 和有限 external fact 契约。

## Impact

- 影响代码：`packages/core/src/pr-mr-provider.ts`、`packages/core/src/pr-mr-provider.test.ts`。
- 影响规格：`openspec/specs/pr-mr-provider/spec.md` 的 delta。
- 影响文档：`docs/roadmap.md` 和必要的 PR/MR provider 已落地事实。
- 不引入新数据库 migration。
- 不引入新 npm dependency。
- 本机未安装 `gh`/`glab` 时不阻塞测试；真实 CLI smoke 以 runner contract tests 先验收，未来可在配置好认证环境后补外部 smoke。
