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
  diagnosis: OperatorTaskDiagnosis;
};

type OperatorTaskDiagnosis = {
  currentBlocker: string;
  operatorAttention: {
    required: boolean;
    reasons: string[];
  };
  retryBudget: {
    scheduledCount: number;
    latestDueAt?: string;
    exhausted: boolean;
    lastReason?: string;
  };
  operationLedger: Array<{
    id: string;
    kind: string;
    status: string;
    failureCode?: string;
    externalId?: string;
    lastDecision?: string;
    lastReasonCode?: string;
    lastObservedSummary?: string;
  }>;
  recoveryTimeline: Array<{
    eventId: number;
    resourceKind?: string;
    resourceId?: string;
    operationId?: string;
    decision?: string;
    reasonCode?: string;
    observedSummary?: string;
    nextAction?: string;
    retryDueAt?: string;
    operatorAttentionRequired: boolean;
    artifactRefs: string[];
    severity: string;
    createdAt: string;
  }>;
  providerProtocolInspections: Array<{
    eventId: number;
    type: string;
    summary: string;
    resource?: string;
    operationId?: string;
    artifactRefs: string[];
    severity: string;
    createdAt: string;
  }>;
};

type Flash = {
  tone: "ok" | "error";
  message: string;
};

type ViewMode = "workbench" | "classic-debug";

type ProjectRailItem = {
  id: string;
  name: string;
  total: number;
  attention: number;
};

type MissionMetrics = {
  total: number;
  running: number;
  needsHuman: number;
  attention: number;
  review: number;
  done: number;
};

type TaskCard = {
  task: TaskListItem;
  detail?: TaskDetail;
  prSummary: string;
  statusTone: "running" | "waiting" | "attention" | "done" | "idle";
  nextOwner: string;
  blocker: string;
  workflowSummary: string;
  artifactSummary: string;
  needsHuman: boolean;
  needsMergeApproval: boolean;
  attentionRequired: boolean;
  hasPrAttention: boolean;
};

type ActionInboxItem = {
  id: string;
  taskId: string;
  projectName: string;
  title: string;
  kind: "merge" | "human" | "attention" | "pr" | "failed";
  tone: "waiting" | "attention" | "danger";
  label: string;
  summary: string;
};

type WorkbenchModel = {
  projectRail: ProjectRailItem[];
  metrics: MissionMetrics;
  cards: TaskCard[];
  inbox: ActionInboxItem[];
};

const apiBase = import.meta.env.VITE_COORDINATOR_API_BASE ?? "http://127.0.0.1:4310";

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [taskDetails, setTaskDetails] = useState<Record<string, TaskDetail>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("workbench");
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
      const hydratedDetails = await hydrateTaskDetails(taskResult.tasks);
      setTaskDetails(hydratedDetails);
      setDetail(taskId ? hydratedDetails[taskId] ?? (await request<TaskDetail>(`/tasks/${taskId}`)) : undefined);
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
      const nextDetail = taskDetails[taskId] ?? (await request<TaskDetail>(`/tasks/${taskId}`));
      setDetail(nextDetail);
      setTaskDetails((current) => ({ ...current, [taskId]: nextDetail }));
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function openTask(taskId: string, mode: ViewMode) {
    setViewMode(mode);
    await selectTask(taskId);
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

  const workbench = useMemo(
    () => buildWorkbenchModel(projects, tasks, taskDetails, selectedProjectId),
    [projects, tasks, taskDetails, selectedProjectId]
  );

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
    <main className="workbench-shell">
      <header className="global-bar">
        <div className="brand-mark">
          <div>
            <p>coordinator</p>
            <h1>Developer Workbench</h1>
          </div>
          <span>{serviceInfo.stage}</span>
        </div>
        <div className="global-search" aria-label="Workbench context">
          <span>API</span>
          <strong>{apiBase}</strong>
        </div>
        <nav className="view-tabs" aria-label="Primary views">
          <button type="button" className={viewMode === "workbench" ? "tab active" : "tab"} onClick={() => setViewMode("workbench")}>
            Workbench
          </button>
          <button
            type="button"
            className={viewMode === "classic-debug" ? "tab active" : "tab"}
            disabled={!detail}
            onClick={() => setViewMode("classic-debug")}
          >
            Classic Debug
          </button>
          <button type="button" className="tab ghost" disabled title="Task Cockpit 会在后续迭代实现">
            Cockpit
          </button>
          <button type="button" className="tab ghost" disabled title="Project Admin 会在后续迭代实现">
            Projects
          </button>
        </nav>
        <div className="actions">
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
          <button type="button" onClick={() => void runDaemonTick()}>
            Daemon tick
          </button>
        </div>
      </header>

      {flash ? <p className={`flash ${flash.tone}`}>{flash.message}</p> : null}

      {viewMode === "classic-debug" && detail ? (
        <section className="workspace classic-shell">
          <div className="topbar">
            <div>
              <p className="eyebrow">Classic Debug</p>
              <h2>{detail.task.title}</h2>
            </div>
            <button type="button" onClick={() => setViewMode("workbench")}>
              Back to Workbench
            </button>
          </div>
          <TaskDetailView
            detail={detail}
            onAnswer={answerHumanRequest}
            onDecideMerge={decideMerge}
            onMerge={mergeAfterApproval}
            onTaskControl={controlTask}
          />
        </section>
      ) : (
        <DeveloperWorkbench
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          model={workbench}
          selectedTaskId={selectedTaskId}
          onOpenTask={(taskId) => void openTask(taskId, "classic-debug")}
          onCreateTask={createTask}
        />
      )}
    </main>
  );
}

