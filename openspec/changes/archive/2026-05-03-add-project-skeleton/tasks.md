## 1. 工程配置

- [x] 1.1 新增 `package.json`、`pnpm-workspace.yaml`、TypeScript/Vitest/Vite 配置。
- [x] 1.2 新增源码目录结构，区分 `apps/api`、`apps/web`、`packages/cli`、`packages/db`、`packages/shared`。

## 2. SQLite migration

- [x] 2.1 实现 SQLite 连接和 migration runner。
- [x] 2.2 新增首个元信息 migration。
- [x] 2.3 增加 migration 幂等执行测试。

## 3. API / Web / CLI

- [x] 3.1 实现 Fastify API 健康检查。
- [x] 3.2 实现 Vite + React Web 最小 operator surface 入口。
- [x] 3.3 实现 CLI health 和 migrate 命令。

## 4. 验证

- [x] 4.1 增加 API 和 CLI 基础测试。
- [x] 4.2 运行 OpenSpec validate、类型检查、测试和构建。
- [x] 4.3 根据验证结果修复问题。
