import { randomUUID } from "node:crypto";
import { getProject, getTask, type DbContext, type ProjectRecord, type TaskRecord } from "@coordinator/db";

export type SurfaceKind =
  | "bootstrap"
  | "planning"
  | "execution"
  | "human_waiting"
  | "human_answered"
  | "review"
  | "merge_waiting"
  | "completed"
  | "failure"
  | "resume";

export type SurfaceSnapshot = {
  surfaceKind: SurfaceKind;
  task: TaskSnapshot;
  project: ProjectSnapshot;
  attempt?: EntitySnapshot;
  currentState: CurrentStateSnapshot;
  executionPlan?: ExecutionPlanSnapshot;
  workspace?: WorkspaceSnapshot;
  workflowRuns: WorkflowRunSnapshot[];
  agentSessions: AgentSessionSnapshot[];
  pullRequest?: PullRequestSnapshot;
  mergeApproval?: MergeApprovalSnapshot;
  noPrCompletion?: NoPrCompletionSnapshot;
  humanRequests: HumanRequestSnapshot[];
  autonomyGuidance?: AutonomyGuidanceSnapshot;
  memoryTrustBoundary?: MemoryTrustBoundarySnapshot;
  validationContract?: ValidationContractSnapshot;
  artifactRoot: string;
  createdAt: string;
};

export type SurfaceEnvelope = {
  surfaceId: string;
  surfaceKind: SurfaceKind;
  json: CoordinatorSurfaceJson;
  markdown: string;
};

export type CoordinatorSurfaceJson = {
  surface_id: string;
  surface_kind: SurfaceKind;
  task: TaskSurfaceJson;
  project: ProjectSurfaceJson;
  attempt: EntitySnapshotJson | null;
  current_state: CurrentStateJson;
  execution_plan: ExecutionPlanSnapshotJson | null;
  workspace: WorkspaceSnapshotJson | null;
  workflow_runs: WorkflowRunSnapshotJson[];
  agent_sessions: AgentSessionSnapshotJson[];
  pull_request: PullRequestSnapshotJson | null;
  merge_approval: MergeApprovalSnapshotJson | null;
  no_pr_completion: NoPrCompletionSnapshotJson | null;
  human_requests: HumanRequestSnapshotJson[];
  autonomy_guidance: AutonomyGuidanceSnapshotJson | null;
  denied_actions: string[];
  recommended_next_step: string;
  recovery: string;
  available_tools: SurfaceToolJson[];
  memory_trust_boundary: MemoryTrustBoundarySurfaceJson | null;
  validation_contract: ValidationContractSnapshotJson | null;
  artifact_root: string;
  created_at: string;
};

export type SurfaceToolJson = {
  name: string;
  usage: string;
  args: string[];
  side_effect: boolean;
  success_state: string;
  recovery: string;
};

export type EntitySnapshot = {
  id: string;
  status: string;
  summary?: string;
};

type EntitySnapshotJson = EntitySnapshot;

export type TaskSnapshot = {
  id: string;
  title: string;
  description: string;
  autonomy: string;
  sourceKind: string;
  status: string;
  stateVersion: number;
};

type TaskSurfaceJson = {
  id: string;
  title: string;
  description: string;
  autonomy: string;
  source_kind: string;
  status: string;
  state_version: number;
};

export type ProjectSnapshot = {
  id: string;
  name: string;
  repoPath?: string;
  repoUrl?: string;
  gitProviderKind?: string;
  defaultBranch?: string;
  workflowLauncher?: string;
  outerAgentDefaultProvider?: string;
  innerAgentDefaultProvider?: string;
  registrationStatus?: string;
};

type ProjectSurfaceJson = {
  id: string;
  name: string;
  repo_path?: string;
  repo_url?: string;
  git_provider_kind?: string;
  default_branch?: string;
  workflow_launcher?: string;
  outer_agent_default_provider?: string;
  inner_agent_default_provider?: string;
  registration_status?: string;
};

export type CurrentStateSnapshot = {
  taskStatus: string;
  attemptStatus?: string;
  workflowRunStatus?: string;
  pullRequestStatus?: string;
  humanRequestStatus?: string;
  blocker?: string;
};

type CurrentStateJson = {
  task_status: string;
  attempt_status?: string;
  workflow_run_status?: string;
  pull_request_status?: string;
  human_request_status?: string;
  blocker?: string;
};

export type ExecutionPlanSnapshot = {
  id?: string;
  status?: string;
  artifactPath?: string;
  steps?: Array<{ order: number; title: string; status: string; evidenceArtifactPath?: string }>;
};

