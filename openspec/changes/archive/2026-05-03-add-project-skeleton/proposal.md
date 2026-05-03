## Why

`coordinator` 当前只有设计文档，还没有可运行工程骨架。需要先落地 Node + TypeScript + Fastify + Vite + React + SQLite + CLI 的最小结构，让后续 Project Registry、Coordinator Core、daemon、provider、workflow adapter 能在稳定边界上继续迭代。

## What Changes

- 新增项目基础工程配置和脚本，支持安装依赖、类型检查、测试、构建、启动 API、启动 Web、执行 CLI。
- 新增 Fastify API 最小服务，提供健康检查接口。
- 新增 Vite + React Web 最小界面，用于确认 Web operator surface 的运行入口。
- 新增 SQLite 初始化与 migration 执行能力，先只建立 migration 机制和元信息表，不提前实现 Iteration 2 的完整数据模型。
- 新增基础 CLI，支持健康检查和执行 SQLite migration。
- 新增最小单测，覆盖 API health、migration 幂等执行和 CLI 入口可用性。

## Capabilities

### New Capabilities

- `project-skeleton`: 覆盖第一版项目骨架、API/Web/CLI 启动入口、SQLite migration 执行能力和最小测试验证。

### Modified Capabilities

- 无。

## Impact

- 影响新增代码目录、包管理配置、TypeScript/Vite/Vitest 配置、SQLite migration 目录和 CLI/API/Web 入口。
- 引入运行依赖：Fastify、React、Vite、SQLite driver。
- 引入开发依赖：TypeScript、Vitest、tsx、必要类型定义。
- 不改变当前 `docs/` 已确认的设计边界，不实现 agent tools、Coordinator Core 状态机、完整 Event Store、daemon、provider 或 workflow adapter。
