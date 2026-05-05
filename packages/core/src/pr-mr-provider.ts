import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ActiveResourceConflictError,
  acquireLock,
  appendEvent,
  createHumanRequest,
  createOperation,
  createPullRequest,
  getActivePullRequestByAttempt,
  getActiveWorkspaceByAttempt,
  getActiveWorkflowRunByAttempt,
  getAttempt,
  getHumanRequest,
  getLatestPullRequestByTask,
  getOperationById,
  getProject,
  getTask,
  releaseLock,
  updateHumanRequest,
  updateOperation,
  updatePullRequest,
  updateTaskStatus,
  withTransaction,
  type DbContext,
  type HumanRequestRecord,
  type LockRecord,
  type PullRequestRecord,
  type ProjectRecord,
  type TaskRecord
} from "@coordinator/db";
import { decidePullRequestRecovery } from "./recovery-decision.js";
import { assertArtifactRelativePath } from "./workspace-manager.js";

const DEFAULT_PR_TIMEOUT_MS = 120_000;

export type PullRequestProviderRunner = (
  command: string,
  args: string[],
  options: { cwd: string; input?: string; timeoutMs: number }
) => string;

export type PullRequestProviderKind = "github" | "gitlab" | "fake";

export type PullRequestProviderCreateInput = {
  project: ProjectRecord;
  task: TaskRecord;
  attemptId?: string;
  workspacePath: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  providerId: string;
};

export type PullRequestProviderUpdateInput = {
  project: ProjectRecord;
  pr: PullRequestRecord;
  title?: string;
  body?: string;
  providerId: string;
};

export type PullRequestProviderReviewInput = {
  project: ProjectRecord;
  pr: PullRequestRecord;
  providerId: string;
};

export type PullRequestProviderInspectExistingInput = {
  project: ProjectRecord;
  workspacePath: string;
  headBranch: string;
  baseBranch: string;
  providerId: string;
};

export type PullRequestProviderInspectExistingResult =
  | { state: "found"; pullRequest: PullRequestProviderCreateResult }
  | { state: "absent" };

export type PullRequestProviderMergeInput = {
  project: ProjectRecord;
  pr: PullRequestRecord;
  providerId: string;
  mergeStrategy: "squash";
  headSha?: string;
};

export type PullRequestProviderCreateResult = {
  externalId: string;
  url?: string;
  headBranch?: string;
  baseBranch?: string;
  headSha?: string;
  baseSha?: string;
};

export type PullRequestProviderReviewResult = {
  reviewStatus: string;
  reviewSummary: string;
  headSha?: string;
  baseSha?: string;
  validationRunId?: string;
  mergeable?: boolean;
  url?: string;
};

export type PullRequestExternalState = "open" | "closed_unmerged" | "merged" | "unknown" | "conflict";

export type PullRequestProviderSnapshot = PullRequestProviderReviewResult & {
  state: PullRequestExternalState;
  externalId?: string;
  headBranch?: string;
  baseBranch?: string;
  mergedAt?: string;
};

export type PullRequestProviderUpdateResult = {
  url?: string;
  headSha?: string;
  baseSha?: string;
};

export type PullRequestProviderMergeResult = {
  merged: boolean;
  mergedAt?: string;
  url?: string;
};

export interface PullRequestProvider {
  readonly id: string;
  readonly kind: PullRequestProviderKind;
  inspectExisting(input: PullRequestProviderInspectExistingInput): PullRequestProviderInspectExistingResult;
  create(input: PullRequestProviderCreateInput): PullRequestProviderCreateResult;
  update(input: PullRequestProviderUpdateInput): PullRequestProviderUpdateResult;
  inspectReview(input: PullRequestProviderReviewInput): PullRequestProviderReviewResult;
  merge(input: PullRequestProviderMergeInput): PullRequestProviderMergeResult;
}

export class PullRequestProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PullRequestProviderError";
  }
}

export class FakePullRequestProvider implements PullRequestProvider {
  readonly id = "fake";
  readonly kind = "fake" as const;

  inspectExisting(_input: PullRequestProviderInspectExistingInput): PullRequestProviderInspectExistingResult {
    return { state: "absent" };
  }

  create(input: PullRequestProviderCreateInput): PullRequestProviderCreateResult {
    return {
      externalId: `fake-pr-${input.providerId}`,
      url: `https://example.com/${input.providerId}`,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      headSha: `fake-head-${input.providerId}`,
      baseSha: `fake-base-${input.providerId}`
    };
  }

  update(input: PullRequestProviderUpdateInput): PullRequestProviderUpdateResult {
    return {
      url: `https://example.com/${input.providerId}`,
      headSha: input.pr.headSha ?? `fake-head-${input.providerId}`,
      baseSha: input.pr.baseSha ?? `fake-base-${input.providerId}`
    };
  }

  inspectReview(input: PullRequestProviderReviewInput): PullRequestProviderReviewResult {
    return {
      reviewStatus: input.pr.reviewStatus === "unknown" ? "clean" : input.pr.reviewStatus,
      reviewSummary: input.pr.reviewSummary ?? "fake review",
      headSha: input.pr.headSha ?? `fake-head-${input.providerId}`,
      baseSha: input.pr.baseSha ?? `fake-base-${input.providerId}`,
      validationRunId: input.pr.validationRunId ?? `fake-validation-${input.providerId}`,
      mergeable: true,
      url: input.pr.url
    };
  }

  merge(input: PullRequestProviderMergeInput): PullRequestProviderMergeResult {
    return {
      merged: true,
      mergedAt: new Date().toISOString(),
      url: input.pr.url
    };
  }
}

export class CliPullRequestProvider implements PullRequestProvider {
  readonly id: string;

  constructor(
    readonly kind: Exclude<PullRequestProviderKind, "fake">,
    private readonly runner: PullRequestProviderRunner = runCommand
  ) {
    this.id = `${kind}-cli`;
  }

  inspectExisting(input: PullRequestProviderInspectExistingInput): PullRequestProviderInspectExistingResult {
    const stdout = this.runner(
      this.kind === "github" ? "gh" : "glab",
      this.kind === "github"
        ? [
            "pr",
            "list",
            "--head",
            input.headBranch,
            "--base",
            input.baseBranch,
            "--state",
            "open",
            "--json",
            "url,headRefName,baseRefName,headRefOid,baseRefOid"
          ]
        : [
            "mr",
            "list",
            "--source-branch",
            input.headBranch,
            "--target-branch",
            input.baseBranch,
            "--state",
            "opened",
            "-F",
            "json"
          ],
      {
        cwd: input.workspacePath,
        timeoutMs: DEFAULT_PR_TIMEOUT_MS
      }
    );
    return parseExistingOutput(stdout, input);
  }

  create(input: PullRequestProviderCreateInput): PullRequestProviderCreateResult {
    const args = this.kind === "github"
      ? [
          "pr",
          "create",
          "--title",
          input.title,
          "--body",
          input.body,
          "--base",
          input.baseBranch,
          "--head",
          input.headBranch,
          "--no-maintainer-edit"
        ]
      : [
          "mr",
          "create",
          "--title",
          input.title,
          "--description",
          input.body,
          "--target-branch",
          input.baseBranch,
          "--source-branch",
          input.headBranch,
          "--squash-before-merge",
          "--yes"
        ];
    const stdout = this.runner(this.kind === "github" ? "gh" : "glab", args, {
      cwd: input.workspacePath,
      timeoutMs: DEFAULT_PR_TIMEOUT_MS
    });
    return parseCreateOutput(stdout, input);
  }

