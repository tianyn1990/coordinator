# Project Registry

> 状态：初始方案基线  
> 适用范围：工程注册、GitHub/GitLab 检测、默认分支、workflow launcher、agent defaults、workspace root。

## 1. 文档定位

`coordinator` 需要管理多个工程。

因此第一版就需要 Project Registry。

Project Registry 是工程级机器真相，不应由每个任务重复猜测。

## 2. 为什么需要注册工程

注册工程解决：

- repo 在哪里。
- 使用 GitHub 还是 GitLab。
- 默认分支是什么。
- workspace root 在哪里。
- workflow launcher 怎么调用。
- 可用 agent provider。
- PR/MR provider 怎么配置。
- 本地和未来远程 worker 如何定位工程。

## 3. Project 字段

建议字段：

```text
id
name
repoPath
repoUrl
gitProviderKind
gitProviderHost
defaultBranch
workspaceRoot
workflowLauncher
outerAgentDefaultProvider
innerAgentDefaultProvider
prProviderKind
createdAt
updatedAt
```

默认：

```text
workspaceRoot = ~/.coordinator/workspaces/<project-id>
```

`defaultBranch` 不允许静默默认。注册时必须检测 remote HEAD 并要求用户显式确认；检测失败则阻塞注册，直到用户选择 `master`、`main` 或其他分支。

## 4. Git Provider 检测

自动检测规则：

- remote URL 包含 `github.com` => GitHub。
- remote URL 包含 `gitlab.com` => GitLab。
- remote URL 匹配配置的 GitLab host => GitLab。
- 无法判断 => Web/CLI 要求用户选择。

检测不能覆盖用户显式配置。

## 5. 默认分支

默认分支必须显式确认。

支持配置：

- `master`
- `main`
- 其他自定义分支

注册时应检测 remote HEAD：

- 检测成功：展示检测值，要求用户确认或改写。
- 检测失败：阻塞注册，要求用户手动输入。
- 用户选择后保存为 project machine truth。

这样既支持偏好 `master` 的工程，也避免 silent fallback 导致错误分支执行。

## 6. Workflow Launcher

项目需要记录 `workflow` launcher。

示例：

```text
workflow
./.codex/skills/ht-workflow/bin/workflow
./.claude/skills/ht-workflow/bin/workflow
```

coordinator 应通过 project config 调用 launcher。

不应假设全局 `workflow` 一定可用。

## 7. Agent Provider Defaults

项目可配置：

- outer agent 默认 provider。
- inner agent 默认 provider。

任务级可覆盖。

Coordinator Agent 可根据任务类型建议切换，但必须记录决策。

## 8. PR/MR Provider

项目可配置：

- provider kind: `github` / `gitlab`
- host。
- auth mode。
- CLI path。
- API base URL。

第一版可优先使用 CLI：

- `gh`
- `glab`

但 config 应允许未来 API adapter。

## 9. 注册流程

Web/CLI 注册工程：

1. 输入 repo path。
2. 检查是否 git repo。
3. 读取 remote URL。
4. 检测 GitHub/GitLab。
5. 检测 remote HEAD 并显式确认默认分支。
6. 检查 workflow launcher。
7. 检查 Codex / Claude Code provider 可用性。
8. 设置 workspace root。
9. 保存 project。

### 9.1 Degraded Mode

注册工程时，default branch 必须显式确认；这一点不能降级。

以下能力可以降级保存：

- 某个 AgentProvider 暂不可用。
- 某个 PR/MR provider 暂不可用。
- GitHub/GitLab 自动检测不确定但用户已手动选择。

降级保存时必须：

- 在 project config 中记录 `unavailable` / `stubbed` 状态。
- 在 Project Surface 中明确暴露 blocker。
- 禁止暴露依赖缺失能力的 agent tool。
- 允许后续通过 Web/CLI 补齐配置。

## 10. Project Surface

Coordinator Surface 中不应直接暴露大量 config 字段。

应翻译为：

```text
当前工程：coordinator
默认分支：master（已由用户确认）
PR 平台：GitHub
workflow launcher：已可用
默认 inner agent：Codex
workspace root：已配置
```

如果缺失：

```text
当前工程缺少 PR provider 配置，因此不能创建 PR/MR；请先在 Web 中补充工程配置。
```

## 11. 多工程边界

Task 必须绑定 project。

Attempt 必须绑定 task 和 project。

Workspace 必须绑定 project/task/attempt。

不允许一个 task 在未显式创建 child task / linked task 的情况下跨 project 修改。

## 12. 未来远程部署

Project Registry 需要支持：

- local repo path。
- remote repo URL。
- worker-specific checkout path。
- auth requirements。

第一版可只实现 local repo path，但字段不要阻断未来 remote worker。
