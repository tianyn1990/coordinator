import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { serviceInfo } from "@coordinator/shared";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">coordinator</p>
        <h1>Operator Surface</h1>
        <p className="summary">
          当前阶段：{serviceInfo.stage}。本入口用于验证 Web 骨架，后续任务管理、人类确认、PR/MR 审批和可观测性视图会在独立迭代中补齐。
        </p>
        <dl className="facts">
          <div>
            <dt>API</dt>
            <dd>Fastify health ready</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>SQLite migration ready</dd>
          </div>
          <div>
            <dt>CLI</dt>
            <dd>health / migrate ready</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("缺少 root 挂载节点");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