  update(input: PullRequestProviderUpdateInput): PullRequestProviderUpdateResult {
    const args = this.kind === "github"
      ? [
          "pr",
          "edit",
          input.pr.externalId ?? input.pr.headBranch ?? input.pr.id,
          ...(input.title ? ["--title", input.title] : []),
          ...(input.body ? ["--body", input.body] : [])
        ]
      : [
          "mr",
          "update",
          input.pr.externalId ?? input.pr.headBranch ?? input.pr.id,
          ...(input.title ? ["--title", input.title] : []),
          ...(input.body ? ["--description", input.body] : [])
        ];
    const stdout = this.runner(this.kind === "github" ? "gh" : "glab", args, {
      cwd: resolveProjectRoot(input.project.repoPath),
      timeoutMs: DEFAULT_PR_TIMEOUT_MS
    });
    return parseReviewOutput(stdout, input.pr);
  }

  inspectReview(input: PullRequestProviderReviewInput): PullRequestProviderReviewResult {
    const args = this.kind === "github"
      ? [
          "pr",
          "view",
          input.pr.externalId ?? input.pr.headBranch ?? input.pr.id,
          "--json",
          "title,body,url,state,headRefName,baseRefName,headRefOid,baseRefOid,reviewDecision,mergeStateStatus,mergeable,mergedAt,latestReviews"
        ]
      : [
          "mr",
          "view",
          input.pr.externalId ?? input.pr.headBranch ?? input.pr.id,
          "-F",
          "json"
        ];
    const stdout = this.runner(this.kind === "github" ? "gh" : "glab", args, {
      cwd: resolveProjectRoot(input.project.repoPath),
      timeoutMs: DEFAULT_PR_TIMEOUT_MS
    });
    return parseReviewOutput(stdout, input.pr);
  }

  merge(input: PullRequestProviderMergeInput): PullRequestProviderMergeResult {
    const args = this.kind === "github"
      ? [
          "pr",
          "merge",
          input.pr.externalId ?? input.pr.headBranch ?? input.pr.id,
          "--squash",
          "--delete-branch",
          "--yes",
          ...(input.headSha ? ["--match-head-commit", input.headSha] : [])
        ]
      : [
          "mr",
          "merge",
          input.pr.externalId ?? input.pr.headBranch ?? input.pr.id,
          "--squash",
          "--yes",
          ...(input.headSha ? ["--sha", input.headSha] : [])
        ];
    const stdout = this.runner(this.kind === "github" ? "gh" : "glab", args, {
      cwd: resolveProjectRoot(input.project.repoPath),
      timeoutMs: DEFAULT_PR_TIMEOUT_MS
    });
    return {
      merged: true,
      mergedAt: new Date().toISOString(),
      url: extractUrl(stdout) ?? input.pr.url
    };
  }
}

export function createPullRequestProvider(kind: PullRequestProviderKind, runner?: PullRequestProviderRunner): PullRequestProvider {
  if (kind === "fake") {
    return new FakePullRequestProvider();
  }
  return new CliPullRequestProvider(kind, runner);
}

export type CreatePullRequestRuntimeInput = {
  taskId: string;
  title: string;
  bodyArtifact: string;
  actor?: string;
  provider?: PullRequestProvider;
  providerRunner?: PullRequestProviderRunner;
};

export type UpdatePullRequestRuntimeInput = {
  taskId: string;
  prId: string;
  title?: string;
  bodyArtifact?: string;
  actor?: string;
  provider?: PullRequestProvider;
  providerRunner?: PullRequestProviderRunner;
};

export type InspectPullRequestReviewRuntimeInput = {
  taskId: string;
  prId: string;
  actor?: string;
  provider?: PullRequestProvider;
  providerRunner?: PullRequestProviderRunner;
};

export type ReconcilePullRequestRuntimeInput = {
  taskId: string;
  prId: string;
  actor?: string;
  operationId?: string;
  provider?: PullRequestProvider;
  providerRunner?: PullRequestProviderRunner;
  retryAllowed?: boolean;
};

export type RequestMergeApprovalRuntimeInput = {
  taskId: string;
  prId: string;
  bodyArtifact: string;
  actor?: string;
};

export type ApproveMergeRuntimeInput = {
  taskId: string;
  prId: string;
  humanRequestId: string;
  actor?: string;
  mergeStrategy?: "squash";
  validationRunId?: string;
  headSha?: string;
  baseSha?: string;
};

export type MergeAfterApprovalRuntimeInput = {
  taskId: string;
  prId: string;
  actor?: string;
  provider?: PullRequestProvider;
  providerRunner?: PullRequestProviderRunner;
};

export function createPullRequestRuntime(
  context: DbContext,
  input: CreatePullRequestRuntimeInput
): { pullRequest: PullRequestRecord; operationId: string; reused: boolean } {
  const task = requireTaskForTask(context, input.taskId);
  const project = requireProjectForTask(context, task);
  const attempt = requireAttemptForTask(context, task);
  const workspace = requireWorkspaceForAttempt(context, attempt.id);
  requirePrReadyWorkflowHandoff(context, attempt.id);
  const provider = input.provider ?? createPullRequestProvider(resolvePrProviderKind(project), input.providerRunner);
  const body = readSurfaceArtifact(`${workspace.workspacePath}/coordinator/artifacts/`, input.bodyArtifact);
  const operationKey = `pr:create:${attempt.id}:${workspace.branch ?? task.id}`;
  const existing = getActivePullRequestByAttempt(context, attempt.id);
  if (existing && existing.status === "open") {
    return { pullRequest: existing, operationId: createReusedOperation(context, operationKey, task, attempt.id, existing.id), reused: true };
  }

  const operation = createOperation(context, {
    idempotencyKey: operationKey,
    kind: "pr:create",
    projectId: project.id,
    taskId: task.id,
    attemptId: attempt.id,
    prId: existing?.id
  });
  const providerInput = {
    project,
    task,
    attemptId: attempt.id,
    workspacePath: workspace.workspacePath ?? "",
    headBranch: requireBranch(workspace.branch),
    baseBranch: requireBaseBranch(workspace.baseBranch, project),
    title: input.title,
    body: body.content,
    providerId: operation.id
  };
  const inspected = runProviderSideEffect(context, operation.id, "failed", () =>
    provider.inspectExisting({
      project,
      workspacePath: providerInput.workspacePath,
      headBranch: providerInput.headBranch,
      baseBranch: providerInput.baseBranch,
      providerId: operation.id
    })
  );
  if (inspected.state === "found" && pullRequestConflictsWithIntent(inspected.pullRequest, providerInput)) {
    updateOperation(context, {
      operationId: operation.id,
      status: "unknown",
      failureCode: "pr_external_conflicts_intent",
      lastObservedState: {
        phase: "pr-create-inspect-conflict",
        observedExternalState: "conflicts-with-intent",
        headBranch: inspected.pullRequest.headBranch,
        baseBranch: inspected.pullRequest.baseBranch
      }
    });
    throw new PullRequestProviderError("external PR/MR conflicts with current intent");
  }
  if (inspected.state === "absent") {
    assertOperationCanRun(operation.status);
  }
  if (operation.status !== "running") {
    updateOperation(context, {
      operationId: operation.id,
      status: "running",
      lastObservedState: {
        phase: "pr-create",
        providerKind: project.prProviderKind ?? resolvePrProviderKind(project),
        headBranch: workspace.branch,
        baseBranch: workspace.baseBranch
      }
    });
  }
  const created =
    inspected.state === "found"
      ? inspected.pullRequest
      : runProviderSideEffect(context, operation.id, "unknown", () => provider.create(providerInput));

  const pullRequest = withTransaction(context, () => {
    const persisted = createPullRequest(context, {
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      providerKind: project.prProviderKind ?? resolvePrProviderKind(project),
      externalId: created.externalId,
      url: created.url,
      status: "open",
      headBranch: created.headBranch ?? workspace.branch ?? undefined,
      baseBranch: created.baseBranch ?? project.defaultBranch,
      headSha: created.headSha,
      baseSha: created.baseSha,
      title: input.title,
      bodyArtifactPath: input.bodyArtifact,
      reviewStatus: "unknown"
    });
    updateTaskStatus(context, task.id, task.stateVersion, "review");
    updateOperation(context, {
      operationId: operation.id,
      // 如果 create 前 inspect 到外部已存在，就明确记录为 reconciled，避免误以为本轮发起了新副作用。
      status: inspected.state === "found" ? "reconciled" : "succeeded",
      externalId: created.externalId,
      lastObservedState: created
    });
    appendEvent(context, {
      type: inspected.state === "found" ? "pr.reconciled" : "pr.created",
      summary: inspected.state === "found" ? `PR/MR reconciled: ${persisted.id}` : `PR/MR created: ${persisted.id}`,
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      prId: persisted.id,
      artifactRefs: [input.bodyArtifact],
      payload: {
        providerKind: persisted.providerKind,
        externalId: created.externalId,
        url: created.url,
        headBranch: persisted.headBranch,
        baseBranch: persisted.baseBranch
      }
    });
    return persisted;
  });

  return { pullRequest, operationId: operation.id, reused: inspected.state === "found" };
}

