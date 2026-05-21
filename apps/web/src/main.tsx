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

type ViewMode = "workbench" | "task-cockpit" | "classic-debug";

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

type FlowTone = "done" | "active" | "waiting" | "attention" | "idle";

type OuterFlowNode = {
  id: string;
  label: string;
  tone: FlowTone;
  summary: string;
};

type WorkflowActionHint = {
  actionId: string;
  requiredArgs: string[];
  usage?: string;
};

type WorkflowArtifactRef = {
  kind: string;
  path: string;
  label?: string;
};

type WorkflowLensModel = {
  profile: string;
  lifecycle: string;
  stage: string;
  substate: string;
  gateState: string;
  gateReason: string;
  progressLabel: string;
  progressSummary: string;
  handoff: string;
  allowedActions: string[];
  deniedActions: string[];
  actionHints: WorkflowActionHint[];
  stageArtifacts: WorkflowArtifactRef[];
  latestEvents: EventRecord[];
  inspectOnlyReason: string;
};

type EvidenceItem = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  tone: "neutral" | "waiting" | "attention" | "danger";
};

type TaskCockpitModel = {
  flow: OuterFlowNode[];
  workflow: WorkflowLensModel;
  evidence: EvidenceItem[];
  keyArtifacts: string[];
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
            className={viewMode === "task-cockpit" ? "tab active" : "tab"}
            disabled={!detail}
            onClick={() => setViewMode("task-cockpit")}
          >
            Cockpit
          </button>
          <button
            type="button"
            className={viewMode === "classic-debug" ? "tab active" : "tab"}
            disabled={!detail}
            onClick={() => setViewMode("classic-debug")}
          >
            Classic Debug
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
            <div className="inline-actions">
              <button type="button" onClick={() => setViewMode("task-cockpit")}>
                Back to Cockpit
              </button>
              <button type="button" onClick={() => setViewMode("workbench")}>
                Workbench
              </button>
            </div>
          </div>
          <TaskDetailView
            detail={detail}
            onAnswer={answerHumanRequest}
            onDecideMerge={decideMerge}
            onMerge={mergeAfterApproval}
            onTaskControl={controlTask}
          />
        </section>
      ) : viewMode === "task-cockpit" && detail ? (
        <TaskCockpitView
          detail={detail}
          onBack={() => setViewMode("workbench")}
          onClassicDebug={() => setViewMode("classic-debug")}
          onAnswer={answerHumanRequest}
          onDecideMerge={decideMerge}
          onMerge={mergeAfterApproval}
          onTaskControl={controlTask}
        />
      ) : (
        <DeveloperWorkbench
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          model={workbench}
          selectedTaskId={selectedTaskId}
          onOpenTask={(taskId) => void openTask(taskId, "task-cockpit")}
          onOpenClassicDebug={(taskId) => void openTask(taskId, "classic-debug")}
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
  onOpenClassicDebug,
  onCreateTask
}: {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  model: WorkbenchModel;
  selectedTaskId?: string;
  onOpenTask: (taskId: string) => void;
  onOpenClassicDebug: (taskId: string) => void;
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
        <WorkbenchBoard
          cards={model.cards}
          selectedTaskId={selectedTaskId}
          onOpenTask={onOpenTask}
          onOpenClassicDebug={onOpenClassicDebug}
        />
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
  onOpenTask,
  onOpenClassicDebug
}: {
  cards: TaskCard[];
  selectedTaskId?: string;
  onOpenTask: (taskId: string) => void;
  onOpenClassicDebug: (taskId: string) => void;
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
                onOpenClassicDebug={onOpenClassicDebug}
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
  onOpenTask,
  onOpenClassicDebug
}: {
  card: TaskCard;
  selected: boolean;
  onOpenTask: (taskId: string) => void;
  onOpenClassicDebug: (taskId: string) => void;
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
          Open
        </button>
        <button type="button" onClick={() => onOpenClassicDebug(card.task.id)}>
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

function TaskCockpitView({
  detail,
  onBack,
  onClassicDebug,
  onAnswer,
  onDecideMerge,
  onMerge,
  onTaskControl
}: {
  detail: TaskDetail;
  onBack: () => void;
  onClassicDebug: () => void;
  onAnswer: (event: React.FormEvent<HTMLFormElement>, request: HumanRequest) => void;
  onDecideMerge: (pr: PullRequest, request: HumanRequest, decision: "approve" | "reject") => void;
  onMerge: (pr: PullRequest) => void;
  onTaskControl: (action: "pause" | "resume" | "cancel" | "retry", reason: string) => void;
}) {
  const model = buildTaskCockpitModel(detail);

  return (
    <section className="cockpit-shell">
      <header className="cockpit-header">
        <div>
          <p className="eyebrow">{detail.project.name} / Task Cockpit</p>
          <h2>{detail.task.title}</h2>
          <p>{detail.currentBlocker}</p>
        </div>
        <div className="inline-actions">
          <button type="button" onClick={onBack}>
            Workbench
          </button>
          <button type="button" onClick={onClassicDebug}>
            Classic Debug
          </button>
        </div>
      </header>

      <section className="summary-band cockpit-facts">
        <Fact label="Status" value={detail.task.status} />
        <Fact label="Next owner" value={nextOwner(detail.task, detail, model.evidence.some((item) => item.kind === "human"), model.evidence.some((item) => item.kind === "merge"), detail.diagnosis.operatorAttention.required)} />
        <Fact label="Surface" value={detail.surface.surfaceKind} />
        <Fact label="Updated" value={formatRelativeTime(detail.task.updatedAt)} />
      </section>

      <OuterFlowMap nodes={model.flow} />

      <div className="cockpit-grid">
        <WorkflowLens model={model.workflow} />
        <EvidenceActionsPanel
          detail={detail}
          evidence={model.evidence}
          keyArtifacts={model.keyArtifacts}
          onAnswer={onAnswer}
          onDecideMerge={onDecideMerge}
          onMerge={onMerge}
          onTaskControl={onTaskControl}
        />
      </div>

      <DebugDrawer detail={detail} />
    </section>
  );
}

function OuterFlowMap({ nodes }: { nodes: OuterFlowNode[] }) {
  return (
    <section className="outer-flow" aria-label="Outer flow map">
      <div className="section-title">
        <h2>Outer Flow</h2>
        <span>{nodes.filter((node) => node.tone === "done").length}/{nodes.length}</span>
      </div>
      <div className="flow-rail">
        {nodes.map((node) => (
          <article key={node.id} className={`flow-node tone-${node.tone}`}>
            <span>{node.label}</span>
            <strong>{node.tone}</strong>
            <p>{node.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function WorkflowLens({ model }: { model: WorkflowLensModel }) {
  return (
    <section className="workflow-lens">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Workflow Lens</p>
          <h3>{model.profile} / {model.lifecycle}</h3>
        </div>
        <span className={`attention ${model.gateState === "blocked" ? "warn" : "ok"}`}>{model.gateState}</span>
      </div>
      <div className="workflow-stage">
        <div>
          <span>stage</span>
          <strong>{model.stage}</strong>
        </div>
        <div>
          <span>substate</span>
          <strong>{model.substate}</strong>
        </div>
        <div>
          <span>handoff</span>
          <strong>{model.handoff}</strong>
        </div>
      </div>
      <div className="lens-callout">
        <strong>{model.progressLabel}</strong>
        <p>{model.progressSummary}</p>
        <small>{model.inspectOnlyReason}</small>
      </div>
      <div className="lens-columns">
        <LensList title="Allowed actions" empty="none" items={model.allowedActions} />
        <LensList title="Denied actions" empty="none" items={model.deniedActions} />
      </div>
      <div className="lens-section">
        <p className="field-label">Action input hints</p>
        {model.actionHints.length === 0 ? <p className="muted">暂无 action input hint。</p> : null}
        {model.actionHints.map((hint) => (
          <div key={hint.actionId} className="hint-row">
            <strong>{hint.actionId}</strong>
            <span>args: {hint.requiredArgs.length > 0 ? hint.requiredArgs.join(", ") : "none"}</span>
            {hint.usage ? <small>{hint.usage}</small> : null}
          </div>
        ))}
      </div>
      <div className="lens-section">
        <p className="field-label">Stage artifacts</p>
        {model.stageArtifacts.length === 0 ? <p className="muted">暂无 stage artifact；使用 task artifacts fallback。</p> : null}
        <ul className="compact-list">
          {model.stageArtifacts.map((artifact) => (
            <li key={`${artifact.kind}-${artifact.path}`}>
              <strong>{artifact.label ?? artifact.kind}</strong>
              <span>{artifact.path}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="lens-section">
        <p className="field-label">Latest workflow events</p>
        {model.latestEvents.length === 0 ? <p className="muted">暂无 workflow event 摘要。</p> : null}
        <ul className="compact-list">
          {model.latestEvents.map((event) => (
            <li key={event.id}>
              <strong>{event.type}</strong>
              <span>{event.summary}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function LensList({ title, empty, items }: { title: string; empty: string; items: string[] }) {
  return (
    <div className="lens-section">
      <p className="field-label">{title}</p>
      {items.length === 0 ? <p className="muted">{empty}</p> : null}
      <div className="chips">
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function EvidenceActionsPanel({
  detail,
  evidence,
  keyArtifacts,
  onAnswer,
  onDecideMerge,
  onMerge,
  onTaskControl
}: {
  detail: TaskDetail;
  evidence: EvidenceItem[];
  keyArtifacts: string[];
  onAnswer: (event: React.FormEvent<HTMLFormElement>, request: HumanRequest) => void;
  onDecideMerge: (pr: PullRequest, request: HumanRequest, decision: "approve" | "reject") => void;
  onMerge: (pr: PullRequest) => void;
  onTaskControl: (action: "pause" | "resume" | "cancel" | "retry", reason: string) => void;
}) {
  const pendingMergeRequest = detail.humanRequests.find((request) => request.kind === "merge_approval" && request.status === "pending");
  const pendingRequests = detail.humanRequests.filter((request) => request.status === "pending" && request.kind !== "merge_approval");
  const surfaceTools = detail.surface.json.available_tools.map((tool) => tool.name);
  const canMerge = detail.latestPullRequest && surfaceTools.includes("merge_after_approval");

  return (
    <aside className="evidence-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Evidence / Actions</p>
          <h3>{evidence.length} items</h3>
        </div>
      </div>
      <div className="evidence-list">
        {evidence.length === 0 ? <p className="muted">暂无需要突出的 evidence 或 action。</p> : null}
        {evidence.map((item) => (
          <article key={item.id} className={`evidence-card ${item.tone}`}>
            <span>{item.kind}</span>
            <strong>{item.title}</strong>
            <p>{item.summary}</p>
          </article>
        ))}
      </div>
      <section className="panel-lite">
        <p className="field-label">Task controls</p>
        <div className="control-grid compact">
          <TaskControlButton label="Pause" disabled={!canPauseTask(detail.task.status)} onClick={() => onTaskControl("pause", "operator-paused-from-cockpit")} />
          <TaskControlButton label="Resume" disabled={detail.task.status !== "paused"} onClick={() => onTaskControl("resume", "operator-resumed-from-cockpit")} />
          <TaskControlButton label="Retry" disabled={!canRetryTask(detail.task.status)} onClick={() => onTaskControl("retry", "operator-retry-from-cockpit")} />
          <TaskControlButton label="Cancel" danger disabled={isTerminalTaskStatus(detail.task.status)} onClick={() => onTaskControl("cancel", "operator-canceled-from-cockpit")} />
        </div>
      </section>
      <section className="panel-lite">
        <p className="field-label">Human requests</p>
        {pendingRequests.length === 0 ? <p className="muted">没有待回答的 human request。</p> : null}
        {pendingRequests.map((request) => (
          <form key={request.id} className="answer-form" onSubmit={(event) => onAnswer(event, request)}>
            <p className="muted">question: {request.questionArtifactPath ?? request.blockedKey}</p>
            <textarea name="answer" rows={4} placeholder="回答会写入 human answer artifact" required />
            <input name="answeredBy" defaultValue="web-operator" />
            <button type="submit">Record answer</button>
          </form>
        ))}
      </section>
      <section className="panel-lite">
        <p className="field-label">PR/MR</p>
        {detail.latestPullRequest ? (
          <>
            <RecordTable
              rows={[
                ["Status", detail.latestPullRequest.status],
                ["Review", detail.latestPullRequest.reviewStatus],
                ["URL", detail.latestPullRequest.url ?? "none"]
              ]}
            />
            {pendingMergeRequest || canMerge ? (
              <div className="inline-actions">
                {pendingMergeRequest ? (
                  <>
                    <button type="button" onClick={() => onDecideMerge(detail.latestPullRequest!, pendingMergeRequest, "approve")}>
                      Approve
                    </button>
                    <button type="button" onClick={() => onDecideMerge(detail.latestPullRequest!, pendingMergeRequest, "reject")}>
                      Reject
                    </button>
                  </>
                ) : null}
                <button type="button" disabled={!canMerge} onClick={() => onMerge(detail.latestPullRequest!)}>
                  Merge
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">尚无 PR/MR。</p>
        )}
      </section>
      <section className="panel-lite">
        <p className="field-label">Key artifacts</p>
        <RecordList items={keyArtifacts} empty="暂无 artifact ref。" />
      </section>
    </aside>
  );
}

function DebugDrawer({ detail }: { detail: TaskDetail }) {
  return (
    <details className="debug-drawer">
      <summary>
        <span>Debug Drawer</span>
        <strong>surface / timeline / operations</strong>
      </summary>
      <div className="debug-grid">
        <section className="panel-lite">
          <p className="field-label">Coordinator Surface</p>
          <p>{detail.surface.json.recommended_next_step}</p>
          <div className="chips">
            {detail.surface.json.available_tools.map((tool) => (
              <span key={tool.name}>{tool.name}</span>
            ))}
          </div>
        </section>
        <DiagnosisList
          title="Operation ledger"
          empty="暂无 operation。"
          items={detail.diagnosis.operationLedger.map((item) => [
            `${item.kind} · ${item.status}`,
            [item.failureCode ? `failure=${item.failureCode}` : undefined, item.lastDecision, item.lastObservedSummary]
              .filter(Boolean)
              .join(" · ")
          ])}
        />
        <DiagnosisList
          title="Recovery timeline"
          empty="暂无 recovery decision。"
          items={detail.diagnosis.recoveryTimeline.map((item) => [
            item.reasonCode ?? item.decision ?? "recovery",
            [item.createdAt, item.nextAction ? `next=${item.nextAction}` : undefined, item.observedSummary].filter(Boolean).join(" · ")
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
      <ol className="timeline compact-timeline">
        {detail.events.slice(-12).map((event) => (
          <li key={event.id}>
            <span className={`severity ${event.severity}`}>{event.severity}</span>
            <div>
              <strong>{event.type}</strong>
              <p>{event.summary}</p>
              <small>{event.createdAt}</small>
            </div>
          </li>
        ))}
      </ol>
    </details>
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
  const pendingMergeRequest = detail.humanRequests.find((request) => request.kind === "merge_approval" && request.status === "pending");
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
            {pendingMergeRequest || canMerge ? (
              <div className="merge-box">
                {pendingMergeRequest ? (
                  <>
                    <p className="field-label">Merge approval snapshot</p>
                    <RecordTable
                      rows={[
                        ["Request", pendingMergeRequest.id],
                        ["Status", pendingMergeRequest.status],
                        ["Valid", String(pendingMergeRequest.approvalValid)],
                        ["Head", pendingMergeRequest.approvalPrHeadSha ?? "missing"],
                        ["Base", pendingMergeRequest.approvalPrBaseSha ?? "missing"],
                        ["Validation", pendingMergeRequest.approvalValidationRunId ?? "missing"],
                        ["Strategy", pendingMergeRequest.approvalMergeStrategy ?? "squash"]
                      ]}
                    />
                  </>
                ) : null}
                <div className="inline-actions">
                  {pendingMergeRequest ? (
                    <>
                      <button type="button" onClick={() => onDecideMerge(detail.latestPullRequest!, pendingMergeRequest, "approve")}>
                        Approve
                      </button>
                      <button type="button" onClick={() => onDecideMerge(detail.latestPullRequest!, pendingMergeRequest, "reject")}>
                        Reject
                      </button>
                    </>
                  ) : null}
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

function buildTaskCockpitModel(detail: TaskDetail): TaskCockpitModel {
  const workflow = buildWorkflowLensModel(detail);
  return {
    flow: buildOuterFlow(detail),
    workflow,
    evidence: buildEvidenceItems(detail),
    keyArtifacts: collectKeyArtifacts(detail, workflow)
  };
}

function buildOuterFlow(detail: TaskDetail): OuterFlowNode[] {
  // 这里故意只构建 Web display model：节点状态不写回 Core，也不参与 daemon 决策。
  const latestWorkflow = detail.workflowRuns[0];
  const latestPr = detail.latestPullRequest;
  const pendingHuman = detail.humanRequests.some((request) => request.status === "pending" && request.kind !== "merge_approval");
  const pendingMerge = detail.humanRequests.some((request) => request.status === "pending" && request.kind === "merge_approval");
  const done = isTerminalTaskStatus(detail.task.status) && detail.task.status !== "failed";
  const failed = isHighRiskStatus(detail.task.status) || detail.diagnosis.operatorAttention.required;

  return [
    { id: "task", label: "Task", tone: done ? "done" : failed ? "attention" : "active", summary: detail.task.status },
    {
      id: "plan",
      label: "Plan",
      tone: detail.executionPlan ? "done" : detail.task.status === "planning" ? "active" : "idle",
      summary: detail.executionPlan?.artifactPath ?? "waiting plan"
    },
    {
      id: "attempt",
      label: "Attempt",
      tone: detail.attempt ? "done" : "idle",
      summary: detail.attempt ? `${detail.attempt.status} / ${detail.attempt.reason}` : "none"
    },
    {
      id: "workspace",
      label: "Workspace",
      tone: detail.workspace?.status === "ready" ? "done" : detail.workspace ? "waiting" : "idle",
      summary: detail.workspace?.branch ?? detail.workspace?.status ?? "none"
    },
    {
      id: "workflow",
      label: "Workflow",
      tone: latestWorkflow?.status === "running" ? "active" : latestWorkflow?.handoffKind ? "done" : latestWorkflow ? "waiting" : "idle",
      summary: latestWorkflow ? `${latestWorkflow.profileId || "auto"} / ${latestWorkflow.status}` : "none"
    },
    {
      id: "pr",
      label: "PR/MR",
      tone: latestPr ? (latestPr.status === "merged" ? "done" : "waiting") : "idle",
      summary: latestPr ? `${latestPr.status} / ${latestPr.reviewStatus}` : "none"
    },
    {
      id: "review",
      label: "Review",
      tone: pendingHuman ? "waiting" : latestPr?.reviewStatus === "approved" ? "done" : latestPr ? "active" : "idle",
      summary: pendingHuman ? "human request pending" : latestPr?.reviewStatus ?? "none"
    },
    {
      id: "merge",
      label: "Merge",
      tone: latestPr?.status === "merged" ? "done" : pendingMerge ? "waiting" : latestPr ? "active" : "idle",
      summary: pendingMerge ? "approval pending" : latestPr?.mergedAt ?? latestPr?.status ?? "none"
    },
    {
      id: "done",
      label: "Done",
      tone: done ? "done" : failed ? "attention" : "idle",
      summary: done ? detail.task.status : failed ? "operator attention" : "not yet"
    }
  ];
}

function buildWorkflowLensModel(detail: TaskDetail): WorkflowLensModel {
  const run = detail.workflowRuns[0];
  const projection = extractWorkflowProjection(detail);
  const lifecycle = projection.lifecycle ?? run?.status ?? "none";
  const handoff = projection.handoff ?? run?.handoffKind ?? "none";
  const stage = projection.stage ?? "unknown";
  const substate = projection.substate ?? "none";
  const gateState = projection.gateState ?? "unknown";
  const progressLabel = projection.progressLabel ?? (stage === "unknown" ? "Workflow status" : stage);
  const progressSummary = projection.progressSummary ?? workflowSummary(detail);
  const latestEvents = detail.events.filter((event) => event.type.startsWith("workflow.")).slice(-5);
  const inspectOnlyReason =
    run?.status === "running" && !run.handoffKind
      ? "workflow 正在运行且尚未 handoff；Coordinator 只读 inspect / 等待 handoff，不自动执行 workflow action。"
      : "Workflow debug 字段只用于 operator 展示，不驱动外层状态。";

  return {
    profile: projection.profile ?? run?.profileId ?? "none",
    lifecycle,
    stage,
    substate,
    gateState,
    gateReason: projection.gateReason ?? "none",
    progressLabel,
    progressSummary,
    handoff,
    allowedActions: projection.allowedActions,
    deniedActions: projection.deniedActions,
    actionHints: projection.actionHints,
    stageArtifacts: projection.stageArtifacts,
    latestEvents,
    inspectOnlyReason
  };
}

function buildEvidenceItems(detail: TaskDetail): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const request of detail.humanRequests.filter((item) => item.status === "pending")) {
    items.push({
      id: `request-${request.id}`,
      kind: request.kind === "merge_approval" ? "merge" : "human",
      title: request.kind === "merge_approval" ? "Merge approval pending" : "Human request pending",
      summary: request.questionArtifactPath ?? request.blockedKey,
      tone: request.kind === "merge_approval" && request.approvalValid === false ? "danger" : "waiting"
    });
  }
  if (detail.latestPullRequest) {
    items.push({
      id: `pr-${detail.latestPullRequest.id}`,
      kind: "pr/mr",
      title: detail.latestPullRequest.title ?? detail.latestPullRequest.id,
      summary: `${detail.latestPullRequest.status} / review=${detail.latestPullRequest.reviewStatus}`,
      tone: detail.latestPullRequest.status === "conflict" ? "danger" : "neutral"
    });
  }
  if (detail.diagnosis.operatorAttention.required) {
    items.push({
      id: "operator-attention",
      kind: "attention",
      title: "Operator attention required",
      summary: detail.diagnosis.operatorAttention.reasons[0] ?? detail.currentBlocker,
      tone: "attention"
    });
  }
  return items;
}

function collectKeyArtifacts(detail: TaskDetail, workflow: WorkflowLensModel): string[] {
  return [
    detail.executionPlan?.artifactPath,
    detail.agentSessions.find((session) => session.finalResponsePath)?.finalResponsePath,
    detail.latestPullRequest?.bodyArtifactPath,
    ...workflow.stageArtifacts.map((artifact) => artifact.path),
    ...detail.events.flatMap((event) => event.artifactRefs)
  ]
    .filter((item): item is string => Boolean(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 12);
}

function extractWorkflowProjection(detail: TaskDetail): {
  profile?: string;
  lifecycle?: string;
  stage?: string;
  substate?: string;
  gateState?: string;
  gateReason?: string;
  progressLabel?: string;
  progressSummary?: string;
  handoff?: string;
  allowedActions: string[];
  deniedActions: string[];
  actionHints: WorkflowActionHint[];
  stageArtifacts: WorkflowArtifactRef[];
} {
  // Workflow protocol 字段只来自公开 event payload；缺字段时宁可 fallback，也不读取 .workflow private state。
  const workflowEvents = [...detail.events].reverse().filter((event) => event.type.startsWith("workflow."));
  for (const event of workflowEvents) {
    const payload = isRecord(event.payload) ? event.payload : undefined;
    const status = isRecord(payload?.status) ? payload.status : payload;
    const debug = isRecord(status?.debug) ? status.debug : isRecord(payload?.debug) ? payload.debug : undefined;
    const gate = isRecord(status?.gate) ? status.gate : isRecord(debug?.gate) ? debug.gate : undefined;
    const progress = isRecord(status?.progress) ? status.progress : isRecord(debug?.progress) ? debug.progress : undefined;
    const handoff = isRecord(status?.handoff) ? status.handoff : isRecord(payload?.handoff) ? payload.handoff : undefined;
    const stageArtifacts = readArtifactRefs(status?.stageArtifacts ?? debug?.stageArtifacts);
    const actionHints = readActionHints(status?.actionInputHints ?? status?.actionInputs ?? debug?.actionInputHints ?? debug?.actionInputs);
    const allowedActions = readStringArray(status?.allowedActions ?? debug?.allowedActions);
    const deniedActions = readStringArray(status?.deniedActions ?? debug?.deniedActions);
    const stage = readString(status?.stage ?? debug?.stage);
    const substate = readString(status?.substate ?? debug?.substate);

    if (
      readString(status?.profile ?? payload?.profile) ||
      readString(status?.lifecycle ?? payload?.lifecycle) ||
      stage ||
      substate ||
      gate ||
      progress ||
      handoff ||
      allowedActions.length > 0 ||
      deniedActions.length > 0 ||
      actionHints.length > 0 ||
      stageArtifacts.length > 0
    ) {
      return {
        profile: readString(status?.profile ?? payload?.profile),
        lifecycle: readString(status?.lifecycle ?? payload?.lifecycle),
        stage,
        substate,
        gateState: readString(gate?.state),
        gateReason: readString(gate?.reason),
        progressLabel: readString(progress?.label),
        progressSummary: readString(progress?.summary ?? status?.summary ?? payload?.summary),
        handoff: readHandoffSummary(handoff),
        allowedActions,
        deniedActions,
        actionHints,
        stageArtifacts
      };
    }
  }
  return { allowedActions: [], deniedActions: [], actionHints: [], stageArtifacts: [] };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function readActionHints(value: unknown): WorkflowActionHint[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([actionId, rawHint]) => {
    if (!isRecord(rawHint)) return [];
    return [
      {
        actionId,
        requiredArgs: readStringArray(rawHint.requiredArgs),
        usage: readString(rawHint.usage)
      }
    ];
  });
}

function readArtifactRefs(value: unknown): WorkflowArtifactRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const path = readString(item.path);
    if (!path) return [];
    return [
      {
        kind: readString(item.kind) ?? "artifact",
        path,
        label: readString(item.label)
      }
    ];
  });
}

function readHandoffSummary(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const available = typeof value.available === "boolean" ? value.available : undefined;
  const kind = readString(value.kind);
  if (available === false) return "none";
  if (available === true) return kind ?? "available";
  return kind;
}

function formatRelativeTime(value: string | undefined): string {
  if (!value) return "unknown";
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