function DeveloperWorkbench({
  projects,
  selectedProjectId,
  onSelectProject,
  model,
  selectedTaskId,
  onOpenTask,
  onCreateTask
}: {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  model: WorkbenchModel;
  selectedTaskId?: string;
  onOpenTask: (taskId: string) => void;
  onCreateTask: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="workbench-grid">
      <ProjectRail
        projects={projects}
        items={model.projectRail}
        selectedProjectId={selectedProjectId}
        onSelectProject={onSelectProject}
      />
      <section className="workbench-main">
        <MissionStrip metrics={model.metrics} />
        <WorkbenchBoard cards={model.cards} selectedTaskId={selectedTaskId} onOpenTask={onOpenTask} />
      </section>
      <aside className="action-column">
        <ActionInbox items={model.inbox} onOpenTask={onOpenTask} />
        <QuickTaskComposer projects={projects} onCreateTask={onCreateTask} />
      </aside>
    </div>
  );
}

function ProjectRail({
  items,
  selectedProjectId,
  onSelectProject
}: {
  projects: Project[];
  items: ProjectRailItem[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
}) {
  const total = items.reduce(
    (summary, item) => ({
      total: summary.total + item.total,
      attention: summary.attention + item.attention
    }),
    { total: 0, attention: 0 }
  );

  return (
    <aside className="project-rail">
      <div className="rail-header">
        <p className="eyebrow">Projects</p>
        <strong>{items.length}</strong>
      </div>
      <button
        type="button"
        className={selectedProjectId === "all" ? "project-pill active" : "project-pill"}
        onClick={() => onSelectProject("all")}
      >
        <span>All projects</span>
        <small>
          {total.total} tasks · {total.attention} needs me
        </small>
      </button>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={selectedProjectId === item.id ? "project-pill active" : "project-pill"}
          onClick={() => onSelectProject(item.id)}
        >
          <span>{item.name}</span>
          <small>
            {item.total} tasks · {item.attention} needs me
          </small>
        </button>
      ))}
      <button type="button" className="project-pill disabled" disabled title="Project Admin 会在后续迭代实现">
        <span>Register project</span>
        <small>planned in Slice 13.3</small>
      </button>
    </aside>
  );
}