type ExecutionPlanSnapshotJson = {
  id?: string;
  status?: string;
  artifact_path?: string;
  steps?: Array<{ order: number; title: string; status: string; evidence_artifact_path?: string }>;
};

export type WorkspaceSnapshot = {
  id?: string;
  status?: string;
  path?: string;
  branch?: string;
  baseBranch?: string;
};

type WorkspaceSnapshotJson = {
  id?: string;
  status?: string;
  path?: string;
  branch?: string;
  base_branch?: string;
};

export type WorkflowRunSnapshot = {
  id?: string;
  profileId?: string;
  status?: string;
  handoffKind?: string;
};

type WorkflowRunSnapshotJson = {
  id?: string;
  profile_id?: string;
  status?: string;
  handoff_kind?: string;
};

export type AgentSessionSnapshot = {
  id?: string;
  providerKind?: string;
  role?: string;
  status?: string;
};

type AgentSessionSnapshotJson = {
  id?: string;
  provider_kind?: string;
  role?: string;
  status?: string;
};

export type PullRequestSnapshot = {
  id?: string;
  providerKind?: string;
  status?: string;
  headBranch?: string;
  baseBranch?: string;
  headSha?: string;
  baseSha?: string;
  url?: string;
};

type PullRequestSnapshotJson = {
  id?: string;
  provider_kind?: string;
  status?: string;
  head_branch?: string;
  base_branch?: string;
  head_sha?: string;
  base_sha?: string;
  url?: string;
};

export type MergeApprovalSnapshot = {
  prId: string;
  status: "approved" | "pending" | "rejected";
  valid: boolean;
  headSha?: string;
  baseSha?: string;
  validationRunId?: string;
  mergeStrategy?: string;
  approvedBy?: string;
  approvedAt?: string;
};

type MergeApprovalSnapshotJson = {
  pr_id: string;
  status: "approved" | "pending" | "rejected";
  valid: boolean;
  head_sha?: string;
  base_sha?: string;
  validation_run_id?: string;
  merge_strategy?: string;
  approved_by?: string;
  approved_at?: string;
};

export type NoPrCompletionSnapshot = {
  policyValid: boolean;
  evidenceArtifactPath?: string;
};

type NoPrCompletionSnapshotJson = {
  policy_valid: boolean;
  evidence_artifact_path?: string;
};

export type HumanRequestSnapshot = {
  id?: string;
  kind: string;
  status: string;
  blockedKey?: string;
  questionArtifactPath?: string;
  answerArtifactPath?: string;
};

type HumanRequestSnapshotJson = {
  id?: string;
  kind: string;
  status: string;
  blocked_key?: string;
  question_artifact_path?: string;
  answer_artifact_path?: string;
};

export type AutonomyGuidanceSnapshot = {
  level: "conservative" | "balanced" | "aggressive";
};

type AutonomyGuidanceSnapshotJson = AutonomyGuidanceSnapshot;

export type MemoryTrustBoundarySnapshot = {
  attemptLocal: string;
  projectLocal: string;
  crossProject: string;
};

type MemoryTrustBoundarySurfaceJson = {
  attempt_local: string;
  project_local: string;
  cross_project: string;
};

export type ValidationContractSnapshot = {
  artifactPath?: string;
  status?: string;
  latestValidation?: string;
};

type ValidationContractSnapshotJson = {
  artifact_path?: string;
  status?: string;
  latest_validation?: string;
};

