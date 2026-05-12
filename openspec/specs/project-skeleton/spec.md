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

系统 SHALL 提供 Vite + React Web 启动入口，并展示可连接 API 的 coordinator operator surface，用于查看 task、创建 manual task、查看 timeline/surface、回答 human request 和执行 PR/MR approval 调试操作。

#### Scenario: 构建 Web 应用

- **WHEN** 开发者执行 Web 构建脚本
- **THEN** 系统生成可部署的 Web 静态产物

#### Scenario: 打开 Web operator surface

- **WHEN** operator 打开 Web 应用
- **THEN** 系统展示 task list、manual task 创建入口和当前连接 API 的状态
- **AND** 页面不再只是项目骨架占位信息

### Requirement: SQLite migration 必须可执行且幂等

系统 SHALL 提供 SQLite migration 执行能力，并记录已执行 migration，重复执行不得重复应用同一 migration。

#### Scenario: 重复执行 migration

- **WHEN** 开发者对同一个 SQLite 数据库连续执行两次 migration
- **THEN** 系统只记录一次每个 migration，并保持数据库可用

### Requirement: CLI 必须提供基础运维入口

系统 SHALL 提供 CLI 入口，用于执行健康检查和 SQLite migration。root package scripts SHALL 能把 operator 传入的 CLI 参数原样交给 `@coordinator/cli`，不得把脚本分隔符 `--` 作为业务命令传入 CLI。

#### Scenario: 执行 CLI 健康检查

- **WHEN** 开发者执行 CLI 健康检查命令
- **THEN** 系统输出 coordinator 可用状态

#### Scenario: 执行 CLI migration

- **WHEN** 开发者通过 CLI 指定 SQLite 数据库路径并执行 migration
- **THEN** 系统完成 migration 并输出执行摘要

#### Scenario: 通过 root script 执行 migration

- **WHEN** 开发者执行 root `pnpm migrate --db <path>`
- **THEN** CLI 收到的业务命令为 `migrate`
- **AND** 系统完成 migration

#### Scenario: 通过 root script 执行 CLI 子命令

- **WHEN** 开发者执行 root `pnpm cli projects --db <path>`
- **THEN** CLI 收到的业务命令为 `projects`
- **AND** 系统不得把裸 `--` 当作 CLI 命令

