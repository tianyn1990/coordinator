import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { workflowActionButtonLabel } from "./workflow-actions.js";
import {
  WEB_V2_DEBUG_DETAIL_DEFAULT_OPEN,
  buildRunMatrixRow,
  buildWorkbenchV2Model,
  collectArtifactRefs,
  deriveUnifiedComposerProjection,
  deriveRunUntilBlockedStopReason,
  isTerminalTaskStatus,
  type GateItem,
  type HumanRequest,
  type Project,
  type PullRequest,
  type RailNode,
  type RunMatrixRow,
  type RunUntilBlockedStopReason,
  type TaskAttachment,
  type TaskDetail,
  type TaskListItem,
  type UnifiedComposerProjection,
  type WorkflowLensSummary
} from "./workbench-v2-model.js";
import "./styles.css";

type Flash = {
  tone: "ok" | "error";
  message: string;
};

type DaemonTickAction = {
  kind: string;
  taskId?: string;
  workflowRunId?: string;
  status: string;
  summary: string;
};

type DaemonTickResult = {
  tickId: string;
  status: string;
  actions: DaemonTickAction[];
};

type RunUntilBlockedState = {
  running: boolean;
  scope: "global" | "task";
  taskId?: string;
  tickCount: number;
  maxTicks: number;
  logs: Array<{ index: number; status: string; actions: DaemonTickAction[] }>;
  stop?: RunUntilBlockedStopReason;
};

type WorkflowActionSubmitInput = {
  workflowRunId: string;
  expectedStateVersion: number;
  action: string;
  arg?: string;
};

type ComposerSubmitInput = {
  projection: UnifiedComposerProjection;
  projectId: string;
  title: string;
  body: string;
  autonomy: "conservative" | "balanced" | "aggressive";
  requestedWorkflowProfile?: string;
  file?: File;
};

const apiBase = import.meta.env.VITE_COORDINATOR_API_BASE ?? "http://127.0.0.1:4310";
const RUN_UNTIL_BLOCKED_MAX_TICKS = 8;
const MAX_WEB_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function App() {
  return <WorkbenchShell />;
}

