## MODIFIED Requirements

### Requirement: Web 应用必须提供 operator surface 入口
系统 SHALL 提供 Vite + React Web 启动入口，并展示可连接 API 的 coordinator operator surface，用于查看 task、创建 manual task、查看 timeline/surface、回答 human request 和执行 PR/MR approval 调试操作。

#### Scenario: 构建 Web 应用

- **WHEN** 开发者执行 Web 构建脚本
- **THEN** 系统生成可部署的 Web 静态产物

#### Scenario: 打开 Web operator surface

- **WHEN** operator 打开 Web 应用
- **THEN** 系统展示 task list、manual task 创建入口和当前连接 API 的状态
- **AND** 页面不再只是项目骨架占位信息
