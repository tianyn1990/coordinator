import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { getProject, getTask, type DbContext, type ProjectRecord, type TaskRecord } from "@coordinator/db";
import { extractAgentActivitySummary, type AgentActivitySummary, type NormalizedAgentEvent } from "./agent-activity.js";

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
  requestedWorkflowProfile?: string;
  sourceKind: string;
  status: string;
  stateVersion: number;
};

type TaskSurfaceJson = {
  id: string;
  title: string;
  description: string;
  autonomy: string;
  requested_workflow_profile?: string;
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
  selectionSource?: string;
  requestedProfileId?: string;
  requestedProfileAlias?: string;
  status?: string;
  handoffKind?: string;
};

type WorkflowRunSnapshotJson = {
  id?: string;
  profile_id?: string;
  selection_source?: string;
  requested_profile_id?: string;
  requested_profile_alias?: string;
  status?: string;
  handoff_kind?: string;
};

export type AgentSessionSnapshot = {
  id?: string;
  providerKind?: string;
  role?: string;
  status?: string;
  activity?: SurfaceAgentActivitySummary;
};

type AgentSessionSnapshotJson = {
  id?: string;
  provider_kind?: string;
  role?: string;
  status?: string;
  activity?: SurfaceAgentActivitySummary;
};

export type SurfaceAgentActivitySummary = {
  state: AgentActivitySummary["state"];
  lastActivityAt?: string;
  latestEvent?: Pick<NormalizedAgentEvent, "kind" | "summary" | "timestamp" | "severity">;
  artifactRefs?: {
    finalResponsePath?: string;
  };
};

