import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { serviceInfo } from "@coordinator/shared";
import "./styles.css";

type Project = {
  id: string;
  name: string;
  defaultBranch?: string;
  registrationStatus?: string;
};

type TaskListItem = {
  id: string;
  projectId: string;
  projectName: string;
  sourceKind: string;
  title: string;
  description: string;
  autonomy: string;
  status: string;
  stateVersion: number;
  updatedAt: string;
};

type HumanRequest = {
  id: string;
  kind: string;
  status: string;
  blockedKey: string;
  questionArtifactPath?: string;
  answerArtifactPath?: string;
  prId?: string;
  approvalPrHeadSha?: string;
  approvalPrBaseSha?: string;
  approvalValidationRunId?: string;
  approvalMergeStrategy?: string;
  approvalValid?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  stateVersion: number;
};

type PullRequest = {
  id: string;
  providerKind: string;
  status: string;
  externalId?: string;
  url?: string;
  headBranch?: string;
  baseBranch?: string;
  headSha?: string;
  baseSha?: string;
  title?: string;
  bodyArtifactPath?: string;
  reviewStatus: string;
  reviewSummary?: string;
  validationRunId?: string;
  mergeStrategy?: string;
  mergedAt?: string;
  stateVersion: number;
};

type EventRecord = {
  id: number;
  type: string;
  summary: string;
  severity: string;
  operationId?: string;
  prId?: string;
  humanRequestId?: string;
  payload?: unknown;
  artifactRefs: string[];
  createdAt: string;
};

type ToolTracePayload = {
  toolName?: string;
  status?: string;
  failureCode?: string;
  resultSummary?: unknown;
};

type SurfaceEnvelope = {
  surfaceId: string;
  surfaceKind: string;
  json: {
    surface_kind: string;
    recommended_next_step: string;
    denied_actions: string[];
    available_tools: Array<{ name: string; usage: string; args: string[]; side_effect: boolean }>;
    artifact_root: string;
    merge_approval?: {
      pr_id: string;
      status: string;
      valid: boolean;
      head_sha?: string;
      base_sha?: string;
      validation_run_id?: string;
      merge_strategy?: string;
      approved_by?: string;
      approved_at?: string;
    } | null;
  };
  markdown: string;
};

type TaskDetail = {
  task: TaskListItem;
  project: Project;
  attempt?: { id: string; status: string; reason: string; stateVersion: number };
  executionPlan?: { id: string; status: string; artifactPath?: string };
  workspace?: { id: string; status: string; workspacePath?: string; repoPath?: string; branch?: string; baseBranch?: string };
  workflowRuns: Array<{ id: string; profileId: string; status: string; handoffKind?: string }>;
  agentSessions: Array<{ id: string; providerKind: string; role: string; status: string; finalResponsePath?: string }>;
  pullRequests: PullRequest[];
  latestPullRequest?: PullRequest;
  humanRequests: HumanRequest[];
  events: EventRecord[];
  surface: SurfaceEnvelope;
  currentBlocker: string;
};

type Flash = {
  tone: "ok" | "error";
  message: string;
};

