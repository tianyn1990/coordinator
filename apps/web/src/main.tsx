import { StrictMode, useEffect, useMemo, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { workflowActionButtonLabel } from "./workflow-actions.js";
import {
  WEB_V2_DEBUG_DETAIL_DEFAULT_OPEN,
  buildRunMatrixRow,
  buildWorkbenchV2Model,
  collectArtifactRefs,
  isTerminalTaskStatus,
  type GateItem,
  type HumanRequest,
  type Project,
  type PullRequest,
  type RailNode,
  type RunMatrixRow,
  type TaskDetail,
  type TaskListItem,
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
  stopReason?: string;
};

type WorkflowActionSubmitInput = {
  workflowRunId: string;
  expectedStateVersion: number;
  action: string;
  arg?: string;
};

const apiBase = import.meta.env.VITE_COORDINATOR_API_BASE ?? "http://127.0.0.1:4310";
const RUN_UNTIL_BLOCKED_MAX_TICKS = 8;

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
        const stop = describeStopReason(currentDetail, tick, index, taskId ? "task" : "global");
        if (stop.stop) {
          setRunState({
            running: false,
            scope: taskId ? "task" : "global",
            taskId,
            tickCount: index,
            maxTicks: RUN_UNTIL_BLOCKED_MAX_TICKS,
            logs,
            stopReason: stop.reason
          });
          setFlash({ tone: "ok", message: stop.reason });
          return;
        }
      }
      const reason = `stopped: max ticks ${RUN_UNTIL_BLOCKED_MAX_TICKS}`;
      setRunState({
        running: false,
        scope: taskId ? "task" : "global",
        taskId,
        tickCount: logs.length,
        maxTicks: RUN_UNTIL_BLOCKED_MAX_TICKS,
        logs,
        stopReason: reason
      });
      setFlash({ tone: "ok", message: reason });
    } catch (error) {
      const reason = `stopped: ${error instanceof Error ? error.message : String(error)}`;
      setRunState({
        running: false,
        scope: taskId ? "task" : "global",
        taskId,
        tickCount: logs.length,
        maxTicks: RUN_UNTIL_BLOCKED_MAX_TICKS,
        logs,
        stopReason: reason
      });
      setFlash({ tone: "error", message: reason });
    }
  }

  async function answerHumanRequest(event: FormEvent<HTMLFormElement>, requestItem: HumanRequest) {
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
      setFlash({ tone: "ok", message: "human answer recorded" });
      await refresh(focusedTaskId);
    } catch (error) {
      setFlash({ tone: "error", message: error instanceof Error ? error.message : String(error) });
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
          onAnswer={answerHumanRequest}
          onWorkflowAction={submitWorkflowAction}
          onDecideMerge={decideMerge}
          onMerge={mergeAfterApproval}
          onTaskControl={(action) => void controlTask(action)}
          onRunTask={(taskId) => void runUntilBlocked(taskId)}
        />
      </section>

      <UnifiedComposerPlaceholder selectedTask={focusedRow?.task} />
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
  onAnswer,
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
  onAnswer: (event: FormEvent<HTMLFormElement>, request: HumanRequest) => void;
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
        onAnswer={onAnswer}
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
      <AttachmentShelf />
      <EvidenceShelf artifacts={artifacts} />
      <DebugDetail detail={detail} open={debugOpen} onOpenChange={onDebugOpenChange} />
    </aside>
  );
}