export function updatePullRequestRuntime(
  context: DbContext,
  input: UpdatePullRequestRuntimeInput
): { pullRequest: PullRequestRecord; operationId: string } {
  const pr = requirePullRequestForTask(context, input.taskId, input.prId);
  const task = requireTaskForTask(context, input.taskId);
  const project = requireProjectForTask(context, task);
  const provider = input.provider ?? createPullRequestProvider(resolvePrProviderKind(project), input.providerRunner);
  const body = input.bodyArtifact ? readSurfaceArtifact(resolvePrArtifactRoot(context, pr), input.bodyArtifact) : undefined;
  const operation = createOperation(context, {
    idempotencyKey: `pr:update:${pr.id}:${pr.stateVersion}`,
    kind: "pr:update",
    projectId: project.id,
    taskId: task.id,
    attemptId: pr.attemptId,
    prId: pr.id
  });
  assertOperationCanRun(operation.status);
  updateOperation(context, {
    operationId: operation.id,
    status: "running",
    lastObservedState: { phase: "pr-update", prId: pr.id }
  });
  const updatedRemote = runProviderSideEffect(context, operation.id, "failed", () =>
    provider.update({
      project,
      pr,
      title: input.title,
      body: body?.content,
      providerId: operation.id
    })
  );
  const updated = withTransaction(context, () =>
    updatePullRequest(context, {
      prId: pr.id,
      expectedStateVersion: pr.stateVersion,
      title: input.title,
      bodyArtifactPath: input.bodyArtifact,
      url: updatedRemote.url,
      headSha: updatedRemote.headSha,
      baseSha: updatedRemote.baseSha
    })
  );
  withTransaction(context, () => {
    updateOperation(context, {
      operationId: operation.id,
      status: "succeeded",
      externalId: pr.externalId,
      lastObservedState: updatedRemote
    });
    appendEvent(context, {
      type: "pr.updated",
      summary: `PR/MR updated: ${updated.id}`,
      projectId: project.id,
      taskId: task.id,
      attemptId: pr.attemptId,
      prId: pr.id,
      artifactRefs: input.bodyArtifact ? [input.bodyArtifact] : undefined,
      payload: {
        title: input.title,
        url: updatedRemote.url
      }
    });
  });
  return { pullRequest: updated, operationId: operation.id };
}

export function inspectPullRequestReviewRuntime(
  context: DbContext,
  input: InspectPullRequestReviewRuntimeInput
): { pullRequest: PullRequestRecord; review: PullRequestProviderReviewResult } {
  const pr = requirePullRequestForTask(context, input.taskId, input.prId);
  const task = requireTaskForTask(context, input.taskId);
  const project = requireProjectForTask(context, task);
  const provider = input.provider ?? createPullRequestProvider(resolvePrProviderKind(project), input.providerRunner);
  const review = provider.inspectReview({ project, pr, providerId: `inspect:${pr.id}` });
  const updated = persistPullRequestSnapshot(context, {
    pr,
    snapshot: snapshotFromReview(pr, review),
    actor: input.actor ?? "coordinator",
    eventType: "pr.review_inspected",
    eventSummary: `PR/MR review inspected: ${pr.id}`
  });
  withTransaction(context, () => {
    appendEvent(context, {
      type: "pr.review_inspected",
      summary: `PR/MR review inspected: ${updated.id}`,
      projectId: project.id,
      taskId: task.id,
      attemptId: pr.attemptId,
      prId: pr.id,
      payload: sanitizedSnapshotPayload(snapshotFromReview(updated, review))
    });
  });
  return { pullRequest: updated, review };
}

export function reconcilePullRequestRuntime(
  context: DbContext,
  input: ReconcilePullRequestRuntimeInput
): { pullRequest: PullRequestRecord; decisionKind: string; reasonCode: string } {
  const pr = requirePullRequestForTask(context, input.taskId, input.prId);
  const task = requireTaskForTask(context, input.taskId);
  const project = requireProjectForTask(context, task);
  const provider = input.provider ?? createPullRequestProvider(resolvePrProviderKind(project), input.providerRunner);
  const operation = input.operationId
    ? getOperationRef(context, input.operationId)
    : createOperation(context, {
        idempotencyKey: `pr:reconcile:${pr.id}:${pr.stateVersion}`,
        kind: "pr:reconcile",
        projectId: project.id,
        taskId: task.id,
        attemptId: pr.attemptId,
        prId: pr.id
      });
  if (operation.status !== "running") {
    updateOperation(context, {
      operationId: operation.id,
      status: "running",
      lastObservedState: { phase: "pr-reconcile", prId: pr.id }
    });
  }
  try {
    const snapshot = inspectPullRequestSnapshot(provider, project, pr, `reconcile:${operation.id}`);
    const result = persistPrRecoveryObservation(context, {
      pr,
      snapshot,
      operationId: operation.id,
      actor: input.actor ?? "daemon",
      retryAllowed: input.retryAllowed
    });
    return { pullRequest: result.pullRequest, decisionKind: result.decision.kind, reasonCode: result.decision.reasonCode };
  } catch (error) {
    const failureKind = classifyProviderFailure(error);
    const decision = decidePullRequestRecovery({
      pullRequest: pr,
      operationId: operation.id,
      externalState: "unknown",
      observedSummary: `PR/MR provider failure: ${failureKind}`,
      failureKind,
      retryAllowed: input.retryAllowed
    });
    withTransaction(context, () => {
      updateOperation(context, {
        operationId: operation.id,
        status: decision.kind === "retry" ? "reconciled" : "unknown",
        failureCode: failureKind,
        lastObservedState: {
          failureKind,
          decision: decision.kind,
          reasonCode: decision.reasonCode,
          observedSummary: decision.observedSummary,
          nextAction: decision.nextAction
        }
      });
      appendEvent(context, {
        type: "pr.recovery_decision",
        summary: `${decision.reasonCode}: ${pr.id}`,
        projectId: project.id,
        taskId: task.id,
        attemptId: pr.attemptId,
        prId: pr.id,
        operationId: operation.id,
        severity: decision.operatorAttentionRequired ? "warn" : "debug",
        payload: narrowPrRecoveryPayload(decision.kind, decision.reasonCode, decision.observedSummary, decision.nextAction)
      });
    });
    return { pullRequest: pr, decisionKind: decision.kind, reasonCode: decision.reasonCode };
  }
}