function MissionStrip({ metrics }: { metrics: MissionMetrics }) {
  return (
    <section className="mission-strip" aria-label="Mission summary">
      <Metric label="Total" value={metrics.total} tone="neutral" />
      <Metric label="Running" value={metrics.running} tone="running" />
      <Metric label="Needs me" value={metrics.needsHuman} tone="waiting" />
      <Metric label="Attention" value={metrics.attention} tone="attention" />
      <Metric label="Review" value={metrics.review} tone="waiting" />
      <Metric label="Done" value={metrics.done} tone="done" />
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkbenchBoard({
  cards,
  selectedTaskId,
  onOpenTask
}: {
  cards: TaskCard[];
  selectedTaskId?: string;
  onOpenTask: (taskId: string) => void;
}) {
  const sections = [
    {
      id: "needs",
      title: "Needs me",
      cards: cards.filter((card) => card.needsHuman || card.needsMergeApproval || card.attentionRequired)
    },
    {
      id: "running",
      title: "Workflow active",
      cards: cards.filter((card) => card.statusTone === "running" && !card.needsHuman && !card.needsMergeApproval && !card.attentionRequired)
    },
    {
      id: "review",
      title: "PR / Review",
      cards: cards.filter((card) => card.hasPrAttention && card.statusTone !== "done")
    },
    {
      id: "waiting",
      title: "Waiting / Blocked",
      // 等待态任务可能没有 detail hydration；单独 lane 保证 Workbench 不漏掉这些任务。
      cards: cards.filter(
        (card) =>
          card.statusTone === "waiting" &&
          !card.needsHuman &&
          !card.needsMergeApproval &&
          !card.attentionRequired &&
          !card.hasPrAttention
      )
    },
    {
      id: "done",
      title: "Done / Idle",
      cards: cards.filter((card) => (card.statusTone === "done" || card.statusTone === "idle") && !card.hasPrAttention)
    }
  ];

  return (
    <section className="board" aria-label="Task board">
      {sections.map((section) => (
        <div key={section.id} className="board-section">
          <div className="section-title">
            <h2>{section.title}</h2>
            <span>{section.cards.length}</span>
          </div>
          <div className="card-stack">
            {section.cards.length === 0 ? <p className="muted empty-inline">No tasks in this lane.</p> : null}
            {section.cards.map((card) => (
              <TaskCardView
                key={`${section.id}-${card.task.id}`}
                card={card}
                selected={selectedTaskId === card.task.id}
                onOpenTask={onOpenTask}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function TaskCardView({
  card,
  selected,
  onOpenTask
}: {
  card: TaskCard;
  selected: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <article className={selected ? `task-card tone-${card.statusTone} selected` : `task-card tone-${card.statusTone}`}>
      <div className="card-main">
        <span className="card-topline">
          <span>{card.task.projectName}</span>
          <strong>{card.task.status}</strong>
        </span>
        <span className="card-subline">
          autonomy: {card.task.autonomy} · source: {card.task.sourceKind}
        </span>
        <h3>{card.task.title}</h3>
        <p>{card.blocker}</p>
        <div className="signal-row">
          <span>{card.nextOwner}</span>
          <span>{card.workflowSummary}</span>
        </div>
        <div className="signal-row">
          <span>{card.prSummary}</span>
          <span>{card.artifactSummary}</span>
        </div>
      </div>
      <div className="card-actions">
        <small>{formatRelativeTime(card.task.updatedAt)}</small>
        <button type="button" onClick={() => onOpenTask(card.task.id)}>
          Debug
        </button>
      </div>
    </article>
  );
}

function ActionInbox({ items, onOpenTask }: { items: ActionInboxItem[]; onOpenTask: (taskId: string) => void }) {
  return (
    <section className="inbox-panel" aria-label="Action inbox">
      <div className="panel-heading">
        <p className="eyebrow">Action Inbox</p>
        <strong>{items.length}</strong>
      </div>
      {items.length === 0 ? <p className="muted">当前没有需要人工处理的事项。</p> : null}
      <div className="inbox-list">
        {items.map((item) => (
          <button key={item.id} type="button" className={`inbox-item ${item.tone}`} onClick={() => onOpenTask(item.taskId)}>
            <span>{item.label}</span>
            <strong>{item.title}</strong>
            <small>
              {item.projectName} · {item.summary}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function QuickTaskComposer({ projects, onCreateTask }: { projects: Project[]; onCreateTask: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className="quick-task" onSubmit={onCreateTask}>
      <div className="panel-heading">
        <p className="eyebrow">New Task</p>
        <strong>Manual</strong>
      </div>
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
        <textarea name="description" rows={5} placeholder="任务背景、约束、验收标准" />
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
        <h3>Diagnosis</h3>
        <div className="diagnosis-grid">
          <div>
            <p className="field-label">Operator attention</p>
            <p className={detail.diagnosis.operatorAttention.required ? "attention warn" : "attention ok"}>
              {detail.diagnosis.operatorAttention.required ? "required" : "not required"}
            </p>
            <RecordList
              empty="暂无 operator attention reason。"
              items={detail.diagnosis.operatorAttention.reasons}
            />
          </div>
          <div>
            <p className="field-label">Retry budget</p>
            <RecordTable
              rows={[
                ["Scheduled", String(detail.diagnosis.retryBudget.scheduledCount)],
                ["Latest due", detail.diagnosis.retryBudget.latestDueAt ?? "none"],
                ["Exhausted", String(detail.diagnosis.retryBudget.exhausted)],
                ["Last reason", detail.diagnosis.retryBudget.lastReason ?? "none"]
              ]}
            />
          </div>
        </div>
        <div className="diagnosis-columns">
          <DiagnosisList
            title="Recovery timeline"
            empty="暂无 recovery decision。"
            items={detail.diagnosis.recoveryTimeline.map((item) => [
              item.reasonCode ?? item.decision ?? "recovery",
              [
                item.createdAt,
                item.resourceKind && item.resourceId ? `${item.resourceKind}:${item.resourceId}` : undefined,
                item.nextAction ? `next=${item.nextAction}` : undefined,
                item.observedSummary
              ]
                .filter(Boolean)
                .join(" · ")
            ])}
          />
          <DiagnosisList
            title="Operation ledger"
            empty="暂无 operation。"
            items={detail.diagnosis.operationLedger.map((item) => [
              `${item.kind} · ${item.status}`,
              [
                item.failureCode ? `failure=${item.failureCode}` : undefined,
                item.lastDecision ? `decision=${item.lastDecision}` : undefined,
                item.lastReasonCode,
                item.lastObservedSummary
              ]
                .filter(Boolean)
                .join(" · ")
            ])}
          />
          <DiagnosisList
            title="Provider / protocol inspect"
            empty="暂无 inspect 摘要。"
            items={detail.diagnosis.providerProtocolInspections.map((item) => [
              item.type,
              [item.createdAt, item.resource, item.summary].filter(Boolean).join(" · ")
            ])}
          />
        </div>
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

async function hydrateTaskDetails(tasks: TaskListItem[]): Promise<Record<string, TaskDetail>> {
  const candidates = tasks;
  const entries = await Promise.all(
    candidates.map(async (task) => {
      try {
        return [task.id, await request<TaskDetail>(`/tasks/${task.id}`)] as const;
      } catch {
        return undefined;
      }
    })
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, TaskDetail] => Boolean(entry)));
}

function buildWorkbenchModel(
  projects: Project[],
  tasks: TaskListItem[],
  details: Record<string, TaskDetail>,
  selectedProjectId: string
): WorkbenchModel {
  const allCards = tasks.map((task) => buildTaskCard(task, details[task.id]));
  const cards = selectedProjectId === "all" ? allCards : allCards.filter((card) => card.task.projectId === selectedProjectId);
  const projectRail = projects.map((project) => {
    const projectCards = allCards.filter((card) => card.task.projectId === project.id);
    return {
      id: project.id,
      name: project.name,
      total: projectCards.length,
      attention: projectCards.filter((card) => card.needsHuman || card.needsMergeApproval || card.attentionRequired).length
    };
  });
  return {
    projectRail,
    metrics: {
      total: cards.length,
      running: cards.filter((card) => card.statusTone === "running").length,
      needsHuman: cards.filter((card) => card.needsHuman || card.needsMergeApproval).length,
      attention: cards.filter((card) => card.attentionRequired).length,
      review: cards.filter((card) => card.hasPrAttention).length,
      done: cards.filter((card) => card.statusTone === "done").length
    },
    cards,
    inbox: buildActionInbox(cards)
  };
}

function buildTaskCard(task: TaskListItem, detail?: TaskDetail): TaskCard {
  const pendingHuman = detail?.humanRequests.find((request) => request.status === "pending" && request.kind !== "merge_approval");
  const pendingMerge = detail?.humanRequests.find((request) => request.status === "pending" && request.kind === "merge_approval");
  const hasPrAttention = Boolean(detail?.latestPullRequest && detail.latestPullRequest.status !== "merged");
  const attentionRequired = detail?.diagnosis.operatorAttention.required ?? isHighRiskStatus(task.status);
  return {
    task,
    detail,
    prSummary: prSummary(detail),
    statusTone: taskTone(task.status, Boolean(pendingHuman || pendingMerge), attentionRequired),
    nextOwner: nextOwner(task, detail, Boolean(pendingHuman), Boolean(pendingMerge), attentionRequired),
    blocker: detail?.currentBlocker ?? task.status,
    workflowSummary: workflowSummary(detail),
    artifactSummary: artifactSummary(detail),
    needsHuman: Boolean(pendingHuman),
    needsMergeApproval: Boolean(pendingMerge),
    attentionRequired,
    hasPrAttention
  };
}

function buildActionInbox(cards: TaskCard[]): ActionInboxItem[] {
  return cards.flatMap((card) => {
    const items: ActionInboxItem[] = [];
    const pendingMerge = card.detail?.humanRequests.find((request) => request.status === "pending" && request.kind === "merge_approval");
    const pendingHuman = card.detail?.humanRequests.find((request) => request.status === "pending" && request.kind !== "merge_approval");
    if (pendingMerge) {
      items.push({
        id: `merge-${pendingMerge.id}`,
        taskId: card.task.id,
        projectName: card.task.projectName,
        title: card.task.title,
        kind: "merge",
        tone: pendingMerge.approvalValid === false ? "danger" : "waiting",
        label: "Merge approval",
        summary: pendingMerge.approvalValid === false ? "snapshot invalid" : "waiting decision"
      });
    }
    if (pendingHuman) {
      items.push({
        id: `human-${pendingHuman.id}`,
        taskId: card.task.id,
        projectName: card.task.projectName,
        title: card.task.title,
        kind: "human",
        tone: "waiting",
        label: "Human request",
        summary: pendingHuman.questionArtifactPath ?? pendingHuman.blockedKey
      });
    }
    if (card.attentionRequired) {
      items.push({
        id: `attention-${card.task.id}`,
        taskId: card.task.id,
        projectName: card.task.projectName,
        title: card.task.title,
        kind: isHighRiskStatus(card.task.status) ? "failed" : "attention",
        tone: isHighRiskStatus(card.task.status) ? "danger" : "attention",
        label: isHighRiskStatus(card.task.status) ? "High risk" : "Operator attention",
        summary: card.detail?.diagnosis.operatorAttention.reasons[0] ?? card.blocker
      });
    }
    if (card.hasPrAttention && card.detail?.latestPullRequest) {
      items.push({
        id: `pr-${card.detail.latestPullRequest.id}`,
        taskId: card.task.id,
        projectName: card.task.projectName,
        title: card.task.title,
        kind: "pr",
        tone: "waiting",
        label: "PR / MR review",
        summary: `${card.detail.latestPullRequest.status} / review=${card.detail.latestPullRequest.reviewStatus}`
      });
    }
    return items;
  });
}

function taskTone(status: string, needsHuman: boolean, attentionRequired: boolean): TaskCard["statusTone"] {
  if (attentionRequired || isHighRiskStatus(status)) return "attention";
  if (needsHuman || status.includes("waiting") || status === "merge_waiting") return "waiting";
  if (status === "completed" || status === "done") return "done";
  if (status === "planning" || status === "running" || status === "resuming" || status === "human_answered") return "running";
  return "idle";
}

function nextOwner(
  task: TaskListItem,
  detail: TaskDetail | undefined,
  needsHuman: boolean,
  needsMergeApproval: boolean,
  attentionRequired: boolean
): string {
  if (needsMergeApproval) return "next: human approval";
  if (needsHuman) return "next: human answer";
  if (attentionRequired) return "next: operator review";
  const workflow = detail?.workflowRuns[0];
  if (workflow?.status === "running") return "next: workflow handoff";
  if (detail?.latestPullRequest && detail.latestPullRequest.status !== "merged") return "next: PR/MR review";
  if (task.status === "planning" || task.status === "resuming") return "next: daemon tick";
  if (isTerminalTaskStatus(task.status)) return "next: none";
  return `next: ${task.status}`;
}

function workflowSummary(detail?: TaskDetail): string {
  const run = detail?.workflowRuns[0];
  if (!run) return "Workflow: none";
  return `Workflow: ${run.profileId || "auto"} / ${run.status} / handoff=${run.handoffKind ?? "none"}`;
}

function prSummary(detail?: TaskDetail): string {
  if (!detail?.latestPullRequest) return "PR/MR: none";
  return `PR/MR: ${detail.latestPullRequest.status} / review=${detail.latestPullRequest.reviewStatus}`;
}

function artifactSummary(detail?: TaskDetail): string {
  const artifacts = [
    detail?.executionPlan?.artifactPath,
    detail?.agentSessions.find((session) => session.finalResponsePath)?.finalResponsePath,
    detail?.latestPullRequest?.bodyArtifactPath
  ].filter(Boolean);
  if (artifacts.length === 0) return "artifacts: none";
  return `artifacts: ${artifacts.slice(0, 2).join(", ")}`;
}

function isHighRiskStatus(status: string): boolean {
  return status === "failed" || status === "unknown" || status === "blocked";
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value.replace(" ", "T"));
  if (!Number.isFinite(timestamp)) return value;
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
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

function DiagnosisList({ title, empty, items }: { title: string; empty: string; items: Array<[string, string]> }) {
  return (
    <div className="diagnosis-list">
      <p className="field-label">{title}</p>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="compact-list">
          {items.map(([primary, secondary], index) => (
            <li key={`${primary}-${index}`}>
              <strong>{primary}</strong>
              {secondary ? <span>{secondary}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
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
