# project-skeleton Specification

## Purpose

定义 `coordinator` 第一版项目骨架的可运行基础，包括 Node + TypeScript 工程、API/Web/CLI 入口、SQLite migration 机制和最小验证要求。该规格只覆盖 Iteration 1，不包含后续数据模型、Event Store、daemon、provider 或 workflow adapter。
## Requirements
### Requirement: 项目骨架必须可安装和验证

系统 SHALL 提供标准 Node + TypeScript 工程配置，使开发者能够安装依赖、执行类型检查、运行测试和构建产物。

#### Scenario: 执行基础验证

- **WHEN** 开发者执行项目定义的类型检查、测试和构建脚本
- **THEN** 系统完成验证并生成对应构建产物

### Requirement: API 服务必须提供健康检查

系统 SHALL 提供 Fastify API 启动入口，并暴露健康检查接口用于验证服务可用。

#### Scenario: 查询 API 健康状态

- **WHEN** API 服务收到健康检查请求
- **THEN** 系统返回成功状态和服务名称

### Requirement: Web 应用必须提供 operator surface 入口

系统 SHALL 提供 Vite + React Web 启动入口，并展示 coordinator 的基础 operator surface 占位信息。

#### Scenario: 构建 Web 应用

- **WHEN** 开发者执行 Web 构建脚本
- **THEN** 系统生成可部署的 Web 静态产物

### Requirement: SQLite migration 必须可执行且幂等

系统 SHALL 提供 SQLite migration 执行能力，并记录已执行 migration，重复执行不得重复应用同一 migration。

#### Scenario: 重复执行 migration

- **WHEN** 开发者对同一个 SQLite 数据库连续执行两次 migration
- **THEN** 系统只记录一次每个 migration，并保持数据库可用

### Requirement: CLI 必须提供基础运维入口

系统 SHALL 提供 CLI 入口，用于执行健康检查和 SQLite migration。

#### Scenario: 执行 CLI 健康检查

- **WHEN** 开发者执行 CLI 健康检查命令
- **THEN** 系统输出 coordinator 可用状态

#### Scenario: 执行 CLI migration

- **WHEN** 开发者通过 CLI 指定 SQLite 数据库路径并执行 migration
- **THEN** 系统完成 migration 并输出执行摘要