export function requestMergeApprovalRuntime(
  context: DbContext,
  input: RequestMergeApprovalRuntimeInput
): { humanRequest: HumanRequestRecord; pullRequest: PullRequestRecord } {
  const pr = requirePullRequestForTask(context, input.taskId, input.prId);
  const task = requireTaskForTask(context, input.taskId);
  const project = requireProjectForTask(context, task);
  const attempt = requireAttemptForTask(context, task);
  assertMergeReadiness(pr);
  const artifact = readSurfaceArtifact(resolvePrArtifactRoot(context, pr), input.bodyArtifact);
  const blockedKey = `merge:${pr.id}`;
  const operationKey = `merge-approval:request:${pr.id}:${pr.headSha}:${pr.baseSha}:${pr.validationRunId}:squash`;
  const operation = createOperation(context, {
    idempotencyKey: operationKey,
    kind: "merge-approval:request",
    projectId: project.id,
    taskId: task.id,
    attemptId: attempt.id,
    prId: pr.id
  });
  if (operation.status === "succeeded" || operation.status === "reconciled") {
    const existing = getPendingOrApprovedMergeApproval(context, pr.id);
    if (existing && isSameMergeApprovalSnapshot(pr, existing)) {
      return { humanRequest: existing, pullRequest: pr };
    }
    throw new PullRequestProviderError(`merge approval operation 已完成但 request 不存在：${operation.id}`);
  }
  assertOperationCanRun(operation.status);
  updateOperation(context, {
    operationId: operation.id,
    status: "running",
    lastObservedState: { phase: "merge-approval-request", prId: pr.id }
  });
  const approval = withTransaction(context, () => {
    const existing = getPendingOrApprovedMergeApproval(context, pr.id);
    if (existing && isSameMergeApprovalSnapshot(pr, existing)) {
      updateOperation(context, {
        operationId: operation.id,
        status: "reconciled",
        lastObservedState: { humanRequestId: existing.id, status: existing.status }
      });
      return existing;
    }
    if (existing && !isSameMergeApprovalSnapshot(pr, existing)) {
      updateHumanRequest(context, {
        humanRequestId: existing.id,
        expectedStateVersion: existing.stateVersion,
        status: "rejected",
        approvedBy: input.actor ?? "coordinator",
        approvedAt: new Date().toISOString(),
        approvalSnapshot: {
          headSha: existing.approvalPrHeadSha,
          baseSha: existing.approvalPrBaseSha,
          validationRunId: existing.approvalValidationRunId,
          mergeStrategy: existing.approvalMergeStrategy,
          valid: false
        }
      });
    }
    const created = createHumanRequest(context, {
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      prId: pr.id,
      blockedKey,
      kind: "merge_approval",
      status: "pending",
      questionArtifactPath: artifact.relativePath,
      approvalSnapshot: {
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        validationRunId: pr.validationRunId,
        mergeStrategy: pr.mergeStrategy ?? "squash",
        valid: true
      }
    });
    updateTaskStatus(context, task.id, task.stateVersion, "merge_waiting");
    updateOperation(context, {
      operationId: operation.id,
      status: "succeeded",
      lastObservedState: { humanRequestId: created.id, status: created.status }
    });
    appendEvent(context, {
      type: "pr.merge_approval_requested",
      summary: `merge approval requested: ${created.id}`,
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      prId: pr.id,
      humanRequestId: created.id,
      artifactRefs: [input.bodyArtifact]
    });
    return created;
  });
  return { humanRequest: approval, pullRequest: pr };
}

export function approveMergeRuntime(
  context: DbContext,
  input: ApproveMergeRuntimeInput
): { humanRequest: HumanRequestRecord } {
  const request = requireMergeApprovalRequest(context, input.humanRequestId, input.taskId, input.prId);
  const pr = requirePullRequestForTask(context, input.taskId, input.prId);
  assertApprovalValid(pr, request);
  assertProvidedApprovalSnapshotMatchesRequest(request, input);
  const approved = updateHumanRequest(context, {
    humanRequestId: request.id,
    expectedStateVersion: request.stateVersion,
    status: "approved",
    approvedBy: input.actor ?? "operator",
    approvedAt: new Date().toISOString(),
    approvalSnapshot: {
      headSha: input.headSha ?? request.approvalPrHeadSha,
      baseSha: input.baseSha ?? request.approvalPrBaseSha,
      validationRunId: input.validationRunId ?? request.approvalValidationRunId,
      mergeStrategy: input.mergeStrategy ?? (request.approvalMergeStrategy as "squash" | undefined) ?? "squash",
      valid: true
    }
  });
  return { humanRequest: approved };
}

export function rejectMergeRuntime(
  context: DbContext,
  input: ApproveMergeRuntimeInput
): { humanRequest: HumanRequestRecord } {
  const request = requireMergeApprovalRequest(context, input.humanRequestId, input.taskId, input.prId);
  const rejected = updateHumanRequest(context, {
    humanRequestId: request.id,
    expectedStateVersion: request.stateVersion,
    status: "rejected",
    approvedBy: input.actor ?? "operator",
    approvedAt: new Date().toISOString(),
    approvalSnapshot: {
      headSha: input.headSha ?? request.approvalPrHeadSha,
      baseSha: input.baseSha ?? request.approvalPrBaseSha,
      validationRunId: input.validationRunId ?? request.approvalValidationRunId,
      mergeStrategy: input.mergeStrategy ?? (request.approvalMergeStrategy as "squash" | undefined) ?? "squash",
      valid: false
    }
  });
  return { humanRequest: rejected };
}