function GatePanel({
  detail,
  row,
  inbox,
  onAnswer,
  onWorkflowAction,
  onDecideMerge,
  onMerge
}: {
  detail: TaskDetail;
  row: RunMatrixRow;
  inbox: GateItem[];
  onAnswer: (event: FormEvent<HTMLFormElement>, request: HumanRequest) => void;
  onWorkflowAction: (input: WorkflowActionSubmitInput) => Promise<void>;
  onDecideMerge: (pr: PullRequest, request: HumanRequest, decision: "approve" | "reject") => void;
  onMerge: (pr: PullRequest) => void;
}) {
  const pendingHuman = detail.humanRequests.filter((request) => request.status === "pending" && request.kind !== "merge_approval");
  const pendingMerge = detail.humanRequests.find((request) => request.status === "pending" && request.kind === "merge_approval");
  const pr = detail.latestPullRequest;

  return (
    <section className="gate-panel" aria-label="Needs me">
      <div className="section-label">
        <span>Needs me</span>
        <strong>{inbox.length}</strong>
      </div>
      {inbox.length === 0 ? <p className="muted">No operator gate.</p> : null}
      {pendingHuman.map((request) => (
        <form key={request.id} className="gate-card" onSubmit={(event) => onAnswer(event, request)}>
          <strong>Human request</strong>
          <small>{request.questionArtifactPath ?? request.blockedKey}</small>
          <textarea name="answer" rows={3} placeholder="answer" required />
          <input name="answeredBy" defaultValue="web-operator" />
          <button type="submit">Send answer</button>
        </form>
      ))}
      {pendingMerge && pr ? (
        <article className="gate-card">
          <strong>Merge approval</strong>
          <small>{pendingMerge.approvalValid === false ? "snapshot invalid" : pr.title ?? pr.id}</small>
          <div className="button-row">
            <button type="button" onClick={() => onDecideMerge(pr, pendingMerge, "approve")}>
              Approve
            </button>
            <button type="button" onClick={() => onDecideMerge(pr, pendingMerge, "reject")}>
              Reject
            </button>
            <button type="button" onClick={() => onMerge(pr)}>
              Merge
            </button>
          </div>
        </article>
      ) : null}
      <WorkflowActionGate detail={detail} workflow={row.workflow} onWorkflowAction={onWorkflowAction} />
      {detail.diagnosis.operatorAttention.required ? (
        <article className="gate-card attention">
          <strong>Operator attention</strong>
          <small>{detail.diagnosis.operatorAttention.reasons[0] ?? detail.currentBlocker}</small>
        </article>
      ) : null}
    </section>
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

function AttachmentShelf() {
  return (
    <section className="mini-panel attachment-shelf">
      <div className="section-label">
        <span>Attachments</span>
        <strong>local</strong>
      </div>
      <div className="attachment-well">
        <span>Reserved drop zone</span>
      </div>
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

function UnifiedComposerPlaceholder({ selectedTask }: { selectedTask?: TaskListItem }) {
  return (
    <section className="composer" aria-label="Unified Composer">
      <div>
        <span>Composer</span>
        <strong>{selectedTask ? selectedTask.title : "New task"}</strong>
      </div>
      <textarea placeholder="Unified input and local attachments land in a later slice" disabled />
      <button type="button" disabled>
        Attach
      </button>
      <button type="button" disabled>
        Send
      </button>
    </section>
  );
}

function RunUntilBlockedBanner({ state }: { state: RunUntilBlockedState }) {
  return (
    <section className="run-banner" aria-label="Run until blocked result">
      <div>
        <strong>{state.running ? "running" : "stopped"}</strong>
        <span>
          {state.scope}
          {state.taskId ? ` / ${state.taskId}` : ""} / {state.tickCount}/{state.maxTicks}
        </span>
      </div>
      <p>{state.stopReason ?? "advancing queue"}</p>
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

function describeStopReason(
  detail: TaskDetail | undefined,
  tick: DaemonTickResult,
  tickIndex: number,
  scope: "global" | "task"
): { stop: boolean; reason: string } {
  if (scope === "global") {
    if (tick.status === "failed") return { stop: true, reason: "global daemon tick failed" };
    if (tick.actions.length === 0) return { stop: true, reason: "global queue has no safe action" };
    if (tickIndex >= RUN_UNTIL_BLOCKED_MAX_TICKS) return { stop: true, reason: "max ticks reached" };
    return { stop: false, reason: "continue" };
  }
  if (!detail) return { stop: true, reason: "task detail unavailable" };
  const row = buildRunMatrixRow(detail.task, detail);
  if (isTerminalTaskStatus(detail.task.status)) return { stop: true, reason: `terminal: ${detail.task.status}` };
  if (detail.diagnosis.operatorAttention.required) return { stop: true, reason: `operator attention: ${detail.diagnosis.operatorAttention.reasons[0] ?? detail.currentBlocker}` };
  if (detail.humanRequests.some((request) => request.status === "pending")) return { stop: true, reason: "pending human or merge request" };
  if (row.workflow.gate.hasOperatorGate) return { stop: true, reason: `operator workflow gate: ${row.workflow.gate.operatorActions.join(", ")}` };
  if (detail.workflowRuns[0]?.status === "running" && !detail.workflowRuns[0]?.handoffKind) {
    // workflow runtime 活跃时 Web 只观察，不把 internal action 解释成需要开发者手动决策。
    return { stop: true, reason: "observing workflow runtime; waiting for inner agent or handoff" };
  }
  if (tick.status === "failed") return { stop: true, reason: "daemon tick failed" };
  if (tickIndex >= RUN_UNTIL_BLOCKED_MAX_TICKS) return { stop: true, reason: "max ticks reached" };
  return { stop: false, reason: "continue" };
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