export function buildCoordinatorSurface(snapshot: SurfaceSnapshot): SurfaceEnvelope {
  const surfaceId = randomUUID();
  const availableTools = deriveVisibleTools(snapshot);
  const deniedActions = deriveDeniedActions(snapshot);
  const autonomyGuidance = snapshot.autonomyGuidance ? renderAutonomyGuidance(snapshot.autonomyGuidance.level) : null;
  const recommendedNextStep = deriveRecommendedNextStep(snapshot);
  const recovery = deriveRecovery(snapshot);

  const json: CoordinatorSurfaceJson = {
    surface_id: surfaceId,
    surface_kind: snapshot.surfaceKind,
    task: {
      id: snapshot.task.id,
      title: snapshot.task.title,
      description: snapshot.task.description,
      autonomy: snapshot.task.autonomy,
      source_kind: snapshot.task.sourceKind,
      status: snapshot.task.status,
      state_version: snapshot.task.stateVersion
    },
    project: toProjectJson(snapshot.project),
    attempt: snapshot.attempt ? { ...snapshot.attempt } : null,
    current_state: toCurrentStateJson(snapshot.currentState),
    execution_plan: snapshot.executionPlan ? toExecutionPlanJson(snapshot.executionPlan) : null,
    workspace: snapshot.workspace ? toWorkspaceJson(snapshot.workspace) : null,
    workflow_runs: snapshot.workflowRuns.map(toWorkflowRunJson),
    agent_sessions: snapshot.agentSessions.map(toAgentSessionJson),
    pull_request: snapshot.pullRequest ? toPullRequestJson(snapshot.pullRequest) : null,
    merge_approval: snapshot.mergeApproval ? toMergeApprovalJson(snapshot.mergeApproval) : null,
    no_pr_completion: snapshot.noPrCompletion ? toNoPrCompletionJson(snapshot.noPrCompletion) : null,
    human_requests: snapshot.humanRequests.map(toHumanRequestJson),
    autonomy_guidance: autonomyGuidance ? { level: snapshot.autonomyGuidance!.level } : null,
    denied_actions: deniedActions,
    recommended_next_step: recommendedNextStep,
    recovery,
    available_tools: availableTools,
    memory_trust_boundary: snapshot.memoryTrustBoundary
      ? {
          attempt_local: snapshot.memoryTrustBoundary.attemptLocal,
          project_local: snapshot.memoryTrustBoundary.projectLocal,
          cross_project: snapshot.memoryTrustBoundary.crossProject
        }
      : null,
    validation_contract: snapshot.validationContract
      ? {
          artifact_path: snapshot.validationContract.artifactPath,
          status: snapshot.validationContract.status,
          latest_validation: snapshot.validationContract.latestValidation
        }
      : null,
    artifact_root: snapshot.artifactRoot,
    created_at: snapshot.createdAt
  };

  return {
    surfaceId,
    surfaceKind: snapshot.surfaceKind,
    json,
    markdown: renderSurfaceMarkdown(json, autonomyGuidance, availableTools, deniedActions, recovery)
  };
}

export function buildTaskSurfaceFromDb(context: DbContext, taskId: string): SurfaceEnvelope {
  const task = getTask(context, taskId);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }
  const project = getProject(context, task.projectId);
  if (!project) {
    throw new Error(`project not found: ${task.projectId}`);
  }
  const latestAttempt = findLatestAttemptForTask(context, task.id);
  const activeWorkspace = latestAttempt ? findActiveWorkspaceForAttempt(context, latestAttempt.id) : undefined;
  const activeWorkflowRun = latestAttempt ? findActiveWorkflowRunForAttempt(context, latestAttempt.id) : undefined;
  const recentAgentSessions = findRecentAgentSessionsForTask(context, task.id);

  return buildCoordinatorSurface({
    surfaceKind: deriveSurfaceKind(task),
    task: toTaskSnapshot(task),
    project: toProjectSnapshot(project),
    attempt: latestAttempt
      ? {
          id: latestAttempt.id,
          status: latestAttempt.status,
          summary: latestAttempt.reason
        }
      : undefined,
    currentState: {
      taskStatus: task.status,
      attemptStatus: latestAttempt?.status,
      workflowRunStatus: activeWorkflowRun?.status
    },
    workspace: activeWorkspace
      ? {
          id: activeWorkspace.id,
          status: activeWorkspace.status,
          path: activeWorkspace.workspace_path ?? undefined,
          branch: activeWorkspace.branch ?? undefined,
          baseBranch: activeWorkspace.base_branch ?? undefined
        }
      : undefined,
    workflowRuns: activeWorkflowRun
      ? [
          {
            id: activeWorkflowRun.id,
            profileId: activeWorkflowRun.profile_id,
            status: activeWorkflowRun.status,
            handoffKind: activeWorkflowRun.handoff_kind ?? undefined
          }
        ]
      : [],
    agentSessions: recentAgentSessions.map((session) => ({
      id: session.id,
      providerKind: session.provider_kind,
      role: session.role,
      status: session.status
    })),
    humanRequests: [],
    autonomyGuidance: {
      level: normalizeAutonomy(task.autonomy)
    },
    memoryTrustBoundary: {
      attemptLocal: "同 attempt 内的信息可以默认进入当前 surface。",
      projectLocal: "project-local 记忆必须由 surface 显式暴露。",
      crossProject: "cross-project 记忆默认禁止。"
    },
    validationContract: {
      status: "not_ready",
      latestValidation: "当前没有可用验证契约；进入 review/merge 前必须显式生成。"
    },
    artifactRoot: activeWorkspace?.workspace_path
      ? `${activeWorkspace.workspace_path}/coordinator/artifacts/`
      : "coordinator/artifacts/",
    createdAt: new Date().toISOString()
  });
}