function WorkbenchShell() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [details, setDetails] = useState<Record<string, TaskDetail>>({});
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [query, setQuery] = useState("");
  const [focusedTaskId, setFocusedTaskId] = useState<string | undefined>();
  const [focusedDetail, setFocusedDetail] = useState<TaskDetail | undefined>();
  const [debugOpen, setDebugOpen] = useState(WEB_V2_DEBUG_DETAIL_DEFAULT_OPEN);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<Flash | undefined>();
  const [runState, setRunState] = useState<RunUntilBlockedState | undefined>();
  const [composerResetToken, setComposerResetToken] = useState(0);

  const model = useMemo(
    () => buildWorkbenchV2Model({ tasks, details, projectId: selectedProjectId, query }),
    [tasks, details, selectedProjectId, query]
  );

  const focusedRow = useMemo(() => {
    const fromMatrix = model.rows.find((row) => row.task.id === focusedTaskId);
    if (fromMatrix) return fromMatrix;
    return focusedDetail ? buildRunMatrixRow(focusedDetail.task, focusedDetail) : undefined;
  }, [focusedDetail, focusedTaskId, model.rows]);

  async function refresh(nextTaskId = focusedTaskId): Promise<TaskDetail | undefined> {
    setLoading(true);
    try {
      const [projectResult, taskResult] = await Promise.all([
        request<{ projects: Project[] }>("/projects"),
        request<{ tasks: TaskListItem[] }>("/tasks")
      ]);
      const hydrated = await hydrateTaskDetails(taskResult.tasks);
      const nextId = nextTaskId ?? focusedTaskId ?? taskResult.tasks[0]?.id;
      const nextDetail = nextId ? hydrated[nextId] ?? (await request<TaskDetail>(`/tasks/${nextId}`)) : undefined;
      setProjects(projectResult.projects);
      setTasks(taskResult.tasks);
      setDetails(nextDetail ? { ...hydrated, [nextDetail.task.id]: nextDetail } : hydrated);
      setFocusedTaskId(nextId);
      setFocusedDetail(nextDetail);
      return nextDetail;
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
      return undefined;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function focusTask(taskId: string, options?: { openDebug?: boolean }) {
    setFocusedTaskId(taskId);
    if (options?.openDebug) {
      setDebugOpen(true);
    }
    const cached = details[taskId];
    if (cached) {
      setFocusedDetail(cached);
      return;
    }
    setLoading(true);
    try {
      const detail = await request<TaskDetail>(`/tasks/${taskId}`);
      setDetails((current) => ({ ...current, [taskId]: detail }));
      setFocusedDetail(detail);
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function runDaemonTick() {
    try {
      const result = await request<DaemonTickResult>("/daemon/tick", {
        method: "POST",
        body: JSON.stringify({ owner: "web-operator", candidateLimit: 5 })
      });
      setFlash({ tone: "ok", message: `daemon tick: ${result.status}, actions=${result.actions.length}` });
      await refresh();
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function runUntilBlocked(taskId?: string) {
    const seed = taskId ? (focusedDetail?.task.id === taskId ? focusedDetail : details[taskId]) : focusedDetail;
    setRunState({
      running: true,
      scope: taskId ? "task" : "global",
      taskId,
      tickCount: 0,
      maxTicks: RUN_UNTIL_BLOCKED_MAX_TICKS,
      logs: []
    });
    let currentDetail = seed;
    let logs: RunUntilBlockedState["logs"] = [];
    try {
      for (let index = 1; index <= RUN_UNTIL_BLOCKED_MAX_TICKS; index += 1) {
        const tick = await request<DaemonTickResult>("/daemon/tick", {
          method: "POST",
          body: JSON.stringify({ owner: "web-operator", candidateLimit: 5, taskId })
        });
        logs = [...logs, { index, status: tick.status, actions: tick.actions }];
        currentDetail = await refresh(taskId ?? currentDetail?.task.id);
        const stop = deriveRunUntilBlockedStopReason({
          detail: currentDetail,
          tick,
          tickIndex: index,
          maxTicks: RUN_UNTIL_BLOCKED_MAX_TICKS,
          scope: taskId ? "task" : "global",
          taskId
        });
        if (stop.stop) {
          setRunState({
            running: false,
            scope: taskId ? "task" : "global",
            taskId,
            tickCount: index,
            maxTicks: RUN_UNTIL_BLOCKED_MAX_TICKS,
            logs,
            stop
          });
          setFlash({ tone: "ok", message: stop.summary });
          return;
        }
      }
      const stop: RunUntilBlockedStopReason = {
        stop: true,
        kind: "max-ticks",
        label: "Max ticks",
        summary: `stopped after ${RUN_UNTIL_BLOCKED_MAX_TICKS} ticks`,
        scope: taskId ? "task" : "global",
        taskId
      };
      setRunState({
        running: false,
        scope: taskId ? "task" : "global",
        taskId,
        tickCount: logs.length,
        maxTicks: RUN_UNTIL_BLOCKED_MAX_TICKS,
        logs,
        stop
      });
      setFlash({ tone: "ok", message: stop.summary });
    } catch (error) {
      const summary = `stopped: ${error instanceof Error ? error.message : String(error)}`;
      const stop: RunUntilBlockedStopReason = {
        stop: true,
        kind: "failed",
        label: "Run failed",
        summary,
        scope: taskId ? "task" : "global",
        taskId
      };
      setRunState({
        running: false,
        scope: taskId ? "task" : "global",
        taskId,
        tickCount: logs.length,
        maxTicks: RUN_UNTIL_BLOCKED_MAX_TICKS,
        logs,
        stop
      });
      setFlash({ tone: "error", message: summary });
    }
  }

  async function submitWorkflowAction(input: WorkflowActionSubmitInput) {
    try {
      await request(`/workflow-runs/${input.workflowRunId}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: input.action,
          arg: input.arg,
          expectedStateVersion: input.expectedStateVersion,
          actor: "web-operator"
        })
      });
      setFlash({ tone: "ok", message: `workflow gate confirmed: ${input.action}` });
      await refresh(focusedTaskId);
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function decideMerge(pr: PullRequest, humanRequest: HumanRequest, decision: "approve" | "reject") {
    if (!focusedDetail) return;
    try {
      await request(`/tasks/${focusedDetail.task.id}/pull-requests/${pr.id}/merge-approval`, {
        method: "POST",
        body: JSON.stringify({ humanRequestId: humanRequest.id, decision, actor: "web-operator" })
      });
      setFlash({ tone: "ok", message: decision === "approve" ? "merge approval approved" : "merge approval rejected" });
      await refresh(focusedDetail.task.id);
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function mergeAfterApproval(pr: PullRequest) {
    if (!focusedDetail) return;
    try {
      await request(`/tasks/${focusedDetail.task.id}/pull-requests/${pr.id}/merge`, { method: "POST" });
      setFlash({ tone: "ok", message: "merge requested; Core remains the gate" });
      await refresh(focusedDetail.task.id);
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function controlTask(action: "pause" | "resume" | "cancel" | "retry") {
    if (!focusedDetail) return;
    try {
      await request(`/tasks/${focusedDetail.task.id}/control`, {
        method: "POST",
        body: JSON.stringify({
          action,
          expectedStateVersion: focusedDetail.task.stateVersion,
          reason: `operator-${action}-from-web-v2`,
          actor: "web-operator"
        })
      });
      setFlash({ tone: "ok", message: `task ${action} submitted` });
      await refresh(focusedDetail.task.id);
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function submitComposer(input: ComposerSubmitInput) {
    let targetTaskId = input.projection.taskId;
    let primaryCommitted = false;
    try {
      if (input.projection.mode === "new-task") {
        const created = await request<{ task: TaskListItem }>("/tasks", {
          method: "POST",
          body: JSON.stringify({
            projectId: input.projectId,
            title: input.title,
            description: input.body,
            autonomy: input.autonomy,
            requestedWorkflowProfile: input.requestedWorkflowProfile || undefined
          })
        });
        targetTaskId = created.task.id;
        primaryCommitted = true;
      } else if (input.projection.mode === "human-answer" && input.projection.humanRequest) {
        await request(`/human-requests/${input.projection.humanRequest.id}/answer`, {
          method: "POST",
          body: JSON.stringify({
            expectedStateVersion: input.projection.humanRequest.stateVersion,
            answer: input.body,
            answeredBy: "web-operator"
          })
        });
        primaryCommitted = true;
      } else if (input.projection.mode === "task-note" && targetTaskId && input.body.trim()) {
        await request(`/tasks/${targetTaskId}/notes`, {
          method: "POST",
          body: JSON.stringify({
            note: input.body,
            actor: "web-operator"
          })
        });
        primaryCommitted = true;
      }

      if (input.file && targetTaskId) {
        await uploadAttachment(targetTaskId, input.file);
      }
      setFlash({ tone: "ok", message: input.file ? "composer submitted with attachment" : "composer submitted" });
      setComposerResetToken((value) => value + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (primaryCommitted && input.file) {
        // 主操作成功后附件失败属于部分成功，必须刷新到最新 task，避免用户误以为 task 未创建。
        setComposerResetToken((value) => value + 1);
        setFlash({ tone: "error", message: `main update saved; attachment failed: ${message}` });
      } else {
        setFlash({ tone: "error", message });
      }
    } finally {
      await refresh(targetTaskId ?? focusedTaskId);
    }
  }

  return (
    <main className="v2-shell">
      <CommandBar
        projects={projects}
        selectedProjectId={selectedProjectId}
        query={query}
        metrics={model.metrics}
        loading={loading}
        running={Boolean(runState?.running)}
        onSelectProject={setSelectedProjectId}
        onQuery={setQuery}
        onRefresh={() => void refresh()}
        onRunQueue={() => void runUntilBlocked()}
        onDaemonTick={() => void runDaemonTick()}
      />

      {flash ? <p className={`flash ${flash.tone}`}>{flash.message}</p> : null}
      {runState ? <RunUntilBlockedBanner state={runState} /> : null}

      <section className="v2-workspace" aria-label="Coordinator Web V2 Workbench">
        <RunMatrix
          rows={model.rows}
          selectedTaskId={focusedTaskId}
          onFocusTask={(taskId) => void focusTask(taskId)}
          onOpenDebug={(taskId) => void focusTask(taskId, { openDebug: true })}
        />
        <FocusDrawer
          row={focusedRow}
          detail={focusedDetail}
          inbox={model.inbox.filter((item) => item.taskId === focusedTaskId)}
          debugOpen={debugOpen}
          onDebugOpenChange={setDebugOpen}
          onWorkflowAction={submitWorkflowAction}
          onDecideMerge={decideMerge}
          onMerge={mergeAfterApproval}
          onTaskControl={(action) => void controlTask(action)}
          onRunTask={(taskId) => void runUntilBlocked(taskId)}
        />
      </section>

      <UnifiedComposer
        projects={projects}
        selectedProjectId={selectedProjectId}
        selectedTask={focusedRow?.task}
        detail={focusedDetail}
        resetToken={composerResetToken}
        onSubmit={(input) => void submitComposer(input)}
      />
    </main>
  );
}

function CommandBar({
  projects,
  selectedProjectId,
  query,
  metrics,
  loading,
  running,
  onSelectProject,
  onQuery,
  onRefresh,
  onRunQueue,
  onDaemonTick
}: {
  projects: Project[];
  selectedProjectId: string;
  query: string;
  metrics: { total: number; running: number; needsMe: number; attention: number; done: number };
  loading: boolean;
  running: boolean;
  onSelectProject: (projectId: string) => void;
  onQuery: (query: string) => void;
  onRefresh: () => void;
  onRunQueue: () => void;
  onDaemonTick: () => void;
}) {
  return (
    <header className="command-bar">
      <div className="wordmark">
        <span>coordinator</span>
        <strong>Run Matrix</strong>
      </div>
      <label className="toolbar-field">
        <span>Project</span>
        <select value={selectedProjectId} onChange={(event) => onSelectProject(event.target.value)} aria-label="Filter project">
          <option value="all">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="toolbar-field search-field">
        <span>Search</span>
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="task / project / status" />
      </label>
      <div className="metric-strip" aria-label="Queue summary">
        <Metric label="Tasks" value={metrics.total} />
        <Metric label="Running" value={metrics.running} tone="running" />
        <Metric label="Needs me" value={metrics.needsMe} tone="waiting" />
        <Metric label="Attention" value={metrics.attention} tone="attention" />
        <Metric label="Done" value={metrics.done} tone="done" />
      </div>
      <div className="toolbar-actions">
        <button type="button" onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
        <button type="button" onClick={onRunQueue} disabled={running}>
          Run queue
        </button>
        <button type="button" onClick={onDaemonTick} disabled={running}>
          Tick
        </button>
      </div>
    </header>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RunMatrix({
  rows,
  selectedTaskId,
  onFocusTask,
  onOpenDebug
}: {
  rows: RunMatrixRow[];
  selectedTaskId?: string;
  onFocusTask: (taskId: string) => void;
  onOpenDebug: (taskId: string) => void;
}) {
  return (
    <section className="run-matrix" aria-label="Run Matrix">
      <div className="matrix-head">
        <span>Task</span>
        <span>Coordinator</span>
        <span>Workflow</span>
        <span>Owner</span>
        <span>Status</span>
        <span>Action</span>
      </div>
      <div className="matrix-body">
        {rows.length === 0 ? <p className="empty-state">No tasks match the current filters.</p> : null}
        {rows.map((row) => (
          <article
            key={row.task.id}
            className={selectedTaskId === row.task.id ? `matrix-row selected ${row.pin}` : `matrix-row ${row.pin}`}
            data-task-id={row.dataTaskId}
            aria-label={row.ariaLabel}
          >
            <div className="task-cell">
              <StatusPin pin={row.pin} />
              <span>
                <strong>{row.task.title}</strong>
                <small>
                  {row.task.projectName} / {row.task.status} / {row.task.autonomy}
                </small>
              </span>
            </div>
            <Rail nodes={row.outerRail} label="Outer lifecycle rail" />
            <WorkflowRail row={row} />
            <div className="owner-cell">
              <strong>{row.nextOwner}</strong>
              <small>{row.agentSummary}</small>
            </div>
            <div className="state-cell">
              <strong>{formatRelativeTime(row.task.updatedAt)}</strong>
              <small>{row.blocker}</small>
            </div>
            <div className="row-actions">
              <button type="button" aria-label={`Focus task ${row.task.title}`} onClick={() => onFocusTask(row.task.id)}>
                Focus
              </button>
              <button type="button" className="ghost-button" aria-label={`Open Debug Detail for task ${row.task.title}`} onClick={() => onOpenDebug(row.task.id)}>
                Debug
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatusPin({ pin }: { pin: RunMatrixRow["pin"] }) {
  return <span className={`status-pin ${pin}`} aria-label={pin} />;
}

function Rail({ nodes, label }: { nodes: RailNode[]; label: string }) {
  return (
    <div className="rail" aria-label={label}>
      {nodes.map((node) => (
        <span key={node.id} className={`rail-node ${node.tone}`} title={`${node.label}: ${node.summary}`}>
          <span />
          <small>{node.label}</small>
        </span>
      ))}
    </div>
  );
}

function WorkflowRail({ row }: { row: RunMatrixRow }) {
  return (
    <div className="workflow-cell">
      <Rail nodes={row.workflowRail} label="Workflow stage rail" />
      <span className="stage-chip">
        {row.workflow.stage} / {row.workflow.substate}
      </span>
    </div>
  );
}

function FocusDrawer({
  row,
  detail,
  inbox,
  debugOpen,
  onDebugOpenChange,
  onWorkflowAction,
  onDecideMerge,
  onMerge,
  onTaskControl,
  onRunTask
}: {
  row?: RunMatrixRow;
  detail?: TaskDetail;
  inbox: GateItem[];
  debugOpen: boolean;
  onDebugOpenChange: (open: boolean) => void;
  onWorkflowAction: (input: WorkflowActionSubmitInput) => Promise<void>;
  onDecideMerge: (pr: PullRequest, request: HumanRequest, decision: "approve" | "reject") => void;
  onMerge: (pr: PullRequest) => void;
  onTaskControl: (action: "pause" | "resume" | "cancel" | "retry") => void;
  onRunTask: (taskId: string) => void;
}) {
  if (!row || !detail) {
    return (
      <aside className="focus-drawer empty" aria-label="Focus Drawer">
        <span>Focus Drawer</span>
        <strong>Select a task</strong>
      </aside>
    );
  }

  const artifacts = collectArtifactRefs(detail, row.workflow).slice(0, 8);
  return (
    <aside className="focus-drawer" aria-label="Focus Drawer">
      <header className="drawer-head">
        <span>{detail.project.name}</span>
        <h2>{detail.task.title}</h2>
        <p>{detail.currentBlocker}</p>
      </header>

      <section className="drawer-band">
        <Fact label="Status" value={detail.task.status} />
        <Fact label="Owner" value={row.nextOwner} />
        <Fact label="Mode" value={row.workflow.observation.mode} />
      </section>

      <GatePanel
        detail={detail}
        row={row}
        inbox={inbox}
        onWorkflowAction={onWorkflowAction}
        onDecideMerge={onDecideMerge}
        onMerge={onMerge}
      />

      <section className="drawer-actions" aria-label="Task actions">
        <button type="button" onClick={() => onRunTask(detail.task.id)}>
          Run task
        </button>
        <button type="button" onClick={() => onTaskControl("pause")} disabled={isTerminalTaskStatus(detail.task.status) || detail.task.status === "paused"}>
          Pause
        </button>
        <button type="button" onClick={() => onTaskControl("resume")} disabled={detail.task.status !== "paused"}>
          Resume
        </button>
        <button type="button" onClick={() => onTaskControl("retry")} disabled={isTerminalTaskStatus(detail.task.status)}>
          Retry
        </button>
      </section>

      <WorkflowLens workflow={row.workflow} />
      <AgentActivity detail={detail} />
      <AttachmentShelf attachments={detail.attachments} />
      <EvidenceShelf artifacts={artifacts} />
      <DebugDetail detail={detail} open={debugOpen} onOpenChange={onDebugOpenChange} />
    </aside>
  );
}

function GatePanel({
  detail,
  row,
  inbox,
  onWorkflowAction,
  onDecideMerge,
  onMerge
}: {
  detail: TaskDetail;
  row: RunMatrixRow;
  inbox: GateItem[];
  onWorkflowAction: (input: WorkflowActionSubmitInput) => Promise<void>;
  onDecideMerge: (pr: PullRequest, request: HumanRequest, decision: "approve" | "reject") => void;
  onMerge: (pr: PullRequest) => void;
}) {
  const humanRequestByGateId = new Map(detail.humanRequests.map((request) => [`human-${request.id}`, request]));
  const mergeRequestByGateId = new Map(detail.humanRequests.map((request) => [`merge-${request.id}`, request]));
  const pr = detail.latestPullRequest;

  return (
    <section className="gate-panel" aria-label="Needs me">
      <div className="section-label">
        <span>Needs me</span>
        <strong>{inbox.length}</strong>
      </div>
      {inbox.length === 0 ? <p className="muted">No operator gate.</p> : null}
      {inbox.map((item) => {
        // GatePanel 只按统一 projection 渲染，避免 count、pin 与 drawer card 各自分散判断。
        if (item.kind === "human") {
          const request = humanRequestByGateId.get(item.id);
          if (!request) return <StaticGateCard key={item.id} item={item} />;
          return <StaticGateCard key={item.id} item={item} />;
        }
        if (item.kind === "merge") {
          const request = mergeRequestByGateId.get(item.id);
          if (!request || !pr) return <StaticGateCard key={item.id} item={item} />;
          return (
            <article key={item.id} className="gate-card">
              <strong>{item.label}</strong>
              <small>{request.approvalValid === false ? item.summary : pr.title ?? pr.id}</small>
              <div className="button-row">
                <button type="button" onClick={() => onDecideMerge(pr, request, "approve")}>
                  Approve
                </button>
                <button type="button" onClick={() => onDecideMerge(pr, request, "reject")}>
                  Reject
                </button>
                <button type="button" onClick={() => onMerge(pr)}>
                  Merge
                </button>
              </div>
            </article>
          );
        }
        if (item.kind === "workflow") {
          return <WorkflowActionGate key={item.id} detail={detail} workflow={row.workflow} onWorkflowAction={onWorkflowAction} />;
        }
        if (item.kind === "pr") {
          return (
            <article key={item.id} className="gate-card">
              <strong>{item.label}</strong>
              <small>{pr?.reviewSummary ?? item.summary}</small>
            </article>
          );
        }
        return <StaticGateCard key={item.id} item={item} />;
      })}
    </section>
  );
}

function StaticGateCard({ item }: { item: GateItem }) {
  return (
    <article className={`gate-card ${item.kind === "attention" ? "attention" : ""}`}>
      <strong>{item.label}</strong>
      <small>{item.summary}</small>
    </article>
  );
}

function WorkflowActionGate({
  detail,
  workflow,
  onWorkflowAction
}: {
  detail: TaskDetail;
  workflow: WorkflowLensSummary;
  onWorkflowAction: (input: WorkflowActionSubmitInput) => Promise<void>;
}) {
  const run = detail.workflowRuns[0];
  const actions = workflow.gate.operatorActions;
  if (!run || run.status !== "running" || run.handoffKind || workflow.observation.mode !== "waiting-operator-gate" || actions.length === 0) return null;

  const hintByAction = new Map(workflow.projection.actionHints.map((hint) => [hint.actionId, hint]));
  return (
    <>
      {actions.map((actionId) => {
        const hint = hintByAction.get(actionId);
        const requiredArgs = hint?.requiredArgs ?? [];
        const unsupported = requiredArgs.length > 1;
        return (
          <form
            key={actionId}
            className="gate-card"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void onWorkflowAction({
                workflowRunId: run.id,
                expectedStateVersion: run.stateVersion,
                action: actionId,
                arg: requiredArgs.length === 1 ? String(form.get("workflowArg") ?? "").trim() : undefined
              });
            }}
          >
            <strong>{actionId}</strong>
            <small>{workflow.projection.progressSummary ?? workflow.inspectOnlyReason}</small>
            {requiredArgs.length === 1 ? <input name="workflowArg" placeholder={requiredArgs[0]} required /> : null}
            {unsupported ? <small>unsupported args in Web V2 shell</small> : null}
            <button type="submit" disabled={unsupported}>
              {workflowActionButtonLabel(actionId)}
            </button>
          </form>
        );
      })}
    </>
  );
}

function WorkflowLens({ workflow }: { workflow: WorkflowLensSummary }) {
  return (
    <section className="lens-panel">
      <div className="section-label">
        <span>Workflow Lens</span>
        <strong>{workflow.lifecycle}</strong>
      </div>
      <div className="lens-grid">
        <Fact label="Profile" value={workflow.profile} />
        <Fact label="Stage" value={workflow.stage} />
        <Fact label="Substate" value={workflow.substate} />
        <Fact label="Handoff" value={workflow.handoff} />
      </div>
      <p className="lens-note">{workflow.inspectOnlyReason}</p>
      <ChipList label="Operator gates" items={workflow.gate.operatorActions} />
      <ChipList label="Internal/debug" items={[...workflow.observation.agentInternalActions, ...workflow.observation.debugOnlyActions]} />
      <ChipList label="Denied" items={workflow.projection.deniedActions} />
      {workflow.projection.actionHints.length > 0 ? (
        <div className="hint-list">
          {workflow.projection.actionHints.map((hint) => (
            <span key={hint.actionId}>
              {hint.actionId}: {hint.requiredArgs.join(", ") || "no args"}
              {hint.usage ? ` / ${hint.usage}` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AgentActivity({ detail }: { detail: TaskDetail }) {
  const sessions = detail.agentSessions.slice(0, 3);
  return (
    <section className="mini-panel">
      <div className="section-label">
        <span>Agent</span>
        <strong>{sessions.length}</strong>
      </div>
      {sessions.length === 0 ? <p className="muted">No agent activity.</p> : null}
      {sessions.map((session) => (
        <article key={session.id} className="activity-row">
          <strong>{session.providerKind}</strong>
          <span>{session.activity?.state ?? session.status}</span>
          <small>{session.activity?.latestEvent?.summary ?? session.finalResponsePath ?? "no latest event"}</small>
        </article>
      ))}
    </section>
  );
}

function AttachmentShelf({ attachments }: { attachments: TaskAttachment[] }) {
  return (
    <section className="mini-panel attachment-shelf">
      <div className="section-label">
        <span>Attachments</span>
        <strong>{attachments.length}</strong>
      </div>
      {attachments.length === 0 ? <p className="muted">No local attachment refs.</p> : null}
      <ul className="attachment-list">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <strong>{attachment.safeFilename}</strong>
            <span>
              {attachment.mimeType} / {formatBytes(attachment.sizeBytes)}
            </span>
            <small>{attachment.artifactPath}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EvidenceShelf({ artifacts }: { artifacts: string[] }) {
  return (
    <section className="mini-panel">
      <div className="section-label">
        <span>Evidence</span>
        <strong>{artifacts.length}</strong>
      </div>
      {artifacts.length === 0 ? <p className="muted">No artifact refs.</p> : null}
      <ul className="artifact-list">
        {artifacts.map((artifact) => (
          <li key={artifact}>{artifact}</li>
        ))}
      </ul>
    </section>
  );
}

function DebugDetail({ detail, open, onOpenChange }: { detail: TaskDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <details className="debug-detail" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary>
        <span>Debug Detail</span>
        <strong>{detail.events.length} events</strong>
      </summary>
      <div className="debug-grid">
        <Fact label="Surface" value={detail.surface.surfaceKind} />
        <Fact label="Recommended" value={detail.surface.json.recommended_next_step} />
        <Fact label="Artifact root" value={detail.surface.json.artifact_root} />
        <Fact label="Operations" value={String(detail.diagnosis.operationLedger.length)} />
      </div>
      <ol className="timeline">
        {detail.events.slice(-10).map((event) => (
          <li key={event.id}>
            <strong>{event.type}</strong>
            <span>{event.summary}</span>
            <small>{event.createdAt}</small>
          </li>
        ))}
      </ol>
    </details>
  );
}

function UnifiedComposer({
  projects,
  selectedProjectId,
  selectedTask,
  detail,
  resetToken,
  onSubmit
}: {
  projects: Project[];
  selectedProjectId: string;
  selectedTask?: TaskListItem;
  detail?: TaskDetail;
  resetToken: number;
  onSubmit: (input: ComposerSubmitInput) => void;
}) {
  const projection = deriveUnifiedComposerProjection({ selectedTask, detail });
  const defaultProjectId =
    projection.mode === "new-task"
      ? selectedProjectId !== "all"
        ? selectedProjectId
        : projects[0]?.id ?? ""
      : selectedTask?.projectId ?? selectedProjectId;
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [autonomy, setAutonomy] = useState<ComposerSubmitInput["autonomy"]>("balanced");
  const [requestedWorkflowProfile, setRequestedWorkflowProfile] = useState("");
  const [file, setFile] = useState<File | undefined>();

  useEffect(() => {
    setProjectId(defaultProjectId);
    setTitle("");
    setBody("");
    setRequestedWorkflowProfile("");
    setFile(undefined);
  }, [defaultProjectId, projection.mode, projection.taskId, projection.humanRequest?.id, resetToken]);

  const canSubmit =
    projection.mode === "new-task"
      ? Boolean(projectId && title.trim())
      : projection.mode === "human-answer"
        ? Boolean(body.trim())
        : Boolean(body.trim() || file);

  return (
    <form
      className={`composer ${projection.mode}`}
      aria-label="Unified Composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          projection,
          projectId,
          title: title.trim() || body.trim().slice(0, 80) || "Untitled task",
          body,
          autonomy,
          requestedWorkflowProfile: requestedWorkflowProfile.trim() || undefined,
          file
        });
      }}
    >
      <div className="composer-mode">
        <span>{projection.mode}</span>
        <strong>{projection.title}</strong>
      </div>
      {projection.mode === "new-task" ? (
        <div className="composer-new-task">
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Task project" required>
            <option value="" disabled>
              Project
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task title" required />
          <select value={autonomy} onChange={(event) => setAutonomy(event.target.value as ComposerSubmitInput["autonomy"])} aria-label="Autonomy">
            <option value="balanced">balanced</option>
            <option value="conservative">conservative</option>
            <option value="aggressive">aggressive</option>
          </select>
          <input
            value={requestedWorkflowProfile}
            onChange={(event) => setRequestedWorkflowProfile(event.target.value)}
            placeholder="workflow profile"
          />
        </div>
      ) : null}
      <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={projection.placeholder} rows={2} />
      <label className="file-button">
        <input
          type="file"
          onChange={(event) => {
            const nextFile = event.target.files?.[0];
            setFile(nextFile);
          }}
        />
        <span>{file ? `${file.name} / ${formatBytes(file.size)}` : "Attach"}</span>
      </label>
      <button type="submit" disabled={!canSubmit}>
        {projection.submitLabel}
      </button>
    </form>
  );
}

function RunUntilBlockedBanner({ state }: { state: RunUntilBlockedState }) {
  const stopKind = state.running ? "running" : state.stop?.kind ?? "stopped";
  const stopLabel = state.running ? "Advancing queue" : state.stop?.label ?? "Stopped";
  return (
    <section className={`run-banner stop-${stopKind}`} aria-label="Run until blocked result">
      <div>
        <strong>{stopKind}</strong>
        <span>
          {state.scope}
          {state.taskId ? ` / ${state.taskId}` : ""} / {state.tickCount}/{state.maxTicks}
        </span>
      </div>
      <p>
        <b>{stopLabel}</b>
        <span>{state.stop?.summary ?? "advancing queue"}</span>
      </p>
      <div className="run-log">
        {state.logs.slice(-4).map((entry) => (
          <span key={entry.index}>
            #{entry.index} {entry.status} / {entry.actions.length} actions
          </span>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChipList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="chip-block">
      <span>{label}</span>
      <div>
        {items.length === 0 ? <small>none</small> : null}
        {items.map((item) => (
          <strong key={item}>{item}</strong>
        ))}
      </div>
    </div>
  );
}

async function uploadAttachment(taskId: string, file: File): Promise<void> {
  if (file.size > MAX_WEB_ATTACHMENT_BYTES) {
    throw new Error(`attachment exceeds ${formatBytes(MAX_WEB_ATTACHMENT_BYTES)}`);
  }
  const mimeType = inferMimeType(file);
  const contentBase64 = await readFileAsBase64(file);
  await request(`/tasks/${taskId}/attachments`, {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      contentBase64,
      actor: "web-operator"
    })
  });
}

function inferMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  const byExtension: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    txt: "text/plain",
    log: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
    json: "application/json",
    pdf: "application/pdf"
  };
  if (extension && byExtension[extension]) {
    return byExtension[extension];
  }
  throw new Error("unsupported attachment type");
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("failed to read attachment"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const marker = "base64,";
      const index = result.indexOf(marker);
      resolve(index >= 0 ? result.slice(index + marker.length) : result);
    };
    reader.readAsDataURL(file);
  });
}

async function hydrateTaskDetails(tasks: TaskListItem[]): Promise<Record<string, TaskDetail>> {
  const entries = await Promise.all(
    tasks.map(async (task) => {
      try {
        return [task.id, await request<TaskDetail>(`/tasks/${task.id}`)] as const;
      } catch {
        return undefined;
      }
    })
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, TaskDetail] => Boolean(entry)));
}

function formatRelativeTime(value: string | undefined): string {
  if (!value) return "unknown";
  const timestamp = Date.parse(value.replace(" ", "T"));
  if (!Number.isFinite(timestamp)) return value;
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
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