export function mergeAfterApprovalRuntime(
  context: DbContext,
  input: MergeAfterApprovalRuntimeInput
): { pullRequest: PullRequestRecord; mergedAt: string; operationId: string } {
  const task = requireTaskForTask(context, input.taskId);
  const project = requireProjectForTask(context, task);
  const pr = requirePullRequestForTask(context, input.taskId, input.prId);
  const provider = input.provider ?? createPullRequestProvider(resolvePrProviderKind(project), input.providerRunner);
  const approval = requireActiveApprovalForPr(context, pr.id);
  assertApprovalValid(pr, approval);
  const operation = createOperation(context, {
    idempotencyKey: `merge:${pr.id}:${pr.headSha}:${pr.baseSha}:${pr.validationRunId}`,
    kind: "merge",
    projectId: project.id,
    taskId: task.id,
    attemptId: pr.attemptId,
    prId: pr.id
  });
  assertOperationCanRun(operation.status);
  const lock = acquireLock(context, {
    resourceKind: "pr-merge",
    resourceId: pr.id,
    owner: input.actor ?? "pr-provider",
    ttlMs: 5 * 60 * 1000
  });
  updateOperation(context, {
    operationId: operation.id,
    status: "running",
    lastObservedState: { phase: "merge", prId: pr.id }
  });
  try {
    const freshSnapshot = runProviderSideEffect(context, operation.id, "failed", () =>
      inspectPullRequestSnapshot(provider, project, pr, `merge-inspect:${operation.id}`)
    );
    if (freshSnapshot.state === "merged") {
      const reconciled = reconcileMergedPullRequest(context, {
        task,
        project,
        pr,
        operationId: operation.id,
        mergedAt: freshSnapshot.mergedAt
      });
      releasePrMergeLock(context, lock);
      return { pullRequest: reconciled, mergedAt: reconciled.mergedAt ?? new Date().toISOString(), operationId: operation.id };
    }
    if (freshSnapshot.state === "conflict") {
      throw new PullRequestProviderError("merge conflict");
    }
    const refreshed = persistPullRequestSnapshot(context, {
      pr,
      snapshot: freshSnapshot,
      actor: input.actor ?? "merge",
      eventType: "pr.merge_snapshot_inspected",
      eventSummary: `PR/MR merge snapshot inspected: ${pr.id}`
    });
    assertMergeReadiness(refreshed);
    assertApprovalValid(refreshed, approval);
    const merged = runProviderSideEffect(context, operation.id, "unknown", () =>
      provider.merge({
        project,
        pr: refreshed,
        providerId: operation.id,
        mergeStrategy: "squash",
        headSha: refreshed.headSha
      })
    );
    const updated = withTransaction(context, () => {
      const persisted = updatePullRequest(context, {
        prId: refreshed.id,
        expectedStateVersion: refreshed.stateVersion,
        status: "merged",
        mergedAt: merged.mergedAt,
        mergeStrategy: "squash"
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "succeeded",
        externalId: refreshed.externalId,
        lastObservedState: merged
      });
      releasePrMergeLock(context, lock);
      appendEvent(context, {
        type: "pr.merged",
        summary: `PR/MR merged: ${persisted.id}`,
        projectId: project.id,
        taskId: task.id,
        attemptId: refreshed.attemptId,
        prId: refreshed.id,
        payload: merged
      });
      updateTaskStatus(context, task.id, task.stateVersion, "completed");
      return persisted;
    });
    return { pullRequest: updated, mergedAt: merged.mergedAt ?? new Date().toISOString(), operationId: operation.id };
  } catch (error) {
    const failureKind = classifyProviderFailure(error);
    withTransaction(context, () => {
      try {
        releasePrMergeLock(context, lock);
      } catch {
        // lock 已过期或已释放时无需覆盖原始错误；operation failure 才是恢复依据。
      }
      if (operationStatus(context, operation.id) === "running") {
        const decision = decidePullRequestRecovery({
          pullRequest: pr,
          operationId: operation.id,
          externalState: failureKind === "conflict" ? "conflict" : "unknown",
          observedSummary: `PR/MR merge failed: ${failureKind}`,
          failureKind,
          retryAllowed: false
        });
        updateOperation(context, {
          operationId: operation.id,
          status: "unknown",
          failureCode: failureKind,
          lastObservedState: {
            phase: "merge-failed",
            failureKind,
            decision: decision.kind,
            reasonCode: decision.reasonCode,
            observedSummary: decision.observedSummary,
            nextAction: decision.nextAction
          }
        });
      }
    });
    appendEvent(context, {
      type: "pr.merge_failed",
      summary: `PR/MR merge failed: ${pr.id}`,
      projectId: project.id,
      taskId: task.id,
      attemptId: pr.attemptId,
      prId: pr.id,
      payload: { failureKind },
      severity: "warn"
    });
    throw error;
  }
}

function releasePrMergeLock(context: DbContext, lock: LockRecord): void {
  releaseLock(context, lock.resourceKind, lock.resourceId, lock.lockToken);
}

function inspectPullRequestSnapshot(
  provider: PullRequestProvider,
  project: ProjectRecord,
  pr: PullRequestRecord,
  providerId: string
): PullRequestProviderSnapshot {
  const review = provider.inspectReview({ project, pr, providerId });
  return snapshotFromReview(pr, review);
}

function snapshotFromReview(pr: PullRequestRecord, review: PullRequestProviderReviewResult): PullRequestProviderSnapshot {
  const state = externalStateFromReview(review);
  return {
    ...review,
    reviewStatus: normalizeReviewStatus(review.reviewStatus),
    state,
    externalId: pr.externalId,
    headBranch: pr.headBranch,
    baseBranch: pr.baseBranch
  };
}

function externalStateFromReview(review: PullRequestProviderReviewResult): PullRequestExternalState {
  const status = `${normalizeReviewStatus(review.reviewStatus)} ${review.reviewSummary}`.toLowerCase();
  if (status.includes("merged")) {
    return "merged";
  }
  if (status.includes("closed") || status.includes("close")) {
    return "closed_unmerged";
  }
  if (status.includes("conflict")) {
    return "conflict";
  }
  if (status.includes("unknown")) {
    return "unknown";
  }
  return "open";
}

function persistPullRequestSnapshot(
  context: DbContext,
  input: {
    pr: PullRequestRecord;
    snapshot: PullRequestProviderSnapshot;
    actor: string;
    eventType: string;
    eventSummary: string;
  }
): PullRequestRecord {
  return withTransaction(context, () => {
    const status = statusFromExternalSnapshot(input.pr, input.snapshot);
    const updated = updatePullRequest(context, {
      prId: input.pr.id,
      expectedStateVersion: input.pr.stateVersion,
      status,
      externalId: input.snapshot.externalId,
      url: input.snapshot.url,
      headBranch: input.snapshot.headBranch,
      baseBranch: input.snapshot.baseBranch,
      headSha: input.snapshot.headSha,
      baseSha: input.snapshot.baseSha,
      reviewStatus: input.snapshot.reviewStatus,
      reviewSummary: input.snapshot.reviewSummary,
      validationRunId: input.snapshot.validationRunId,
      mergedAt: input.snapshot.mergedAt
    });
    invalidateStaleMergeApproval(context, updated, input.actor);
    return updated;
  });
}