const apiBase = import.meta.env.VITE_COORDINATOR_API_BASE ?? "http://127.0.0.1:4310";

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [detail, setDetail] = useState<TaskDetail | undefined>();
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<Flash | undefined>();

  async function refresh(nextTaskId = selectedTaskId) {
    setLoading(true);
    try {
      const [projectResult, taskResult] = await Promise.all([
        request<{ projects: Project[] }>("/projects"),
        request<{ tasks: TaskListItem[] }>("/tasks")
      ]);
      setProjects(projectResult.projects);
      setTasks(taskResult.tasks);
      const taskId = nextTaskId ?? taskResult.tasks[0]?.id;
      setSelectedTaskId(taskId);
      setDetail(taskId ? await request<TaskDetail>(`/tasks/${taskId}`) : undefined);
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function selectTask(taskId: string) {
    setSelectedTaskId(taskId);
    setLoading(true);
    try {
      setDetail(await request<TaskDetail>(`/tasks/${taskId}`));
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await request<{ task: TaskListItem }>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: String(form.get("projectId") ?? ""),
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          autonomy: String(form.get("autonomy") ?? "balanced")
        })
      });
      event.currentTarget.reset();
      setFlash({ tone: "ok", message: "manual task 已创建" });
      await refresh(result.task.id);
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function answerHumanRequest(event: React.FormEvent<HTMLFormElement>, requestItem: HumanRequest) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request(`/human-requests/${requestItem.id}/answer`, {
        method: "POST",
        body: JSON.stringify({
          expectedStateVersion: requestItem.stateVersion,
          answer: String(form.get("answer") ?? ""),
          answeredBy: String(form.get("answeredBy") ?? "web-operator")
        })
      });
      setFlash({ tone: "ok", message: "human answer 已记录" });
      await refresh();
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function runDaemonTick() {
    try {
      const result = await request<{ status: string; actions: Array<{ kind: string; status: string; summary: string }> }>("/daemon/tick", {
        method: "POST",
        body: JSON.stringify({ owner: "web-operator", candidateLimit: 5 })
      });
      setFlash({ tone: "ok", message: `daemon tick: ${result.status}, actions=${result.actions.length}` });
      await refresh();
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function decideMerge(pr: PullRequest, humanRequest: HumanRequest, decision: "approve" | "reject") {
    if (!detail) return;
    try {
      await request(`/tasks/${detail.task.id}/pull-requests/${pr.id}/merge-approval`, {
        method: "POST",
        body: JSON.stringify({ humanRequestId: humanRequest.id, decision, actor: "web-operator" })
      });
      setFlash({ tone: "ok", message: decision === "approve" ? "merge approval 已批准" : "merge approval 已拒绝" });
      await refresh();
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function mergeAfterApproval(pr: PullRequest) {
    if (!detail) return;
    try {
      await request(`/tasks/${detail.task.id}/pull-requests/${pr.id}/merge`, { method: "POST" });
      setFlash({ tone: "ok", message: "merge 已触发，结果以 Core 返回和 timeline 为准" });
      await refresh();
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function controlTask(action: "pause" | "resume" | "cancel" | "retry", reason: string) {
    if (!detail) return;
    try {
      const result = await request<{ task: TaskListItem; nextStatus: string }>(`/tasks/${detail.task.id}/control`, {
        method: "POST",
        body: JSON.stringify({
          action,
          expectedStateVersion: detail.task.stateVersion,
          reason,
          actor: "web-operator"
        })
      });
      setFlash({ tone: "ok", message: `task ${action}: ${result.nextStatus}` });
      await refresh(result.task.id);
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header className="brand">
          <div>
            <p>coordinator</p>
            <h1>Operator Console</h1>
          </div>
          <span>{serviceInfo.stage}</span>
        </header>

        <form className="create-task" onSubmit={createTask}>
          <label>
            Project
            <select name="projectId" required>
              <option value="">选择工程</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input name="title" placeholder="新任务标题" required />
          </label>
          <label>
            Description
            <textarea name="description" rows={4} placeholder="任务背景、约束、验收标准" />
          </label>
          <label>
            Autonomy
            <select name="autonomy" defaultValue="balanced">
              <option value="balanced">balanced</option>
              <option value="conservative">conservative</option>
              <option value="aggressive">aggressive</option>
            </select>
          </label>
          <button type="submit">Create task</button>
        </form>

        <section className="task-list" aria-label="Task list">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={task.id === selectedTaskId ? "task-row selected" : "task-row"}
              onClick={() => void selectTask(task.id)}
            >
              <span className="task-title">{task.title}</span>
              <span className="task-meta">
                {task.projectName} · {task.status} · {task.autonomy}
              </span>
            </button>
          ))}
        </section>
      </aside>

      <section className="workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">API {apiBase}</p>
            <h2>{detail?.task.title ?? "未选择 task"}</h2>
          </div>
          <div className="actions">
            <button type="button" onClick={() => void refresh()} disabled={loading}>
              Refresh
            </button>
            <button type="button" onClick={() => void runDaemonTick()}>
              Daemon tick
            </button>
          </div>
        </div>

        {flash ? <p className={`flash ${flash.tone}`}>{flash.message}</p> : null}

        {detail ? (
          <TaskDetailView
            detail={detail}
            onAnswer={answerHumanRequest}
            onDecideMerge={decideMerge}
            onMerge={mergeAfterApproval}
            onTaskControl={controlTask}
          />
        ) : (
          <div className="empty-state">暂无 task。先注册 project 并创建 manual task。</div>
        )}
      </section>
    </main>
  );
}

function TaskDetailView({
  detail,
  onAnswer,
  onDecideMerge,
  onMerge,
  onTaskControl
}: {
  detail: TaskDetail;
  onAnswer: (event: React.FormEvent<HTMLFormElement>, request: HumanRequest) => void;
  onDecideMerge: (pr: PullRequest, request: HumanRequest, decision: "approve" | "reject") => void;
  onMerge: (pr: PullRequest) => void;
  onTaskControl: (action: "pause" | "resume" | "cancel" | "retry", reason: string) => void;
}) {
  const mergeRequest = detail.humanRequests.find((request) => request.kind === "merge_approval");
  const pendingRequests = detail.humanRequests.filter((request) => request.status === "pending" && request.kind !== "merge_approval");
  const surfaceTools = detail.surface.json.available_tools.map((tool) => tool.name);
  const canMerge = detail.latestPullRequest && surfaceTools.includes("merge_after_approval");

  return (
    <div className="detail-grid">
      <section className="summary-band">
        <Fact label="Status" value={detail.task.status} />
        <Fact label="Blocker" value={detail.currentBlocker} />
        <Fact label="Surface" value={detail.surface.surfaceKind} />
        <Fact label="Artifact root" value={detail.surface.json.artifact_root} mono />
      </section>

      <section className="panel wide">
        <h3>Task Controls</h3>
        <div className="control-grid">
          <TaskControlButton
            label="Pause"
            disabled={!canPauseTask(detail.task.status)}
            onClick={() => onTaskControl("pause", "operator-paused-from-web")}
          />
          <TaskControlButton
            label="Resume"
            disabled={detail.task.status !== "paused"}
            onClick={() => onTaskControl("resume", "operator-resumed-from-web")}
          />
          <TaskControlButton
            label="Retry"
            disabled={!canRetryTask(detail.task.status)}
            onClick={() => onTaskControl("retry", "operator-retry-from-web")}
          />
          <TaskControlButton
            label="Cancel"
            danger
            disabled={isTerminalTaskStatus(detail.task.status)}
            onClick={() => onTaskControl("cancel", "operator-canceled-from-web")}
          />
        </div>
        <p className="muted">Cancel 只停止 coordinator 自动推进，不会删除 workspace、关闭 PR/MR 或清理 artifact。</p>
      </section>

      <section className="panel wide">
        <h3>Coordinator Surface</h3>
        <div className="surface-grid">
          <div>
            <p className="field-label">Recommended next step</p>
            <p>{detail.surface.json.recommended_next_step}</p>
          </div>
          <div>
            <p className="field-label">Available tools</p>
            <div className="chips">
              {detail.surface.json.available_tools.map((tool) => (
                <span key={tool.name}>{tool.name}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="field-label">Denied actions</p>
            <ul className="compact-list">
              {detail.surface.json.denied_actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Execution</h3>
        <RecordTable
          rows={[
            ["Project", detail.project.name],
            ["Attempt", detail.attempt ? `${detail.attempt.id} / ${detail.attempt.status}` : "none"],
            ["Plan", detail.executionPlan ? `${detail.executionPlan.status} / ${detail.executionPlan.artifactPath ?? "no artifact"}` : "none"],
            ["Workspace", detail.workspace ? `${detail.workspace.status} / ${detail.workspace.branch ?? "no branch"}` : "none"]
          ]}
        />
      </section>

      <section className="panel">
        <h3>Workflow / Agent</h3>
        <RecordList
          empty="暂无 workflow run"
          items={detail.workflowRuns.map((run) => `${run.profileId} · ${run.status} · handoff=${run.handoffKind ?? "none"}`)}
        />
        <RecordList
          empty="暂无 agent session"
          items={detail.agentSessions.map((session) => `${session.role} · ${session.providerKind} · ${session.status}`)}
        />
      </section>

      <section className="panel">
        <h3>Human Requests</h3>
        {pendingRequests.length === 0 ? <p className="muted">没有待回答的 human request。</p> : null}
        {pendingRequests.map((request) => (
          <form key={request.id} className="answer-form" onSubmit={(event) => onAnswer(event, request)}>
            <p className="field-label">
              {request.kind} · version {request.stateVersion}
            </p>
            <p className="muted">question: {request.questionArtifactPath ?? "no artifact"}</p>
            <textarea name="answer" rows={5} placeholder="回答会写入 human answer artifact" required />
            <input name="answeredBy" defaultValue="web-operator" />
            <button type="submit">Record answer</button>
          </form>
        ))}
      </section>

      <section className="panel">
        <h3>PR/MR</h3>
        {detail.latestPullRequest ? (
          <>
            <RecordTable
              rows={[
                ["PR", detail.latestPullRequest.id],
                ["Status", detail.latestPullRequest.status],
                ["Review", detail.latestPullRequest.reviewStatus],
                ["Head", detail.latestPullRequest.headSha ?? "missing"],
                ["Base", detail.latestPullRequest.baseSha ?? "missing"],
                ["Validation", detail.latestPullRequest.validationRunId ?? "missing"],
                ["URL", detail.latestPullRequest.url ?? "none"]
              ]}
            />
            {mergeRequest ? (
              <div className="merge-box">
                <p className="field-label">Merge approval snapshot</p>
                <RecordTable
                  rows={[
                    ["Request", mergeRequest.id],
                    ["Status", mergeRequest.status],
                    ["Valid", String(mergeRequest.approvalValid)],
                    ["Head", mergeRequest.approvalPrHeadSha ?? "missing"],
                    ["Base", mergeRequest.approvalPrBaseSha ?? "missing"],
                    ["Validation", mergeRequest.approvalValidationRunId ?? "missing"],
                    ["Strategy", mergeRequest.approvalMergeStrategy ?? "squash"]
                  ]}
                />
                <div className="inline-actions">
                  <button type="button" onClick={() => onDecideMerge(detail.latestPullRequest!, mergeRequest, "approve")}>
                    Approve
                  </button>
                  <button type="button" onClick={() => onDecideMerge(detail.latestPullRequest!, mergeRequest, "reject")}>
                    Reject
                  </button>
                  <button type="button" disabled={!canMerge} onClick={() => onMerge(detail.latestPullRequest!)}>
                    Merge
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted">尚无 merge approval request。</p>
            )}
          </>
        ) : (
          <p className="muted">尚无 PR/MR。</p>
        )}
      </section>

      <section className="panel wide">
        <h3>Timeline</h3>
        <ol className="timeline">
          {detail.events.map((event) => (
            <li key={event.id}>
              <span className={`severity ${event.severity}`}>{event.severity}</span>
              <div>
                <strong>{event.type}</strong>
                <p>{event.summary}</p>
                {event.type === "agent_tool_call" ? <ToolTrace payload={event.payload as ToolTracePayload | undefined} /> : null}
                <small>
                  {event.createdAt}
                  {event.operationId ? ` · operation=${event.operationId}` : ""}
                  {event.artifactRefs.length > 0 ? ` · artifacts=${event.artifactRefs.join(",")}` : ""}
                </small>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function TaskControlButton({
  label,
  disabled,
  danger = false,
  onClick
}: {
  label: string;
  disabled: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={danger ? "danger-button" : undefined} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

function canPauseTask(status: string): boolean {
  return !isTerminalTaskStatus(status) && status !== "paused";
}

function canRetryTask(status: string): boolean {
  return (
    !isTerminalTaskStatus(status) &&
    status !== "paused" &&
    status !== "waiting_human" &&
    status !== "waiting_review" &&
    status !== "waiting_merge_approval" &&
    status !== "merge_waiting"
  );
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "completed" || status === "handoff" || status === "canceled" || status === "failed";
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong className={mono ? "mono truncate" : "truncate"}>{value}</strong>
    </div>
  );
}

function RecordTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="record-table">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecordList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="muted">{empty}</p>;
  }
  return (
    <ul className="compact-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ToolTrace({ payload }: { payload?: ToolTracePayload }) {
  if (!payload) {
    return null;
  }
  return (
    <dl className="tool-trace">
      <div>
        <dt>tool</dt>
        <dd>{String(payload.toolName ?? "unknown")}</dd>
      </div>
      <div>
        <dt>status</dt>
        <dd>{String(payload.status ?? "unknown")}</dd>
      </div>
      {payload.failureCode ? (
        <div>
          <dt>failure</dt>
          <dd>{payload.failureCode}</dd>
        </div>
      ) : null}
      {payload.resultSummary ? (
        <div>
          <dt>result</dt>
          <dd>{renderValue(payload.resultSummary)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function renderValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return body as T;
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