export function renderSurfaceMarkdown(
  json: CoordinatorSurfaceJson,
  autonomyGuidanceText: string | null,
  availableTools: SurfaceToolJson[],
  deniedActions: string[],
  recovery: string
): string {
  const lines: string[] = [];
  lines.push(`# Coordinator Surface`);
  lines.push(``);
  lines.push(`- surface_id: ${json.surface_id}`);
  lines.push(`- surface_kind: ${json.surface_kind}`);
  lines.push(`- recommended_next_step: ${json.recommended_next_step}`);
  lines.push(`- artifact_root: ${json.artifact_root}`);
  lines.push(`- artifact_path_rule: agent tools 只接受相对此 root 的相对路径，禁止绝对路径、../ 和 symlink escape。`);
  lines.push(``);
  lines.push(`## Task`);
  lines.push(`- title: ${json.task.title}`);
  if (json.task.description) {
    lines.push(`- description: ${json.task.description}`);
  }
  lines.push(`- status: ${json.task.status}`);
  lines.push(`- autonomy: ${json.task.autonomy}`);
  lines.push(`- source_kind: ${json.task.source_kind}`);
  lines.push(``);
  lines.push(`## Project`);
  lines.push(`- name: ${json.project.name}`);
  if (json.project.default_branch) lines.push(`- default_branch: ${json.project.default_branch}`);
  if (json.project.workflow_launcher) lines.push(`- workflow_launcher: ${json.project.workflow_launcher}`);
  if (json.project.outer_agent_default_provider) lines.push(`- outer_agent_default_provider: ${json.project.outer_agent_default_provider}`);
  if (json.project.inner_agent_default_provider) lines.push(`- inner_agent_default_provider: ${json.project.inner_agent_default_provider}`);
  lines.push(``);
  lines.push(`## Current State`);
  lines.push(`- task_status: ${json.current_state.task_status}`);
  if (json.attempt) {
    lines.push(`- attempt: ${json.attempt.id} (${json.attempt.status})`);
  } else {
    lines.push(`- attempt: 当前尚未创建 attempt。`);
  }
  if (json.workspace) {
    lines.push(`- workspace: ${json.workspace.id ?? "unknown"} (${json.workspace.status ?? "unknown"})`);
    if (json.workspace.path) lines.push(`- workspace_path: ${json.workspace.path}`);
    if (json.workspace.branch) lines.push(`- workspace_branch: ${json.workspace.branch}`);
  } else {
    lines.push(`- workspace: 当前 surface 未发现 active workspace；如需执行代码工作，应先通过受控工具创建 workspace。`);
  }
  if (json.workflow_runs.length > 0) {
    for (const run of json.workflow_runs) {
      lines.push(`- workflow_run: ${run.id ?? "unknown"} profile=${run.profile_id ?? "unknown"} status=${run.status ?? "unknown"} handoff=${run.handoff_kind ?? "none"}`);
    }
  } else {
    lines.push(`- workflow_run: 当前 surface 未发现 active workflow run。`);
  }
  if (json.agent_sessions.length > 0) {
    for (const session of json.agent_sessions) {
      lines.push(`- agent_session: ${session.id ?? "unknown"} provider=${session.provider_kind ?? "unknown"} role=${session.role ?? "unknown"} status=${session.status ?? "unknown"}`);
    }
  } else {
    lines.push(`- agent_session: 当前没有 recent agent session。`);
  }
  lines.push(``);
  if (json.merge_approval) {
    lines.push(`## Merge Approval`);
    lines.push(`- pr_id: ${json.merge_approval.pr_id}`);
    lines.push(`- status: ${json.merge_approval.status}`);
    lines.push(`- valid: ${json.merge_approval.valid ? "true" : "false"}`);
    if (json.merge_approval.validation_run_id) {
      lines.push(`- validation_run_id: ${json.merge_approval.validation_run_id}`);
    }
    if (json.merge_approval.merge_strategy) {
      lines.push(`- merge_strategy: ${json.merge_approval.merge_strategy}`);
    }
    lines.push(``);
  }
  lines.push(`## Autonomy Guidance`);
  lines.push(autonomyGuidanceText ?? `当前没有可用 autonomy guidance。`);
  lines.push(``);
  lines.push(`## Available Tools`);
  for (const tool of availableTools) {
    lines.push(`- ${tool.name}: ${tool.usage} | args: ${tool.args.join(", ")} | side_effect: ${tool.side_effect ? "yes" : "no"}`);
  }
  lines.push(``);
  lines.push(`## Denied Actions`);
  for (const denied of deniedActions) {
    lines.push(`- ${denied}`);
  }
  lines.push(``);
  lines.push(`## Recovery`);
  lines.push(recovery);
  lines.push(``);
  lines.push(`## Memory Trust Boundary`);
  lines.push(json.memory_trust_boundary ? `- attempt_local: ${json.memory_trust_boundary.attempt_local}\n- project_local: ${json.memory_trust_boundary.project_local}\n- cross_project: ${json.memory_trust_boundary.cross_project}` : `- attempt_local: 当前未显式声明`);
  lines.push(`- hidden_memory: 不存在 hidden memory；只有当前 surface 明确暴露的 memory artifact 可用。`);
  if (json.validation_contract) {
    lines.push(``);
    lines.push(`## Validation Contract`);
    lines.push(`- status: ${json.validation_contract.status ?? "unknown"}`);
    if (json.validation_contract.latest_validation) {
      lines.push(`- latest_validation: ${json.validation_contract.latest_validation}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function deriveVisibleTools(snapshot: SurfaceSnapshot): SurfaceToolJson[] {
  const humanPending = snapshot.surfaceKind === "human_waiting" || snapshot.humanRequests.some((request) => request.status === "pending");
  if (humanPending) {
    return [
      inspectTool("inspect_workflow_run", "查看 workflow run 状态，判断等待原因。")
    ];
  }

  if (snapshot.surfaceKind === "completed" || snapshot.surfaceKind === "failure") {
    return [inspectTool("inspect_workflow_run", "查看历史 workflow 结果。")];
  }

  if (snapshot.surfaceKind === "merge_waiting") {
    return hasValidMergeApproval(snapshot)
      ? [
          tool("inspect_review", "查看 review 结果和验证信息。"),
          tool("merge_after_approval", "在 approval snapshot 有效时执行 merge。")
        ]
      : [
          tool("request_merge_approval", "生成 merge approval 请求。"),
          tool("inspect_review", "查看 review 结果和验证信息。")
        ];
  }

  if (snapshot.surfaceKind === "review" && isReviewFeedback(snapshot)) {
    return [
      tool("start_rework", "根据 review feedback 进入 rework。"),
      tool("revise_execution_plan", "在计划需要调整时更新 execution plan。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }

  if (hasOpenPullRequest(snapshot)) {
    return [
      tool("inspect_review", "查看 review 结果和验证信息。"),
      tool("update_pr", "更新 PR/MR body 或 metadata。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }

  if (!snapshot.executionPlan) {
    return [
      tool("write_execution_plan", "把当前计划写入 artifact 并持久化为外层计划。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }

  if (!snapshot.attempt) {
    return [
      tool("create_attempt", "创建新的 attempt 以承接当前执行计划。"),
      tool("revise_execution_plan", "在计划需要调整时更新 execution plan。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }

  if (!snapshot.workspace) {
    return [
      tool("create_workspace", "为当前 attempt 创建隔离 workspace。"),
      tool("revise_execution_plan", "在计划需要调整时更新 execution plan。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }

  if (snapshot.workflowRuns.some((run) => run.status === "running" || run.status === "blocked" || run.status === "planned")) {
    return [
      tool("inspect_workflow_run", "查看 workflow run 状态。"),
      tool("resume_workflow_run", "在 workflow 可恢复时继续已有 run。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }

  const handoffRun = snapshot.workflowRuns.find((run) => run.handoffKind);
  if (handoffRun?.handoffKind === "pr_ready") {
    return [
      tool("create_pr", "基于 workflow handoff artifact 创建 PR/MR。"),
      tool("revise_execution_plan", "在计划需要调整时更新 execution plan。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }
  if (handoffRun?.handoffKind === "manual_handoff" || handoffRun?.handoffKind === "blocked") {
    return [
      tool("handoff_to_human", "将当前任务交给人类接手。"),
      tool("ask_human", "在信息不足时向人类提问。"),
      tool("revise_execution_plan", "在计划需要调整时更新 execution plan。")
    ];
  }
  if (handoffRun?.handoffKind === "human_review_required") {
    return [
      tool("ask_human", "在需要 review 决策时向人类提问。"),
      tool("revise_execution_plan", "在计划需要调整时更新 execution plan。")
    ];
  }
  if (handoffRun?.handoffKind === "completed_no_pr") {
    return hasValidNoPrCompletion(snapshot)
      ? [tool("mark_done", "在 no-PR policy 和 evidence artifact 有效时标记完成。")]
      : [tool("ask_human", "no-PR completion 缺少有效 policy 或 evidence artifact，需要人类确认。")];
  }

  if (snapshot.workspace.status === "ready" || snapshot.workspace.status === "dirty") {
    return [
      tool("start_workflow_run", "在当前 workspace 中启动 workflow run。"),
      tool("revise_execution_plan", "在计划需要调整时更新 execution plan。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }

  return [
    inspectTool("inspect_workflow_run", "查看 workflow run 状态。"),
    tool("ask_human", "在信息不足时向人类提问。")
  ];
}

function deriveDeniedActions(snapshot: SurfaceSnapshot): string[] {
  const denied = [
    "不要绕过 workflow protocol。",
    "不要直接编辑 workflow private state。",
    "不要把复杂计划通过工具 JSON 传递。",
    "不要直接读取未显式暴露的数据库字段。"
  ];
  if (snapshot.surfaceKind === "human_waiting" || snapshot.humanRequests.some((request) => request.status === "pending")) {
    denied.push("不要在 human request 等待中继续执行副作用操作。");
  }
  if (!snapshot.pullRequest || snapshot.pullRequest.status !== "open") {
    denied.push("不要在没有有效 PR/MR 时执行 merge。");
  }
  return denied;
}

function deriveRecommendedNextStep(snapshot: SurfaceSnapshot): string {
  if (snapshot.surfaceKind === "human_waiting" || snapshot.humanRequests.some((request) => request.status === "pending")) {
    return "等待 human request 被回答后再继续。";
  }
  if (snapshot.pullRequest && snapshot.pullRequest.status === "open") {
    return "根据 review 和 validation 决定是否请求 merge approval。";
  }
  if (!snapshot.executionPlan) {
    return "先生成 execution plan，并将其写入 artifact。";
  }
  if (!snapshot.workspace) {
    return "先创建 attempt 和 workspace，确保执行环境明确。";
  }
  if (snapshot.workflowRuns.some((run) => run.status === "running" || run.status === "blocked")) {
    return "检查 workflow run，并根据 handoff 或 blocked 原因继续。";
  }
  return "继续推进当前 surface 所指示的单一下一步。";
}

function deriveRecovery(snapshot: SurfaceSnapshot): string {
  if (snapshot.surfaceKind === "human_waiting" || snapshot.humanRequests.some((request) => request.status === "pending")) {
    return "如果需要新的信息，先等待 human answer；不要在等待中继续执行副作用操作。";
  }
  if (snapshot.workflowRuns.some((run) => run.status === "blocked")) {
    return "读取 workflow handoff/recovery，必要时生成新的 human request 或 resume surface。";
  }
  if (snapshot.pullRequest && snapshot.pullRequest.status === "open") {
    return "若 review 或 validation 变化，先更新 surface 再决定 rework、approval 或 merge。";
  }
  return "如果 surface 过期，重新从 Core 生成当前 snapshot。";
}

function renderAutonomyGuidance(level: AutonomyGuidanceSnapshot["level"]): string {
  if (level === "conservative") {
    return [
      "当前自主级别：conservative。",
      "你应优先请求人类确认。",
      "任何需求解释、方案选择、范围变化、PR/MR 创建、merge、重试策略变化，都应先向人确认。",
      "只允许自行执行无副作用的信息收集和状态检查。"
    ].join("\n");
  }
  if (level === "aggressive") {
    return [
      "当前自主级别：aggressive。",
      "你应尽量自主推进任务，优先自行处理可验证的实现、rework、重试、报告生成和 PR/MR 更新。",
      "只有在缺少必要信息、需要外部权限、存在高风险范围变化，或即将 merge 时，才请求人类确认。",
      "merge 仍然必须等待显式审批。"
    ].join("\n");
  }
  return [
    "当前自主级别：balanced。",
    "你可以自行处理低风险推进、普通重试、状态检查、workflow run continuation、非破坏性整理。",
    "遇到需求范围变化、方案重大调整、成本较高操作、review 结论不明确、merge、破坏性操作时，必须请求人类确认。"
  ].join("\n");
}

function deriveSurfaceKind(task: TaskRecord): SurfaceKind {
  if (task.status === "created") return "bootstrap";
  if (task.status === "planning") return "planning";
  if (task.status === "completed") return "completed";
  if (task.status === "failed") return "failure";
  if (task.status === "waiting_human") return "human_waiting";
  if (task.status === "human_answered") return "human_answered";
  if (task.status === "review") return "review";
  if (task.status === "merge_waiting") return "merge_waiting";
  if (task.status === "resuming") return "resume";
  return "execution";
}

function normalizeAutonomy(value: string): AutonomyGuidanceSnapshot["level"] {
  if (value === "conservative" || value === "aggressive") {
    return value;
  }
  return "balanced";
}

function tool(name: string, usage: string): SurfaceToolJson {
  return {
    name,
    usage,
    args: toolArgs(name),
    side_effect: !isInspectOnlyTool(name),
    success_state: isInspectOnlyTool(name) ? "no state transition" : "surface state updated via Core",
    recovery: "re-read current surface and continue from the recommended next step."
  };
}

function inspectTool(name: string, usage: string): SurfaceToolJson {
  return {
    name,
    usage,
    args: ["--run <workflow-run-id>"],
    side_effect: false,
    success_state: "no state transition",
    recovery: "re-read current surface if inspection result is stale."
  };
}

function toolArgs(name: string): string[] {
  const argsByTool: Record<string, string[]> = {
    write_execution_plan: ["--artifact <path>"],
    revise_execution_plan: ["--artifact <path>", "--reason <short-reason>"],
    create_attempt: ["--reason <reason>"],
    create_workspace: ["--attempt <attempt-id>"],
    start_workflow_run: ["--profile <profile-id>", "--provider <agent-provider-id>"],
    resume_workflow_run: ["--run <workflow-run-id>"],
    inspect_workflow_run: ["--run <workflow-run-id>"],
    ask_human: ["--kind <kind>", "--artifact <path>"],
    create_pr: ["--title <short-title>", "--body-artifact <path>"],
    update_pr: ["--pr <pr-id>", "--body-artifact <path>"],
    inspect_review: ["--pr <pr-id>"],
    start_rework: ["--reason <reason>", "--artifact <path>"],
    request_merge_approval: ["--pr <pr-id>", "--artifact <path>"],
    merge_after_approval: ["--pr <pr-id>"],
    mark_done: ["--reason <reason>"],
    handoff_to_human: ["--artifact <path>"]
  };
  return argsByTool[name] ?? ["--artifact <path>"];
}

function isInspectOnlyTool(name: string): boolean {
  return name === "inspect_workflow_run" || name === "inspect_review";
}

function hasOpenPullRequest(snapshot: SurfaceSnapshot): boolean {
  return snapshot.pullRequest?.status === "open";
}

function isReviewFeedback(snapshot: SurfaceSnapshot): boolean {
  return snapshot.currentState.blocker === "review_feedback";
}

function hasValidMergeApproval(snapshot: SurfaceSnapshot): boolean {
  const approval = snapshot.mergeApproval;
  const pullRequest = snapshot.pullRequest;
  if (!approval || !pullRequest || pullRequest.status !== "open") {
    return false;
  }
  if (approval.status !== "approved" || !approval.valid || approval.prId !== pullRequest.id) {
    return false;
  }
  if (!approval.headSha || !approval.baseSha || !approval.validationRunId || !approval.mergeStrategy) {
    return false;
  }
  if (!pullRequest.headSha || pullRequest.headSha !== approval.headSha) {
    return false;
  }
  if (!pullRequest.baseSha || pullRequest.baseSha !== approval.baseSha) {
    return false;
  }
  return true;
}

function hasValidNoPrCompletion(snapshot: SurfaceSnapshot): boolean {
  return Boolean(snapshot.noPrCompletion?.policyValid && snapshot.noPrCompletion.evidenceArtifactPath);
}

function toMergeApprovalJson(approval: MergeApprovalSnapshot): MergeApprovalSnapshotJson {
  return {
    pr_id: approval.prId,
    status: approval.status,
    valid: approval.valid,
    head_sha: approval.headSha,
    base_sha: approval.baseSha,
    validation_run_id: approval.validationRunId,
    merge_strategy: approval.mergeStrategy,
    approved_by: approval.approvedBy,
    approved_at: approval.approvedAt
  };
}

function toNoPrCompletionJson(noPrCompletion: NoPrCompletionSnapshot): NoPrCompletionSnapshotJson {
  return {
    policy_valid: noPrCompletion.policyValid,
    evidence_artifact_path: noPrCompletion.evidenceArtifactPath
  };
}

function toCurrentStateJson(state: CurrentStateSnapshot): CurrentStateJson {
  return {
    task_status: state.taskStatus,
    attempt_status: state.attemptStatus,
    workflow_run_status: state.workflowRunStatus,
    pull_request_status: state.pullRequestStatus,
    human_request_status: state.humanRequestStatus,
    blocker: state.blocker
  };
}

function toTaskSnapshot(task: TaskRecord): TaskSnapshot {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    autonomy: task.autonomy,
    sourceKind: task.sourceKind,
    status: task.status,
    stateVersion: task.stateVersion
  };
}

function findLatestAttemptForTask(
  context: DbContext,
  taskId: string
): { id: string; status: string; reason: string } | undefined {
  return context.db
    .prepare(
      `SELECT id, status, reason FROM attempts
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(taskId) as { id: string; status: string; reason: string } | undefined;
}

function findActiveWorkspaceForAttempt(
  context: DbContext,
  attemptId: string
):
  | {
      id: string;
      status: string;
      workspace_path: string | null;
      branch: string | null;
      base_branch: string | null;
    }
  | undefined {
  return context.db
    .prepare(
      `SELECT id, status, workspace_path, branch, base_branch FROM workspaces
       WHERE attempt_id = ? AND status IN ('planned', 'creating', 'ready', 'dirty')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(attemptId) as
    | {
        id: string;
        status: string;
        workspace_path: string | null;
        branch: string | null;
        base_branch: string | null;
      }
    | undefined;
}

function findActiveWorkflowRunForAttempt(
  context: DbContext,
  attemptId: string
):
  | {
      id: string;
      profile_id: string;
      status: string;
      handoff_kind: string | null;
    }
  | undefined {
  return context.db
    .prepare(
      `SELECT id, profile_id, status, handoff_kind FROM workflow_runs
       WHERE attempt_id = ? AND status IN ('planned', 'starting', 'running', 'blocked', 'handoff', 'unknown')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(attemptId) as { id: string; profile_id: string; status: string; handoff_kind: string | null } | undefined;
}

function findRecentAgentSessionsForTask(
  context: DbContext,
  taskId: string
): Array<{ id: string; provider_kind: string; role: string; status: string }> {
  return context.db
    .prepare(
      `SELECT id, provider_kind, role, status FROM agent_sessions
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 3`
    )
    .all(taskId) as Array<{ id: string; provider_kind: string; role: string; status: string }>;
}

function toProjectSnapshot(project: ProjectRecord): ProjectSnapshot {
  return {
    id: project.id,
    name: project.name,
    repoPath: project.repoPath,
    repoUrl: project.repoUrl,
    gitProviderKind: project.gitProviderKind,
    defaultBranch: project.defaultBranch,
    workflowLauncher: project.workflowLauncher,
    outerAgentDefaultProvider: project.outerAgentDefaultProvider,
    innerAgentDefaultProvider: project.innerAgentDefaultProvider,
    registrationStatus: project.registrationStatus
  };
}

function toProjectJson(project: ProjectSnapshot): ProjectSurfaceJson {
  return {
    id: project.id,
    name: project.name,
    repo_path: project.repoPath,
    repo_url: project.repoUrl,
    git_provider_kind: project.gitProviderKind,
    default_branch: project.defaultBranch,
    workflow_launcher: project.workflowLauncher,
    outer_agent_default_provider: project.outerAgentDefaultProvider,
    inner_agent_default_provider: project.innerAgentDefaultProvider,
    registration_status: project.registrationStatus
  };
}

function toExecutionPlanJson(plan: ExecutionPlanSnapshot): ExecutionPlanSnapshotJson {
  return {
    id: plan.id,
    status: plan.status,
    artifact_path: plan.artifactPath,
    steps: plan.steps?.map((step) => ({
      order: step.order,
      title: step.title,
      status: step.status,
      evidence_artifact_path: step.evidenceArtifactPath
    }))
  };
}

function toWorkspaceJson(workspace: WorkspaceSnapshot): WorkspaceSnapshotJson {
  return {
    id: workspace.id,
    status: workspace.status,
    path: workspace.path,
    branch: workspace.branch,
    base_branch: workspace.baseBranch
  };
}

function toWorkflowRunJson(run: WorkflowRunSnapshot): WorkflowRunSnapshotJson {
  return {
    id: run.id,
    profile_id: run.profileId,
    status: run.status,
    handoff_kind: run.handoffKind
  };
}

function toAgentSessionJson(session: AgentSessionSnapshot): AgentSessionSnapshotJson {
  return {
    id: session.id,
    provider_kind: session.providerKind,
    role: session.role,
    status: session.status
  };
}

function toPullRequestJson(pr: PullRequestSnapshot): PullRequestSnapshotJson {
  return {
    id: pr.id,
    provider_kind: pr.providerKind,
    status: pr.status,
    head_branch: pr.headBranch,
    base_branch: pr.baseBranch,
    head_sha: pr.headSha,
    base_sha: pr.baseSha,
    url: pr.url
  };
}

function toHumanRequestJson(request: HumanRequestSnapshot): HumanRequestSnapshotJson {
  return {
    id: request.id,
    kind: request.kind,
    status: request.status,
    blocked_key: request.blockedKey,
    question_artifact_path: request.questionArtifactPath,
    answer_artifact_path: request.answerArtifactPath
  };
}