function persistPrRecoveryObservation(
  context: DbContext,
  input: {
    pr: PullRequestRecord;
    snapshot: PullRequestProviderSnapshot;
    operationId: string;
    actor: string;
    retryAllowed?: boolean;
  }
) {
  const beforeApproval = getPendingOrApprovedMergeApproval(context, input.pr.id);
  const updated = input.snapshot.state === "merged"
    ? reconcileMergedPullRequest(context, {
        task: requireTaskForTask(context, input.pr.taskId),
        project: requireProjectForTask(context, requireTaskForTask(context, input.pr.taskId)),
        pr: input.pr,
        operationId: input.operationId,
        mergedAt: input.snapshot.mergedAt
      })
    : persistPullRequestSnapshot(context, {
        pr: input.pr,
        snapshot: input.snapshot,
        actor: input.actor,
        eventType: "pr.reconciled",
        eventSummary: `PR/MR reconciled: ${input.pr.id}`
      });
  const afterApproval = getPendingOrApprovedMergeApproval(context, input.pr.id);
  const approvalInvalidated = Boolean(beforeApproval && (!afterApproval || beforeApproval.id !== afterApproval.id || !afterApproval.approvalValid));
  const decision = decidePullRequestRecovery({
    pullRequest: updated,
    operationId: input.operationId,
    externalState: input.snapshot.state,
    observedSummary: `PR/MR ${input.pr.id} observed ${input.snapshot.state}`,
    approvalInvalidated,
    retryAllowed: input.retryAllowed
  });
  withTransaction(context, () => {
      updateOperation(context, {
        operationId: input.operationId,
        status: decision.kind === "unknown" || decision.kind === "operator_attention" ? "unknown" : "reconciled",
        failureCode: input.snapshot.state === "conflict" ? "conflict" : undefined,
        lastObservedState: {
          decision: decision.kind,
          reasonCode: decision.reasonCode,
        observedSummary: decision.observedSummary,
        nextAction: decision.nextAction,
        externalState: input.snapshot.state
      }
    });
    appendEvent(context, {
      type: "pr.recovery_decision",
      summary: `${decision.reasonCode}: ${input.pr.id}`,
      projectId: updated.projectId,
      taskId: updated.taskId,
      attemptId: updated.attemptId,
      prId: updated.id,
      operationId: input.operationId,
      severity: decision.operatorAttentionRequired ? "warn" : "debug",
      payload: narrowPrRecoveryPayload(decision.kind, decision.reasonCode, decision.observedSummary, decision.nextAction)
    });
  });
  return { pullRequest: updated, decision };
}

function statusFromExternalSnapshot(pr: PullRequestRecord, snapshot: PullRequestProviderSnapshot): string {
  if (snapshot.state === "merged") {
    return "merged";
  }
  if (snapshot.state === "closed_unmerged") {
    return "closed";
  }
  return pr.status;
}

function reconcileMergedPullRequest(
  context: DbContext,
  input: { task: TaskRecord; project: ProjectRecord; pr: PullRequestRecord; operationId: string; mergedAt?: string }
): PullRequestRecord {
  return withTransaction(context, () => {
    const latest = requirePullRequestForTask(context, input.task.id, input.pr.id);
    const persisted = latest.status === "merged"
      ? latest
      : updatePullRequest(context, {
          prId: latest.id,
          expectedStateVersion: latest.stateVersion,
          status: "merged",
          mergedAt: input.mergedAt ?? new Date().toISOString(),
          mergeStrategy: "squash"
        });
    updateOperation(context, {
      operationId: input.operationId,
      status: "reconciled",
      externalId: persisted.externalId,
      lastObservedState: { externalState: "merged", prId: persisted.id }
    });
    if (input.task.status !== "completed") {
      updateTaskStatus(context, input.task.id, input.task.stateVersion, "completed");
    }
    appendEvent(context, {
      type: "pr.merge_reconciled",
      summary: `PR/MR merge reconciled: ${persisted.id}`,
      projectId: input.project.id,
      taskId: input.task.id,
      attemptId: persisted.attemptId,
      prId: persisted.id,
      operationId: input.operationId,
      payload: { externalState: "merged" }
    });
    return persisted;
  });
}

function invalidateStaleMergeApproval(context: DbContext, pr: PullRequestRecord, actor: string): void {
  const existing = getPendingOrApprovedMergeApproval(context, pr.id);
  if (!existing || isSameMergeApprovalSnapshot(pr, existing)) {
    return;
  }
  // snapshot 一旦变化，旧 approval 不能被复用；这里由 Core 统一失效，避免 merge tool 看到过期许可。
  updateHumanRequest(context, {
    humanRequestId: existing.id,
    expectedStateVersion: existing.stateVersion,
    status: "rejected",
    approvedBy: actor,
    approvedAt: new Date().toISOString(),
    approvalSnapshot: {
      headSha: existing.approvalPrHeadSha,
      baseSha: existing.approvalPrBaseSha,
      validationRunId: existing.approvalValidationRunId,
      mergeStrategy: existing.approvalMergeStrategy,
      valid: false
    }
  });
  appendEvent(context, {
    type: "pr.merge_approval_invalidated",
    summary: `merge approval invalidated: ${existing.id}`,
    projectId: pr.projectId,
    taskId: pr.taskId,
    attemptId: pr.attemptId,
    prId: pr.id,
    humanRequestId: existing.id,
    severity: "info",
    payload: {
      reason: "pr-snapshot-changed",
      headSha: pr.headSha,
      baseSha: pr.baseSha,
      validationRunId: pr.validationRunId,
      mergeStrategy: pr.mergeStrategy ?? "squash"
    }
  });
}

function pullRequestConflictsWithIntent(
  pullRequest: PullRequestProviderCreateResult,
  intent: { headBranch: string; baseBranch: string }
): boolean {
  return Boolean(
    (pullRequest.headBranch && pullRequest.headBranch !== intent.headBranch) ||
      (pullRequest.baseBranch && pullRequest.baseBranch !== intent.baseBranch)
  );
}

function getOperationRef(context: DbContext, operationId: string) {
  const operation = getOperationById(context, operationId);
  if (!operation) {
    throw new PullRequestProviderError(`operation not found: ${operationId}`);
  }
  return operation;
}

function classifyProviderFailure(error: unknown): string {
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase();
  if (message.includes("auth") || message.includes("permission") || message.includes("credential")) {
    return "auth_missing";
  }
  if (message.includes("rate limit") || message.includes("rate_limited") || message.includes("too many requests")) {
    return "rate_limited";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "timeout";
  }
  if (message.includes("conflict")) {
    return "conflict";
  }
  if (message.includes("parse") || message.includes("malformed") || message.includes("无法解析")) {
    return "malformed_output";
  }
  return "unknown";
}

function sanitizedSnapshotPayload(snapshot: PullRequestProviderSnapshot): Record<string, unknown> {
  return {
    state: snapshot.state,
    reviewStatus: snapshot.reviewStatus,
    headSha: snapshot.headSha,
    baseSha: snapshot.baseSha,
    validationRunId: snapshot.validationRunId,
    mergeable: snapshot.mergeable,
    url: snapshot.url
  };
}

function narrowPrRecoveryPayload(
  decision: string,
  reasonCode: string,
  observedSummary: string,
  nextAction: string
): Record<string, unknown> {
  return { decision, reasonCode, observedSummary, nextAction };
}

