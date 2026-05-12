## MODIFIED Requirements

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
