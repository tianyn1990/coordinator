## Context

Iteration 3 把 `coordinator` 从“能存核心状态”推进到“能管理工程真相”。Project Registry 是工程级真相源，后续 workspace root、provider 选择、workflow launcher、PR/MR platform 和默认 agent provider 都依赖它。

本轮持续对齐：

- `docs/AGENTS.md`：实现前必须对齐 docs 总体设计心智。
- `docs/project-registry.md`：工程注册、GitHub/GitLab 检测、默认分支、workflow launcher、agent defaults。
- `docs/architecture.md`：Project Registry 是 Coordinator Core 管理的一部分，不是入口层临时缓存。
- `docs/contracts.md`：Project / Task / Attempt / Workspace 的所有权边界不变。
- `docs/operations.md`：注册时需要 inspect-before-create、并为后续副作用准备持久真相。
- `docs/roadmap.md`：Iteration 3 的完成标准就是工程注册和显式确认。

## Goals / Non-Goals

**Goals:**

- 建立 Project Registry 持久化字段和最小服务。
- 支持工程注册和注册状态查看。
- 支持 GitHub/GitLab 自动识别与用户显式选择。
- 支持 remote HEAD 检测失败时显式确认默认分支。
- 支持 workflow launcher 和默认 agent/provider 配置保存。

**Non-Goals:**

- 不实现完整 Coordinator Surface。
- 不实现 workspace 创建或 branch 创建。
- 不实现 daemon、workflow adapter、PR/MR provider、agent tools。
- 不实现复杂权限、多租户或远程 worker。

## Decisions

### Project Registry 放在 core/service 层

工程注册和 provider/branch/launcher 规则属于业务真相，不放在 CLI/API 里。CLI/API 只负责调用 core service。

原因：

- 避免入口层变成状态机。
- 方便后续复用到 Web/CLI/operator surface。
- 与 docs 中 “Coordinator Core 是唯一状态机和策略校验层” 一致。

替代方案：

- 直接把注册逻辑写在 API route 里更快，但会污染入口层。

### 注册时显式确认默认分支

默认分支仍然不允许静默 fallback。

原因：

- 与 `docs/project-registry.md` 的注册流程一致。
- 能避免把错误 base branch 传播到 workspace / PR / merge。

### GitHub/GitLab 识别和 launcher 配置分离

provider 识别、launcher 配置、默认 provider 配置是三个独立字段，不把它们捆成一个混合配置对象。

原因：

- 便于分阶段补齐。
- 避免 agent surface 看到一大坨复杂 JSON。
- 方便以后替换 provider 或 launcher 实现。

## Risks / Trade-offs

- [Risk] 注册流程如果过重，会拖慢第一版体验。→ Mitigation：只做必要确认项，其他缺失能力允许降级保存，但必须明确暴露。
- [Risk] provider/launcher 信息来源较多，容易产生不一致。→ Mitigation：project registry 只保存机器真相，外部检测结果必须明确写入。
- [Risk] CLI/API 可能重复注册逻辑。→ Mitigation：统一走 core service。

## Migration Plan

1. 在 project 表或相关 registry 表补充所需字段。
2. 实现 project registry service。
3. 实现 CLI/API 注册与查看入口。
4. 增加自动识别、默认分支确认和 degraded mode 测试。
5. 运行 OpenSpec validate、typecheck、test、build。

回滚策略：Project Registry 仍处早期阶段；如尚未有真实工程数据，可回滚 code 和 migration。若已有数据，则只能通过后续 migration 修正。

## Open Questions

- 是否把 project registry 的持久化字段继续放在 `projects` 表，还是在后续单独表拆分。当前倾向先放在 `projects` 表，减少第一版复杂度。