function requireTaskForTask(context: DbContext, taskId: string): TaskRecord {
  const task = getTask(context, taskId);
  if (!task) {
    throw new PullRequestProviderError(`task not found: ${taskId}`);
  }
  return task;
}

function requireProjectForTask(context: DbContext, task: TaskRecord): ProjectRecord {
  const project = getProject(context, task.projectId);
  if (!project) {
    throw new PullRequestProviderError(`project not found: ${task.projectId}`);
  }
  return project;
}

function requireAttemptForTask(context: DbContext, task: TaskRecord) {
  const attempt = context.db
    .prepare("SELECT * FROM attempts WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(task.id) as { id: string; project_id: string; task_id: string } | undefined;
  if (!attempt) {
    throw new PullRequestProviderError(`attempt not found for task: ${task.id}`);
  }
  const loaded = getAttempt(context, attempt.id);
  if (!loaded) {
    throw new PullRequestProviderError(`attempt not found: ${attempt.id}`);
  }
  return loaded;
}

function requireWorkspaceForAttempt(context: DbContext, attemptId: string) {
  const workspace = getActiveWorkspaceByAttempt(context, attemptId);
  if (!workspace || !workspace.workspacePath || !workspace.branch || !workspace.baseBranch) {
    throw new PullRequestProviderError(`active workspace not ready for attempt: ${attemptId}`);
  }
  return workspace;
}

function requirePrReadyWorkflowHandoff(context: DbContext, attemptId: string): void {
  const run = getActiveWorkflowRunByAttempt(context, attemptId);
  if (!run || run.status !== "handoff" || run.handoffKind !== "pr_ready") {
    throw new PullRequestProviderError(`workflow handoff pr_ready required for attempt: ${attemptId}`);
  }
}

function requirePullRequestForTask(context: DbContext, taskId: string, prId: string): PullRequestRecord {
  const pr = getLatestPullRequestByTask(context, taskId);
  if (!pr || pr.id !== prId) {
    throw new PullRequestProviderError(`pull request not found for task ${taskId}: ${prId}`);
  }
  return pr;
}

function requireMergeApprovalRequest(context: DbContext, humanRequestId: string, taskId: string, prId: string): HumanRequestRecord {
  const request = getHumanRequest(context, humanRequestId);
  if (!request || request.taskId !== taskId || request.prId !== prId || request.kind !== "merge_approval") {
    throw new PullRequestProviderError(`merge approval request not found: ${humanRequestId}`);
  }
  return request;
}

function requireActiveApprovalForPr(context: DbContext, prId: string): HumanRequestRecord {
  const row = context.db
    .prepare(
      `SELECT * FROM human_requests
       WHERE pr_id = ? AND kind = 'merge_approval' AND status = 'approved'
       ORDER BY updated_at DESC, created_at DESC, id DESC
       LIMIT 1`
    )
    .get(prId) as
    | {
        id: string;
        task_id: string;
      }
    | undefined;
  const approval = row ? getHumanRequest(context, row.id) : undefined;
  if (!approval) {
    throw new PullRequestProviderError(`merge approval not found for PR: ${prId}`);
  }
  return approval;
}

function isSameMergeApprovalSnapshot(
  pr: PullRequestRecord,
  approval: HumanRequestRecord
): boolean {
  return Boolean(
    approval.approvalValid &&
      (pr.reviewStatus === "clean" || pr.reviewStatus === "approved") &&
      approval.approvalPrHeadSha &&
      approval.approvalPrBaseSha &&
      approval.approvalValidationRunId &&
      approval.approvalMergeStrategy &&
      approval.approvalPrHeadSha === pr.headSha &&
      approval.approvalPrBaseSha === pr.baseSha &&
      approval.approvalValidationRunId === pr.validationRunId &&
      approval.approvalMergeStrategy === (pr.mergeStrategy ?? "squash")
  );
}

function assertApprovalValid(pr: PullRequestRecord, approval: HumanRequestRecord): void {
  if (!approval.approvalValid) {
    throw new PullRequestProviderError(`merge approval invalid: ${approval.id}`);
  }
  assertMergeReadiness(pr);
  requireApprovalSnapshot(approval);
  if (approval.approvalPrHeadSha !== pr.headSha) {
    throw new PullRequestProviderError("merge approval head sha mismatch");
  }
  if (approval.approvalPrBaseSha !== pr.baseSha) {
    throw new PullRequestProviderError("merge approval base sha mismatch");
  }
  if (approval.approvalValidationRunId !== pr.validationRunId) {
    throw new PullRequestProviderError("merge approval validation mismatch");
  }
  if (approval.approvalMergeStrategy !== (pr.mergeStrategy ?? "squash")) {
    throw new PullRequestProviderError("merge approval strategy mismatch");
  }
}

function assertMergeReadiness(pr: PullRequestRecord): void {
  if (pr.status !== "open" && pr.status !== "review" && pr.status !== "merge_waiting") {
    throw new PullRequestProviderError(`PR/MR 当前状态不可 merge：${pr.status}`);
  }
  if (pr.reviewStatus !== "clean" && pr.reviewStatus !== "approved") {
    throw new PullRequestProviderError(`PR/MR review 尚未 clean：${pr.reviewStatus}`);
  }
  if (!pr.headSha || !pr.baseSha || !pr.validationRunId) {
    throw new PullRequestProviderError("merge readiness snapshot 不完整，缺少 head/base/validation");
  }
  if (pr.mergeStrategy && pr.mergeStrategy !== "squash") {
    throw new PullRequestProviderError(`不支持的 merge strategy：${pr.mergeStrategy}`);
  }
}

function requireApprovalSnapshot(approval: HumanRequestRecord): void {
  if (
    !approval.approvalPrHeadSha ||
    !approval.approvalPrBaseSha ||
    !approval.approvalValidationRunId ||
    !approval.approvalMergeStrategy
  ) {
    throw new PullRequestProviderError(`merge approval snapshot 不完整：${approval.id}`);
  }
}

function assertProvidedApprovalSnapshotMatchesRequest(request: HumanRequestRecord, input: ApproveMergeRuntimeInput): void {
  if (input.headSha && input.headSha !== request.approvalPrHeadSha) {
    throw new PullRequestProviderError("provided approval head sha mismatch");
  }
  if (input.baseSha && input.baseSha !== request.approvalPrBaseSha) {
    throw new PullRequestProviderError("provided approval base sha mismatch");
  }
  if (input.validationRunId && input.validationRunId !== request.approvalValidationRunId) {
    throw new PullRequestProviderError("provided approval validation mismatch");
  }
  if (input.mergeStrategy && input.mergeStrategy !== request.approvalMergeStrategy) {
    throw new PullRequestProviderError("provided approval strategy mismatch");
  }
}

function getPendingOrApprovedMergeApproval(context: DbContext, prId: string): HumanRequestRecord | undefined {
  const row = context.db
    .prepare(
      `SELECT id FROM human_requests
       WHERE pr_id = ? AND kind = 'merge_approval' AND status IN ('pending', 'approved')
       ORDER BY updated_at DESC, created_at DESC, id DESC
       LIMIT 1`
    )
    .get(prId) as { id: string } | undefined;
  return row ? getHumanRequest(context, row.id) : undefined;
}

function operationStatus(context: DbContext, operationId: string): string {
  const row = context.db.prepare("SELECT status FROM operations WHERE id = ?").get(operationId) as { status: string } | undefined;
  if (!row) {
    throw new PullRequestProviderError(`operation not found: ${operationId}`);
  }
  return row.status;
}

function runProviderSideEffect<T>(
  context: DbContext,
  operationId: string,
  failureStatus: "failed" | "unknown",
  fn: () => T
): T {
  try {
    return fn();
  } catch (error) {
    const failureKind = classifyProviderFailure(error);
    updateOperation(context, {
      operationId,
      status: failureStatus,
      failureCode: failureKind,
      lastObservedState: {
        phase: "provider-side-effect-failed",
        failureKind
      }
    });
    throw error;
  }
}

function resolvePrProviderKind(project: ProjectRecord): Exclude<PullRequestProviderKind, "fake"> {
  if (project.prProviderKind === "github" || project.prProviderKind === "gitlab") {
    return project.prProviderKind;
  }
  throw new PullRequestProviderError(`project ${project.id} 缺少 prProviderKind`);
}

function requireBranch(branch?: string): string {
  if (!branch) {
    throw new PullRequestProviderError("缺少 head branch");
  }
  return branch;
}

function requireBaseBranch(baseBranch: string | undefined, project: ProjectRecord): string {
  if (!baseBranch) {
    if (!project.defaultBranch) {
      throw new PullRequestProviderError(`project ${project.id} 缺少 defaultBranch`);
    }
    return project.defaultBranch;
  }
  return baseBranch;
}

function resolveProjectRoot(repoPath: string | undefined): string {
  if (!repoPath) {
    throw new PullRequestProviderError("project 缺少 repoPath");
  }
  return repoPath;
}

function readSurfaceArtifact(root: string, artifactPath: string): { relativePath: string; content: string } {
  const relativePath = assertArtifactRelativePath(artifactPath);
  const absolutePath = resolve(root, relativePath);
  const content = readFileSync(absolutePath, "utf8");
  return { relativePath, content };
}

function resolvePrArtifactRoot(context: DbContext, pr: PullRequestRecord): string {
  const workspace = getActiveWorkspaceByAttempt(context, pr.attemptId ?? "");
  if (!workspace?.workspacePath) {
    throw new PullRequestProviderError(`pull request ${pr.id} 缺少 active workspace`);
  }
  return `${workspace.workspacePath}/coordinator/artifacts/`;
}

function createReusedOperation(context: DbContext, idempotencyKey: string, task: TaskRecord, attemptId: string, prId: string): string {
  const op = createOperation(context, {
    idempotencyKey,
    kind: "pr:create",
    projectId: task.projectId,
    taskId: task.id,
    attemptId,
    prId
  });
  return op.id;
}

function assertOperationCanRun(status: string): void {
  if (status === "running" || status === "unknown") {
    throw new ActiveResourceConflictError(`operation requires reconcile before retry: ${status}`);
  }
  if (status === "succeeded" || status === "reconciled" || status === "canceled") {
    throw new PullRequestProviderError(`operation is terminal: ${status}`);
  }
}

function extractUrl(output: string): string | undefined {
  const trimmed = output.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && "url" in parsed && typeof (parsed as { url?: unknown }).url === "string") {
      return (parsed as { url: string }).url;
    }
  } catch {
    // fall through
  }
  const urlMatch = trimmed.match(/https?:\/\/\S+/);
  return urlMatch?.[0];
}

