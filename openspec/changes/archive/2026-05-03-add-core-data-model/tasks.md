## 1. Schema 与 migration

- [x] 1.1 新增核心数据模型 migration，建立 roadmap 中列出的 P0 表。
- [x] 1.2 为核心实体补 `state_version`、`created_at`、`updated_at`。
- [x] 1.3 增加 foreign key、必要 index 和 active uniqueness partial unique index。

## 2. Repository 基础

- [x] 2.1 实现 transaction wrapper 和数据库错误类型。
- [x] 2.2 实现 event repository，支持 append 和按 task 查询 timeline。
- [x] 2.3 实现 project/task repository，支持创建 project、创建 task、CAS 更新 task。
- [x] 2.4 实现 operation repository，支持 idempotency key 防重复 non-terminal operation。
- [x] 2.5 实现 lock repository，支持 acquire/release、lease version、lock token、过期接管。

## 3. CLI / API 最小 timeline

- [x] 3.1 CLI 增加 `timeline --db <path> --task <task-id>`。
- [x] 3.2 API 增加 `GET /tasks/:taskId/timeline`，从 `COORDINATOR_DB_PATH` 读取数据库。

## 4. 测试与验证

- [x] 4.1 测试 migration 创建所有核心表和约束。
- [x] 4.2 测试创建 task 与 event 同事务提交。
- [x] 4.3 测试 CAS conflict。
- [x] 4.4 测试 operation idempotency 和 active uniqueness。
- [x] 4.5 测试 lock 获取、释放、未过期拒绝、过期接管。
- [x] 4.6 测试 CLI/API timeline 查询。
- [x] 4.7 运行 OpenSpec validate、类型检查、测试和构建。
