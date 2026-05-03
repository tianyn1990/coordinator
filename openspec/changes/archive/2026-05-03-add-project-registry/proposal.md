## Why

`coordinator` 已具备核心数据模型，但还不能注册工程，也不能识别 GitHub/GitLab、默认分支或 workflow launcher。Iteration 3 需要把 Project Registry 落成工程级机器真相，让后续 workspace、provider、workflow launcher、agent 默认值都建立在稳定工程配置上。

## What Changes

- 新增 Project Registry 核心服务和对应持久化字段，支持保存工程级机器真相。
- 新增工程注册流程，支持输入 repo path、检查 git repo、读取 remote URL、识别 GitHub/GitLab、检测 remote HEAD、显式确认默认分支。
- 新增 workflow launcher 配置和默认 agent/provider 配置的最小持久化能力。
- 新增 Web/CLI 注册工程入口，允许用户在工程缺少某些能力时显式选择或确认。
- 新增最小 project surface / registry view，用于显示工程是否可用于后续 workflow、PR/MR 和 provider 动作。

## Capabilities

### New Capabilities

- `project-registry`: 覆盖工程注册、GitHub/GitLab 检测、默认分支确认、workflow launcher 和 agent/provider 默认配置。

### Modified Capabilities

- `core-data-model`: 需要补充 project registry 相关字段和查询能力。

## Impact

- 影响 `packages/db`，需要补充 project registry 字段和 repository 查询。
- 影响 `packages/core` 或等价业务层，新增工程注册逻辑。
- 影响 `packages/cli` 和 `apps/api`，新增注册工程和查看工程最小状态入口。
- 不实现 Coordinator Surface、daemon、workflow adapter、workspace manager、PR/MR provider 或 agent tools。