export type PullRequestSnapshot = {
  id?: string;
  providerKind?: string;
  status?: string;
  headBranch?: string;
  baseBranch?: string;
  headSha?: string;
  baseSha?: string;
  reviewStatus?: string;
  reviewSummary?: string;
  validationRunId?: string;
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
  review_status?: string;
  review_summary?: string;
  validation_run_id?: string;
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
      requested_workflow_profile: snapshot.task.requestedWorkflowProfile,
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
  const executionPlan = findLatestExecutionPlanForTask(context, task.id);
  const humanRequests = findHumanRequestsForTask(context, task.id);
  const pullRequest = latestAttempt ? findLatestPullRequestForAttempt(context, latestAttempt.id) : undefined;
  const mergeApproval = pullRequest ? findLatestMergeApprovalForPr(context, pullRequest.id) : undefined;

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
      workflowRunStatus: activeWorkflowRun?.status,
      pullRequestStatus: pullRequest?.status,
      humanRequestStatus: humanRequests.find((request) => request.status === "pending")?.status
    },
    executionPlan: executionPlan
      ? {
          id: executionPlan.id,
          status: executionPlan.status,
          artifactPath: executionPlan.artifact_path ?? undefined
        }
      : undefined,
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
            selectionSource: activeWorkflowRun.selection_source,
            requestedProfileId: activeWorkflowRun.requested_profile_id ?? undefined,
            requestedProfileAlias: activeWorkflowRun.requested_profile_alias ?? undefined,
            status: activeWorkflowRun.status,
            handoffKind: activeWorkflowRun.handoff_kind ?? undefined
          }
        ]
      : [],
    agentSessions: recentAgentSessions.map((session) => ({
      id: session.id,
      providerKind: session.provider_kind,
      role: session.role,
      status: session.status,
      activity: findLatestAgentActivityForSurface(context, session.id)
    })),
    pullRequest: pullRequest
      ? {
          id: pullRequest.id,
          providerKind: pullRequest.provider_kind,
          status: pullRequest.status,
          headBranch: pullRequest.head_branch ?? undefined,
          baseBranch: pullRequest.base_branch ?? undefined,
          headSha: pullRequest.head_sha ?? undefined,
          baseSha: pullRequest.base_sha ?? undefined,
          reviewStatus: pullRequest.review_status ?? undefined,
          reviewSummary: pullRequest.review_summary ?? undefined,
          validationRunId: pullRequest.validation_run_id ?? undefined,
          url: pullRequest.url ?? undefined
        }
      : undefined,
    mergeApproval: mergeApproval
      ? {
          prId: mergeApproval.pr_id,
          status: mergeApproval.status as "approved" | "pending" | "rejected",
          valid: mergeApproval.approval_valid !== 0 && isMergeApprovalSnapshotMatching(pullRequest, mergeApproval),
          headSha: mergeApproval.approval_pr_head_sha ?? undefined,
          baseSha: mergeApproval.approval_pr_base_sha ?? undefined,
          validationRunId: mergeApproval.approval_validation_run_id ?? undefined,
          mergeStrategy: mergeApproval.approval_merge_strategy ?? undefined,
          approvedBy: mergeApproval.approved_by ?? undefined,
          approvedAt: mergeApproval.approved_at ?? undefined
        }
      : undefined,
    humanRequests: humanRequests.map((request) => ({
      id: request.id,
      kind: request.kind,
      status: request.status,
      blockedKey: request.blocked_key,
      questionArtifactPath: request.question_artifact_path ?? undefined,
      answerArtifactPath: request.answer_artifact_path ?? undefined
    })),
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
      : `${resolveTaskLocalArtifactRoot(project, task)}/`,
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
  if (json.task.requested_workflow_profile) {
    lines.push(`- requested_workflow_profile: ${json.task.requested_workflow_profile} (human explicit selection)`);
  }
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
      const selection = run.selection_source ? `${run.selection_source}` : "unknown";
      const requested = run.requested_profile_id ?? run.requested_profile_alias ?? "auto";
      lines.push(
        `- workflow_run: ${run.id ?? "unknown"} profile=${run.profile_id ?? "unknown"} selection=${selection} requested=${requested} status=${run.status ?? "unknown"} handoff=${run.handoff_kind ?? "none"}`
      );
    }
  } else {
    lines.push(`- workflow_run: 当前 surface 未发现 active workflow run。`);
  }
  if (json.agent_sessions.length > 0) {
    for (const session of json.agent_sessions) {
      lines.push(`- agent_session: ${session.id ?? "unknown"} provider=${session.provider_kind ?? "unknown"} role=${session.role ?? "unknown"} status=${session.status ?? "unknown"}`);
      if (session.activity?.lastActivityAt || session.activity?.latestEvent) {
        lines.push(
          `  - activity: last=${session.activity.lastActivityAt ?? "unknown"} latest=${session.activity.latestEvent?.kind ?? "none"} summary=${session.activity.latestEvent?.summary ?? "none"}`
        );
      }
    }
  } else {
    lines.push(`- agent_session: 当前没有 recent agent session。`);
  }
  lines.push(``);
  if (json.pull_request) {
    lines.push(`## PR/MR`);
    lines.push(`- pr_id: ${json.pull_request.id ?? "unknown"}`);
    lines.push(`- status: ${json.pull_request.status ?? "unknown"}`);
    if (json.pull_request.url) lines.push(`- url: ${json.pull_request.url}`);
    if (json.pull_request.head_branch) lines.push(`- head_branch: ${json.pull_request.head_branch}`);
    if (json.pull_request.base_branch) lines.push(`- base_branch: ${json.pull_request.base_branch}`);
    if (json.pull_request.review_status) lines.push(`- review_status: ${json.pull_request.review_status}`);
    if (json.pull_request.validation_run_id) lines.push(`- validation_run_id: ${json.pull_request.validation_run_id}`);
    lines.push(``);
  }
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
  if (isPausedOrCanceledTask(snapshot.task.status)) {
    return snapshot.workflowRuns.length > 0 ? [inspectTool("inspect_workflow_run", "查看当前 workflow run 状态，但不要继续执行副作用操作。")] : [];
  }

  const humanPending = snapshot.surfaceKind === "human_waiting" || snapshot.humanRequests.some((request) => request.status === "pending");
  if (humanPending) {
    return snapshot.workflowRuns.length > 0
      ? [inspectTool("inspect_workflow_run", "查看 workflow run 状态，判断等待原因。")]
      : [];
  }

  if (snapshot.surfaceKind === "completed" || snapshot.surfaceKind === "failure") {
    return snapshot.workflowRuns.length > 0 ? [inspectTool("inspect_workflow_run", "查看历史 workflow 结果。")] : [];
  }

  if (snapshot.surfaceKind === "merge_waiting") {
    if (snapshot.pullRequest && isUsableMergeApproval(snapshot.pullRequest, snapshot.mergeApproval)) {
      return [
        tool("merge_after_approval", "在有效 human approval snapshot 后执行 squash merge。"),
        inspectTool("inspect_review", "重新检查 PR/MR review 状态。")
      ];
    }
    if (snapshot.pullRequest) {
      return [
        tool("request_merge_approval", "为当前 PR/MR 请求显式 merge approval。"),
        inspectTool("inspect_review", "检查 PR/MR review 状态。"),
        tool("ask_human", "在 approval 信息不足时向人类提问。")
      ];
    }
    return [tool("ask_human", "缺少 PR/MR snapshot，不能进入 merge。")];
  }

  if (snapshot.surfaceKind === "review" && isReviewFeedback(snapshot)) {
    return [
      tool("revise_execution_plan", "在计划需要调整时更新 execution plan。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }

  if (hasOpenPullRequest(snapshot)) {
    const reviewStatus = normalizeReviewStatus(snapshot.pullRequest?.reviewStatus);
    if (reviewStatus === "clean" || reviewStatus === "approved") {
      return [
        inspectTool("inspect_review", "检查 PR/MR review 状态。"),
        tool("update_pr", "更新 PR/MR 标题或正文。"),
        tool("request_merge_approval", "请求显式 merge approval。"),
        tool("ask_human", "在 review 结论不明确时向人类提问。")
      ];
    }
    return [
      inspectTool("inspect_review", "检查 PR/MR review 状态。"),
      tool("update_pr", "更新 PR/MR 标题或正文。"),
      tool("ask_human", "在 review 结论不明确时向人类提问。")
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

  if (snapshot.workspace.status === "blocked") {
    return [
      inspectTool("inspect_workflow_run", "查看 workflow run 状态。"),
      tool("ask_human", "workspace 需要 operator review 时向人类提问。")
    ];
  }

  if (snapshot.workflowRuns.some((run) => run.status === "running" || run.status === "blocked" || run.status === "planned")) {
    return [
      tool("inspect_workflow_run", "查看 workflow run 状态；running workflow 只 inspect 或等待 handoff，不执行 workflow 内部 action。"),
      tool("ask_human", "在信息不足时向人类提问。")
    ];
  }

  const handoffRun = snapshot.workflowRuns.find((run) => run.handoffKind);
  if (handoffRun?.handoffKind === "pr_ready") {
    return [
      tool("create_pr", "根据 workflow handoff 创建 PR/MR。"),
      tool("revise_execution_plan", "在计划需要调整时更新 execution plan。"),
      tool("ask_human", "PR/MR 信息不足时向人类提问。")
    ];
  }
  if (handoffRun?.handoffKind === "manual_handoff" || handoffRun?.handoffKind === "blocked") {
    return [
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
    return [tool("ask_human", "当前 executor 尚未实现 mark_done；需要人类确认 no-PR completion 后续处理。")];
  }

  if (snapshot.workspace.status === "ready" || snapshot.workspace.status === "dirty") {
    return [
      tool("start_workflow_run", "在当前 workspace 中启动 workflow run；profile 由 workflow runtime 或人类显式选择决定。"),
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
  if (snapshot.task.status === "paused") {
    denied.push("任务已被 operator pause；不要继续执行副作用操作，等待 operator resume。");
  }
  if (snapshot.task.status === "canceled") {
    denied.push("任务已被 operator cancel；不要继续推进 task、workspace、workflow 或 PR/MR。");
  }
  if (snapshot.workspace?.status === "blocked") {
    denied.push("workspace recovery 已进入 operator review；不要启动 workflow 或继续执行 workspace 副作用。");
  }
  if (!snapshot.pullRequest || snapshot.pullRequest.status !== "open") {
    denied.push("不要在没有有效 PR/MR 时执行 merge。");
  }
  return denied;
}

function deriveRecommendedNextStep(snapshot: SurfaceSnapshot): string {
  if (snapshot.task.status === "paused") {
    return "任务已暂停；等待 operator resume 后再由 daemon 基于最新 surface 继续。";
  }
  if (snapshot.task.status === "canceled") {
    return "任务已取消；不要继续推进，保留现有 workspace、PR/MR 和 artifact 供 operator 排查。";
  }
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
  if (snapshot.workspace.status === "blocked") {
    return "workspace recovery 已阻塞；等待 operator review 或通过 human request 明确处理方式。";
  }
  if (snapshot.workflowRuns.some((run) => run.status === "running" || run.status === "blocked")) {
    return "检查 workflow run 状态；如果尚未产生 handoff，则等待 workflow 自己推进或继续由 daemon inspect。profile 由 workflow runtime 最终决定，不由外层 Agent 选择。";
  }
  return "继续推进当前 surface 所指示的单一下一步。";
}

function deriveRecovery(snapshot: SurfaceSnapshot): string {
  if (snapshot.task.status === "paused") {
    return "operator resume 后会进入 resuming，并由 daemon 重新生成 surface；暂停期间不要自动推进。";
  }
  if (snapshot.task.status === "canceled") {
    return "cancel 只停止 coordinator 自动推进；外部资源清理需要后续独立 operator action。";
  }
  if (snapshot.surfaceKind === "human_waiting" || snapshot.humanRequests.some((request) => request.status === "pending")) {
    return "如果需要新的信息，先等待 human answer；不要在等待中继续执行副作用操作。";
  }
  if (snapshot.workflowRuns.some((run) => run.status === "blocked")) {
    return "读取 workflow handoff/recovery，必要时生成新的 human request 或 resume surface。";
  }
  if (snapshot.workflowRuns.some((run) => run.status === "running")) {
    return "running workflow 只能通过 workflow protocol status 观察；不要绕过 workflow handoff 执行内部 action。";
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
  if (task.status === "paused") return "resume";
  if (task.status === "completed") return "completed";
  if (task.status === "canceled") return "completed";
  if (task.status === "failed") return "failure";
  if (task.status === "waiting_human") return "human_waiting";
  if (task.status === "human_answered") return "human_answered";
  if (task.status === "review") return "review";
  if (task.status === "merge_waiting") return "merge_waiting";
  if (task.status === "resuming") return "resume";
  return "execution";
}

function isPausedOrCanceledTask(status: string): boolean {
  return status === "paused" || status === "canceled";
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
    args: toolArgs(name),
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
    start_workflow_run: [],
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

function isUsableMergeApproval(
  pr: PullRequestSnapshot,
  approval: MergeApprovalSnapshot | undefined
): approval is MergeApprovalSnapshot {
  if (!approval || approval.status !== "approved" || !approval.valid) {
    return false;
  }
  if (approval.prId !== pr.id) {
    return false;
  }
  return (
    Boolean((pr.status === "open" || pr.status === "review" || pr.status === "merge_waiting") && (pr.reviewStatus === "clean" || pr.reviewStatus === "approved")) &&
    Boolean(approval.headSha && pr.headSha && approval.headSha === pr.headSha) &&
    Boolean(approval.baseSha && pr.baseSha && approval.baseSha === pr.baseSha) &&
    Boolean(approval.validationRunId && pr.validationRunId && approval.validationRunId === pr.validationRunId) &&
    Boolean(approval.mergeStrategy && approval.mergeStrategy === "squash")
  );
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
    requestedWorkflowProfile: task.requestedWorkflowProfile,
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
       WHERE attempt_id = ? AND status IN ('planned', 'creating', 'ready', 'dirty', 'blocked')
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
      selection_source: string;
      requested_profile_id: string | null;
      requested_profile_alias: string | null;
      status: string;
      handoff_kind: string | null;
    }
  | undefined {
  return context.db
    .prepare(
      `SELECT id, profile_id, selection_source, requested_profile_id, requested_profile_alias, status, handoff_kind FROM workflow_runs
       WHERE attempt_id = ? AND status IN ('planned', 'starting', 'running', 'blocked', 'handoff', 'unknown')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(attemptId) as
    | {
        id: string;
        profile_id: string;
        selection_source: string;
        requested_profile_id: string | null;
        requested_profile_alias: string | null;
        status: string;
        handoff_kind: string | null;
      }
    | undefined;
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

function findLatestAgentActivityForSurface(context: DbContext, agentSessionId: string): SurfaceAgentActivitySummary | undefined {
  const rows = context.db
    .prepare(
      `SELECT payload_json FROM events
       WHERE agent_session_id = ? AND payload_json IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 5`
    )
    .all(agentSessionId) as Array<{ payload_json: string | null }>;
  for (const row of rows) {
    if (!row.payload_json) {
      continue;
    }
    try {
      const activity = extractAgentActivitySummary(JSON.parse(row.payload_json));
      if (activity) {
        return toSurfaceAgentActivity(activity);
      }
    } catch {
      // malformed event payload 不能阻断 surface 构建；append-only event 仍保留供 operator 排查。
    }
  }
  return undefined;
}

function toSurfaceAgentActivity(activity: AgentActivitySummary): SurfaceAgentActivitySummary {
  // Surface 是 agent-facing 输入，故这里只暴露 lifecycle 摘要和 final response 引用，不泄漏 raw event artifact 或权限细节。
  return {
    state: activity.state,
    lastActivityAt: activity.lastActivityAt,
    latestEvent: activity.latestEvent
      ? {
          kind: activity.latestEvent.kind,
          summary: activity.latestEvent.summary,
          timestamp: activity.latestEvent.timestamp,
          severity: activity.latestEvent.severity
        }
      : undefined,
    artifactRefs: activity.artifactRefs.finalResponsePath
      ? {
          finalResponsePath: activity.artifactRefs.finalResponsePath
        }
      : undefined
  };
}

function findLatestExecutionPlanForTask(
  context: DbContext,
  taskId: string
): { id: string; status: string; artifact_path: string | null } | undefined {
  return context.db
    .prepare(
      `SELECT id, status, artifact_path FROM execution_plans
       WHERE task_id = ? AND status IN ('draft', 'active', 'revised')
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(taskId) as { id: string; status: string; artifact_path: string | null } | undefined;
}

function findHumanRequestsForTask(
  context: DbContext,
  taskId: string
): Array<{
  id: string;
  blocked_key: string;
  kind: string;
  status: string;
  question_artifact_path: string | null;
  answer_artifact_path: string | null;
}> {
  return context.db
    .prepare(
      `SELECT id, blocked_key, kind, status, question_artifact_path, answer_artifact_path
       FROM human_requests
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 5`
    )
    .all(taskId) as Array<{
      id: string;
      blocked_key: string;
      kind: string;
      status: string;
      question_artifact_path: string | null;
      answer_artifact_path: string | null;
    }>;
}

function findLatestPullRequestForAttempt(
  context: DbContext,
  attemptId: string
):
  | {
      id: string;
      provider_kind: string;
      status: string;
      head_branch: string | null;
      base_branch: string | null;
      head_sha: string | null;
      base_sha: string | null;
      review_status: string | null;
      review_summary: string | null;
      validation_run_id: string | null;
      url: string | null;
    }
  | undefined {
  return context.db
    .prepare(
      `SELECT id, provider_kind, status, head_branch, base_branch, head_sha, base_sha,
              review_status, review_summary, validation_run_id, url
       FROM pull_requests
       WHERE attempt_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(attemptId) as
    | {
        id: string;
        provider_kind: string;
        status: string;
        head_branch: string | null;
        base_branch: string | null;
        head_sha: string | null;
        base_sha: string | null;
        review_status: string | null;
        review_summary: string | null;
        validation_run_id: string | null;
        url: string | null;
      }
    | undefined;
}

function findLatestMergeApprovalForPr(
  context: DbContext,
  prId: string
):
  | {
      pr_id: string;
      status: string;
      approval_pr_head_sha: string | null;
      approval_pr_base_sha: string | null;
      approval_validation_run_id: string | null;
      approval_merge_strategy: string | null;
      approval_valid: number;
      approved_by: string | null;
      approved_at: string | null;
    }
  | undefined {
  return context.db
    .prepare(
      `SELECT pr_id, status, approval_pr_head_sha, approval_pr_base_sha,
              approval_validation_run_id, approval_merge_strategy, approval_valid,
              approved_by, approved_at
       FROM human_requests
       WHERE pr_id = ? AND kind = 'merge_approval' AND status IN ('pending', 'approved', 'rejected')
       ORDER BY updated_at DESC, created_at DESC, id DESC
       LIMIT 1`
    )
    .get(prId) as
    | {
        pr_id: string;
        status: string;
        approval_pr_head_sha: string | null;
        approval_pr_base_sha: string | null;
        approval_validation_run_id: string | null;
        approval_merge_strategy: string | null;
        approval_valid: number;
        approved_by: string | null;
        approved_at: string | null;
      }
    | undefined;
}

function isMergeApprovalSnapshotMatching(
  pr:
    | {
        head_sha: string | null;
        base_sha: string | null;
        validation_run_id: string | null;
        review_status?: string | null;
      }
    | undefined,
  approval: {
    approval_pr_head_sha: string | null;
    approval_pr_base_sha: string | null;
    approval_validation_run_id: string | null;
  }
): boolean {
  if (!pr) return false;
  if (normalizeReviewStatus(pr.review_status) !== "clean" && normalizeReviewStatus(pr.review_status) !== "approved") return false;
  return (
    Boolean(approval.approval_pr_head_sha && pr.head_sha) &&
    Boolean(approval.approval_pr_base_sha && pr.base_sha) &&
    (!approval.approval_pr_head_sha || !pr.head_sha || approval.approval_pr_head_sha === pr.head_sha) &&
    (!approval.approval_pr_base_sha || !pr.base_sha || approval.approval_pr_base_sha === pr.base_sha) &&
    (!approval.approval_validation_run_id || !pr.validation_run_id || approval.approval_validation_run_id === pr.validation_run_id)
  );
}

function normalizeReviewStatus(status: string | null | undefined): string {
  const value = (status ?? "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "approved" || value === "clean" || value === "mergeable" || value === "can_be_merged") {
    return "approved";
  }
  return value;
}

function resolveTaskLocalArtifactRoot(project: ProjectRecord, task: TaskRecord): string {
  // planning 阶段还没有 workspace，但 agent 仍需要可写 artifact root 来提交计划和问题。
  const root = project.workspaceRoot ?? join(homedir(), ".coordinator", "workspaces");
  return join(root, project.id, task.id, "_task", "coordinator", "artifacts");
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
    selection_source: run.selectionSource,
    requested_profile_id: run.requestedProfileId,
    requested_profile_alias: run.requestedProfileAlias,
    status: run.status,
    handoff_kind: run.handoffKind
  };
}

function toAgentSessionJson(session: AgentSessionSnapshot): AgentSessionSnapshotJson {
  return {
    id: session.id,
    provider_kind: session.providerKind,
    role: session.role,
    status: session.status,
    activity: session.activity
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
    review_status: pr.reviewStatus,
    review_summary: pr.reviewSummary,
    validation_run_id: pr.validationRunId,
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