function parseCreateOutput(output: string, input: PullRequestProviderCreateInput): PullRequestProviderCreateResult {
  const url = extractUrl(output);
  return {
    externalId: url ?? `${input.providerId}`,
    url,
    headBranch: input.headBranch,
    baseBranch: input.baseBranch,
    headSha: `head-${input.providerId}`,
    baseSha: `base-${input.providerId}`
  };
}

function parseExistingOutput(
  output: string,
  input: PullRequestProviderInspectExistingInput
): PullRequestProviderInspectExistingResult {
  const trimmed = output.trim();
  if (!trimmed) {
    return { state: "absent" };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const value = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!value || typeof value !== "object") {
      return { state: "absent" };
    }
    const record = value as Record<string, unknown>;
    const sourceBranch = stringValue(record.headRefName) ?? stringValue(record.source_branch) ?? input.headBranch;
    const targetBranch = stringValue(record.baseRefName) ?? stringValue(record.target_branch) ?? input.baseBranch;
    if (sourceBranch !== input.headBranch || targetBranch !== input.baseBranch) {
      return { state: "absent" };
    }
    const url = stringValue(record.url) ?? stringValue(record.web_url);
    return {
      state: "found",
      pullRequest: {
        externalId: url ?? stringValue(record.iid) ?? stringValue(record.id) ?? `${input.providerId}`,
        url,
        headBranch: sourceBranch,
        baseBranch: targetBranch,
        headSha: stringValue(record.headRefOid) ?? stringValue(record.sha),
        baseSha: stringValue(record.baseRefOid)
      }
    };
  } catch (error) {
    throw new PullRequestProviderError(
      `PR/MR inspect existing 输出无法解析：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseReviewOutput(output: string, pr: PullRequestRecord): PullRequestProviderReviewResult {
  try {
    const value = JSON.parse(output) as Record<string, unknown>;
    const reviewStatus =
      stringValue(value.reviewDecision) ??
      stringValue(value.mergeStateStatus) ??
      stringValue(value.detailed_merge_status) ??
      stringValue(value.merge_status) ??
      "unknown";
    const summary = stringValue(value.summary) ?? stringValue(value.title) ?? stringValue(value.description) ?? "review inspected";
    return {
      reviewStatus: normalizeReviewStatus(reviewStatus),
      reviewSummary: summary,
      headSha: stringValue(value.headRefOid) ?? stringValue(value.sha) ?? pr.headSha,
      baseSha: stringValue(value.baseRefOid) ?? pr.baseSha,
      validationRunId: stringValue(value.validation_run_id) ?? pr.validationRunId,
      mergeable: booleanValue(value.mergeable) ?? booleanValue(value.blocking_discussions_resolved),
      url: stringValue(value.url) ?? stringValue(value.web_url) ?? pr.url
    };
  } catch {
    const summary = output.trim() || "review inspected";
    return {
      reviewStatus: "unknown",
      reviewSummary: summary,
      headSha: pr.headSha,
      baseSha: pr.baseSha,
      validationRunId: pr.validationRunId,
      mergeable: undefined,
      url: pr.url
    };
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeReviewStatus(status: string | undefined): string {
  const value = (status ?? "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "approved" || value === "clean" || value === "mergeable" || value === "can_be_merged") {
    return "approved";
  }
  if (value === "changes_requested" || value === "blocked" || value === "blocking" || value === "cannot_be_merged") {
    return "changes_requested";
  }
  if (value === "review_required" || value === "required" || value === "pending" || value === "requested") {
    return "review_required";
  }
  if (value === "merged") {
    return "merged";
  }
  if (value === "closed") {
    return "closed";
  }
  if (value === "conflict" || value === "dirty" || value === "has_conflicts") {
    return "conflict";
  }
  return value || "unknown";
}

function runCommand(command: string, args: string[], options: { cwd: string; input?: string; timeoutMs: number }): string {
  return execFileSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeoutMs
  });
}
