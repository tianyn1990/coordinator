import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAttempt,
  createHumanRequest,
  createProject,
  createPullRequest,
  createOperation,
  createTask,
  createWorkspace,
  getHumanRequest,
  getLatestPullRequestByTask,
  getOperationByIdempotencyKey,
  listTaskEvents,
  runMigrations,
  updateOperation,
  updatePullRequest,
  withDatabase,
  type DbContext
} from "@coordinator/db";
import {
  CliPullRequestProvider,
  FakePullRequestProvider,
  PullRequestProviderError,
  approveMergeRuntime,
  createPullRequestRuntime,
  inspectPullRequestReviewRuntime,
  mergeAfterApprovalRuntime,
  reconcilePullRequestRuntime,
  requestMergeApprovalRuntime,
  type PullRequestProvider,
  type PullRequestProviderCreateInput,
  type PullRequestProviderCreateResult,
  type PullRequestProviderInspectExistingInput,
  type PullRequestProviderInspectExistingResult,
  type PullRequestProviderMergeInput,
  type PullRequestProviderReviewInput,
  type PullRequestProviderReviewResult,
  type PullRequestProviderRunner
} from "./index.js";

function createMigratedDatabase(): string {
  const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-pr-db-")), "pr.sqlite");
  runMigrations(databasePath);
  return databasePath;
}

function createReadyPrFixture(databasePath: string) {
  const repoPath = mkdtempSync(join(tmpdir(), "coordinator-pr-repo-"));
  const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-pr-workspace-"));
  const repoWorkspacePath = join(workspacePath, "repo");
  const artifactRoot = join(workspacePath, "coordinator", "artifacts");
  mkdirSync(join(repoPath, ".git"), { recursive: true });
  mkdirSync(join(repoWorkspacePath, ".git"), { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, "pr-body.md"), "# PR\n\nbody");
  writeFileSync(join(artifactRoot, "merge-approval.md"), "# Merge\n\napprove?");

  const ids = withDatabase(databasePath, (context) => {
    const project = createProject(context, {
      id: "project-pr",
      name: "pr",
      repoPath,
      defaultBranch: "main",
      prProviderKind: "github"
    });
    const task = createTask(context, { id: "task-pr", projectId: project.id, title: "pr task" });
    const attempt = createAttempt(context, { id: "attempt-pr", projectId: project.id, taskId: task.id });
    const workspace = createWorkspace(context, {
      id: "workspace-pr",
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      status: "ready",
      workspacePath,
      repoPath: repoWorkspacePath,
      branch: "coordinator/task-pr/attempt-pr",
      baseBranch: "main"
    });
    context.db
      .prepare(
        `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id, handoff_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run("workflow-pr", project.id, task.id, attempt.id, "feature", "handoff", "inner-pr", "pr_ready");
    return { projectId: project.id, taskId: task.id, attemptId: attempt.id, workspaceId: workspace.id };
  });

  return { ...ids, repoPath, workspacePath, repoWorkspacePath, artifactRoot };
}

describe("PR/MR provider runtime", () => {
  it("fake provider 可创建 PR/MR 并复用 idempotency key", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);

    const result = withDatabase(databasePath, (context) =>
      createPullRequestRuntime(context, {
        taskId: "task-pr",
        title: "实现 PR",
        bodyArtifact: "pr-body.md",
        provider: new FakePullRequestProvider()
      })
    );

    expect(result.pullRequest).toMatchObject({
      status: "open",
      headBranch: "coordinator/task-pr/attempt-pr",
      baseBranch: "main",
      bodyArtifactPath: "pr-body.md"
    });
    expect(result.reused).toBe(false);

    const persisted = withDatabase(databasePath, (context) => ({
      pr: getLatestPullRequestByTask(context, "task-pr"),
      operation: getOperationByIdempotencyKey(context, "pr:create:attempt-pr:coordinator/task-pr/attempt-pr")
    }));
    expect(persisted.pr?.id).toBe(result.pullRequest.id);
    expect(persisted.operation).toMatchObject({ kind: "pr:create", status: "succeeded" });
  });

  it("CLI provider 使用窄命令创建 GitHub PR", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createReadyPrFixture(databasePath);
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const runner: PullRequestProviderRunner = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (args[0] === "pr" && args[1] === "list") {
        return "[]";
      }
      return "https://github.com/acme/repo/pull/1\n";
    };

    withDatabase(databasePath, (context) =>
      createPullRequestRuntime(context, {
        taskId: "task-pr",
        title: "实现 PR",
        bodyArtifact: "pr-body.md",
        provider: new CliPullRequestProvider("github", runner)
      })
    );

    expect(calls[0]).toMatchObject({
      command: "gh",
      cwd: fixture.workspacePath
    });
    expect(calls[0].args).toEqual([
      "pr",
      "list",
      "--head",
      "coordinator/task-pr/attempt-pr",
      "--base",
      "main",
      "--state",
      "open",
      "--json",
      "url,headRefName,baseRefName,headRefOid,baseRefOid"
    ]);
    expect(calls[1]).toMatchObject({
      command: "gh",
      cwd: fixture.workspacePath
    });
    expect(calls[1].args).toEqual([
      "pr",
      "create",
      "--title",
      "实现 PR",
      "--body",
      "# PR\n\nbody",
      "--base",
      "main",
      "--head",
      "coordinator/task-pr/attempt-pr",
      "--no-maintainer-edit"
    ]);
  });

  it("缺少 workflow pr_ready handoff 时拒绝创建 PR/MR", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    withDatabase(databasePath, (context) => {
      context.db.prepare("UPDATE workflow_runs SET handoff_kind = ? WHERE id = ?").run("blocked", "workflow-pr");
    });

    expect(() =>
      withDatabase(databasePath, (context) =>
        createPullRequestRuntime(context, {
          taskId: "task-pr",
          title: "实现 PR",
          bodyArtifact: "pr-body.md",
          provider: new FakePullRequestProvider()
        })
      )
    ).toThrow(/pr_ready/);
  });

  it("create 前 inspect 到已有 PR/MR 时复用并标记 reconciled", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const provider = new ExistingPrProvider();

    const result = withDatabase(databasePath, (context) =>
      createPullRequestRuntime(context, {
        taskId: "task-pr",
        title: "实现 PR",
        bodyArtifact: "pr-body.md",
        provider
      })
    );

    expect(result.reused).toBe(true);
    expect(provider.createCalls).toBe(0);
    const operation = withDatabase(databasePath, (context) =>
      getOperationByIdempotencyKey(context, "pr:create:attempt-pr:coordinator/task-pr/attempt-pr")
    );
    expect(operation).toMatchObject({ status: "reconciled" });
  });

  it("inspect 失败会阻断 create，而不是误判为不存在", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const provider = new FailingInspectProvider();

    expect(() =>
      withDatabase(databasePath, (context) =>
        createPullRequestRuntime(context, {
          taskId: "task-pr",
          title: "实现 PR",
          bodyArtifact: "pr-body.md",
          provider
        })
      )
    ).toThrow(/inspect failed/);
  });

  it("inspect 输出 malformed JSON 时阻断 create", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const runner: PullRequestProviderRunner = () => "not-json";

    expect(() =>
      withDatabase(databasePath, (context) =>
        createPullRequestRuntime(context, {
          taskId: "task-pr",
          title: "实现 PR",
          bodyArtifact: "pr-body.md",
          provider: new CliPullRequestProvider("github", runner)
        })
      )
    ).toThrow(/无法解析/);
  });

  it("create operation running 时若 inspect 到外部 PR/MR 已存在则对账成功", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const provider = new ExistingPrProvider();

    const result = withDatabase(databasePath, (context) => {
      const operation = createOperation(context, {
        idempotencyKey: "pr:create:attempt-pr:coordinator/task-pr/attempt-pr",
        kind: "pr:create",
        projectId: "project-pr",
        taskId: "task-pr",
        attemptId: "attempt-pr"
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "running",
        lastObservedState: { phase: "previous-create" }
      });
      return createPullRequestRuntime(context, {
        taskId: "task-pr",
        title: "实现 PR",
        bodyArtifact: "pr-body.md",
        provider
      });
    });

    expect(result.reused).toBe(true);
    expect(provider.createCalls).toBe(0);
    const operation = withDatabase(databasePath, (context) =>
      getOperationByIdempotencyKey(context, "pr:create:attempt-pr:coordinator/task-pr/attempt-pr")
    );
    expect(operation).toMatchObject({ status: "reconciled" });
  });

  it("create 前 inspect 到外部 PR/MR 与当前 intent 冲突时不继续 create", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const provider = new ConflictingExistingPrProvider();

    expect(() =>
      withDatabase(databasePath, (context) =>
        createPullRequestRuntime(context, {
          taskId: "task-pr",
          title: "实现 PR",
          bodyArtifact: "pr-body.md",
          provider
        })
      )
    ).toThrow(/conflicts/);

    const operation = withDatabase(databasePath, (context) =>
      getOperationByIdempotencyKey(context, "pr:create:attempt-pr:coordinator/task-pr/attempt-pr")
    );
    expect(provider.createCalls).toBe(0);
    expect(operation).toMatchObject({ status: "unknown", failureCode: "pr_external_conflicts_intent" });
  });

  it("inspect review 后 request approval，approval 有效后才能 merge", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);

    const merged = withDatabase(databasePath, (context) => {
      const created = createPullRequestRuntime(context, {
        taskId: "task-pr",
        title: "实现 PR",
        bodyArtifact: "pr-body.md",
        provider: new FakePullRequestProvider()
      });
      const reviewed = inspectPullRequestReviewRuntime(context, {
        taskId: "task-pr",
        prId: created.pullRequest.id,
        provider: new FakePullRequestProvider()
      });
      const approval = requestMergeApprovalRuntime(context, {
        taskId: "task-pr",
        prId: reviewed.pullRequest.id,
        bodyArtifact: "merge-approval.md"
      });
      approveMergeRuntime(context, {
        taskId: "task-pr",
        prId: reviewed.pullRequest.id,
        humanRequestId: approval.humanRequest.id,
        actor: "operator"
      });
      return mergeAfterApprovalRuntime(context, {
        taskId: "task-pr",
        prId: reviewed.pullRequest.id,
        provider: new FakePullRequestProvider()
      });
    });

    expect(merged.pullRequest).toMatchObject({ status: "merged" });
  });

  it("provider 返回 GitHub APPROVED 时会归一化为 approved 并允许请求 approval", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);

    const result = withDatabase(databasePath, (context) => {
      const created = createPullRequestRuntime(context, {
        taskId: "task-pr",
        title: "实现 PR",
        bodyArtifact: "pr-body.md",
        provider: new FakePullRequestProvider()
      });
      const reviewed = inspectPullRequestReviewRuntime(context, {
        taskId: "task-pr",
        prId: created.pullRequest.id,
        provider: new UppercaseApprovedProvider()
      });
      const approval = requestMergeApprovalRuntime(context, {
        taskId: "task-pr",
        prId: reviewed.pullRequest.id,
        bodyArtifact: "merge-approval.md"
      });
      return { reviewed: reviewed.pullRequest, approval: approval.humanRequest };
    });

    expect(result.reviewed.reviewStatus).toBe("approved");
    expect(result.approval.status).toBe("pending");
  });

  it("provider 返回 GitHub CHANGES_REQUESTED 时会归一化并失效旧 approval", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const state = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      createApprovedMergeRequest(context, pr.id);
      const updated = inspectPullRequestReviewRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        provider: new UppercaseChangesRequestedProvider()
      });
      return {
        pr: updated.pullRequest,
        approval: getHumanRequest(context, "approval-ready-merge")
      };
    });

    expect(state.pr.reviewStatus).toBe("changes_requested");
    expect(state.approval).toMatchObject({ status: "rejected", approvalValid: false });
  });

  it("approval snapshot 与 PR head 不匹配时拒绝 merge", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);

    expect(() =>
      withDatabase(databasePath, (context) => {
        const created = createPullRequestRuntime(context, {
          taskId: "task-pr",
          title: "实现 PR",
          bodyArtifact: "pr-body.md",
          provider: new FakePullRequestProvider()
        });
        const reviewed = inspectPullRequestReviewRuntime(context, {
          taskId: "task-pr",
          prId: created.pullRequest.id,
          provider: new FakePullRequestProvider()
        });
        const approval = requestMergeApprovalRuntime(context, {
          taskId: "task-pr",
          prId: reviewed.pullRequest.id,
          bodyArtifact: "merge-approval.md"
        });
        approveMergeRuntime(context, {
          taskId: "task-pr",
          prId: reviewed.pullRequest.id,
          humanRequestId: approval.humanRequest.id,
          actor: "operator",
          headSha: "stale-head"
        });
        mergeAfterApprovalRuntime(context, {
          taskId: "task-pr",
          prId: reviewed.pullRequest.id,
          provider: new FakePullRequestProvider()
        });
      })
    ).toThrow(PullRequestProviderError);
  });

  it("merge readiness snapshot 不完整时拒绝请求 approval", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);

    expect(() =>
      withDatabase(databasePath, (context) => {
        const created = createPullRequestRuntime(context, {
          taskId: "task-pr",
          title: "实现 PR",
          bodyArtifact: "pr-body.md",
          provider: new FakePullRequestProvider()
        });
        requestMergeApprovalRuntime(context, {
          taskId: "task-pr",
          prId: created.pullRequest.id,
          bodyArtifact: "merge-approval.md"
        });
      })
    ).toThrow(/review 尚未 clean|snapshot 不完整/);
  });

  it("旧 approval snapshot 不会被新 snapshot 复用", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);

    const result = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      const oldApproval = createApprovedMergeRequest(context, pr.id);
      updatePullRequest(context, {
        prId: pr.id,
        expectedStateVersion: pr.stateVersion,
        headSha: "head-2",
        validationRunId: "validation-2"
      });
      return requestMergeApprovalRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        bodyArtifact: "merge-approval.md"
      });
    });

    expect(result.humanRequest.id).not.toBe("approval-ready-merge");
  });

  it("旧 pending approval snapshot 不匹配时会失效并创建新 approval", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);

    const result = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      createPendingMergeRequest(context, pr.id);
      updatePullRequest(context, {
        prId: pr.id,
        expectedStateVersion: pr.stateVersion,
        headSha: "head-2",
        validationRunId: "validation-2"
      });
      return requestMergeApprovalRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        bodyArtifact: "merge-approval.md"
      });
    });

    expect(result.humanRequest.id).not.toBe("pending-ready-merge");
    const old = withDatabase(databasePath, (context) =>
      context.db.prepare("SELECT status, approval_valid FROM human_requests WHERE id = ?").get("pending-ready-merge")
    ) as { status: string; approval_valid: number };
    expect(old).toMatchObject({ status: "rejected", approval_valid: 0 });
  });

  it("merge 前重新 inspect，远端 head 变化时拒绝 merge 并释放 lock", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const provider = new ChangedHeadProvider();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const pr = createReadyMergePr(context);
        const approval = createApprovedMergeRequest(context, pr.id);
        expect(approval.status).toBe("approved");
        mergeAfterApprovalRuntime(context, {
          taskId: "task-pr",
          prId: pr.id,
          provider
        });
      })
    ).toThrow(/head sha mismatch/);

    const state = withDatabase(databasePath, (context) => ({
      lock: getLockForTest(context, "pr-merge", "pr-ready-merge"),
      operation: getOperationByIdempotencyKey(context, "merge:pr-ready-merge:head-1:base-1:validation-1")
    }));
    expect(state.lock).toBeUndefined();
    expect(state.operation).toMatchObject({ status: "unknown" });
  });

  it("provider merge 抛错后 operation 进入 unknown 且释放 merge lock", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const provider = new ThrowingMergeProvider();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const pr = createReadyMergePr(context);
        createApprovedMergeRequest(context, pr.id);
        mergeAfterApprovalRuntime(context, {
          taskId: "task-pr",
          prId: pr.id,
          provider
        });
      })
    ).toThrow(/merge failed/);

    const state = withDatabase(databasePath, (context) => ({
      lock: getLockForTest(context, "pr-merge", "pr-ready-merge"),
      operation: getOperationByIdempotencyKey(context, "merge:pr-ready-merge:head-1:base-1:validation-1")
    }));
    expect(state.lock).toBeUndefined();
    expect(state.operation).toMatchObject({ status: "unknown" });
  });

  it("inspect review 发现 snapshot 变化时失效旧 approval", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const state = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      createApprovedMergeRequest(context, pr.id);
      const updated = inspectPullRequestReviewRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        provider: new ChangedHeadProvider()
      });
      return {
        pr: updated.pullRequest,
        approval: getHumanRequest(context, "approval-ready-merge"),
        events: listTaskEvents(context, "task-pr")
      };
    });

    expect(state.pr.headSha).toBe("head-2");
    expect(state.approval).toMatchObject({ status: "rejected", approvalValid: false });
    expect(state.events.map((event) => event.type)).toContain("pr.merge_approval_invalidated");
  });

  it("inspect review 发现 blocking review 时失效旧 approval", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const state = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      createApprovedMergeRequest(context, pr.id);
      const updated = inspectPullRequestReviewRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        provider: new BlockingReviewProvider()
      });
      return {
        pr: updated.pullRequest,
        approval: getHumanRequest(context, "approval-ready-merge")
      };
    });

    expect(state.pr.reviewStatus).toBe("changes_requested");
    expect(state.approval).toMatchObject({ status: "rejected", approvalValid: false });
  });

  it("reconcile 发现 closed/unmerged 时进入 operator attention，不自动 completed", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const state = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      const result = reconcilePullRequestRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        provider: new ClosedUnmergedProvider()
      });
      return {
        result,
        task: context.db.prepare("SELECT status FROM tasks WHERE id = ?").get("task-pr") as { status: string },
        operation: getOperationByIdempotencyKey(context, "pr:reconcile:pr-ready-merge:0")
      };
    });

    expect(state.result).toMatchObject({ decisionKind: "operator_attention", reasonCode: "pr-closed-unmerged" });
    expect(state.task.status).not.toBe("completed");
    expect(state.operation).toMatchObject({ status: "unknown" });
  });

  it("reconcile 发现 already merged 时对账 completed", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const state = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      const result = reconcilePullRequestRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        provider: new AlreadyMergedProvider()
      });
      return {
        result,
        task: context.db.prepare("SELECT status FROM tasks WHERE id = ?").get("task-pr") as { status: string },
        pr: getLatestPullRequestByTask(context, "task-pr"),
        operation: getOperationByIdempotencyKey(context, "pr:reconcile:pr-ready-merge:0")
      };
    });

    expect(state.result).toMatchObject({ decisionKind: "reconciled", reasonCode: "pr-external-merged" });
    expect(state.task.status).toBe("completed");
    expect(state.pr).toMatchObject({ status: "merged" });
    expect(state.operation).toMatchObject({ status: "reconciled" });
  });

  it("merge race 中 PR 已 merged 时对账成功而不是重复 merge", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const provider = new AlreadyMergedProvider();

    const result = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      createApprovedMergeRequest(context, pr.id);
      return mergeAfterApprovalRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        provider
      });
    });

    expect(result.pullRequest).toMatchObject({ status: "merged" });
    expect(provider.mergeCalls).toBe(0);
  });

  it("merge conflict 分类为 conflict 并释放 lock", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);

    expect(() =>
      withDatabase(databasePath, (context) => {
        const pr = createReadyMergePr(context);
        createApprovedMergeRequest(context, pr.id);
        mergeAfterApprovalRuntime(context, {
          taskId: "task-pr",
          prId: pr.id,
          provider: new ConflictProvider()
        });
      })
    ).toThrow(/conflict/);

    const state = withDatabase(databasePath, (context) => ({
      lock: getLockForTest(context, "pr-merge", "pr-ready-merge"),
      operation: getOperationByIdempotencyKey(context, "merge:pr-ready-merge:head-1:base-1:validation-1")
    }));
    expect(state.lock).toBeUndefined();
    expect(state.operation).toMatchObject({ status: "unknown" });
    expect(state.operation?.lastObservedState).toMatchObject({ failureKind: "conflict" });
  });

  it("provider auth missing 不自动重试并写入窄 recovery event", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const state = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      const result = reconcilePullRequestRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        provider: new AuthMissingProvider(),
        retryAllowed: true
      });
      return {
        result,
        operation: getOperationByIdempotencyKey(context, "pr:reconcile:pr-ready-merge:0"),
        events: listTaskEvents(context, "task-pr")
      };
    });

    expect(state.result).toMatchObject({ decisionKind: "operator_attention", reasonCode: "pr-provider-auth-missing" });
    expect(state.operation).toMatchObject({ status: "unknown", failureCode: "auth_missing" });
    const event = state.events.find((item) => item.type === "pr.recovery_decision");
    expect(JSON.stringify(event?.payload)).not.toContain("provider raw");
  });

  it("provider timeout 在 retryAllowed 时封口 operation 为 reconciled 以等待 retry 调度", () => {
    const databasePath = createMigratedDatabase();
    createReadyPrFixture(databasePath);
    const state = withDatabase(databasePath, (context) => {
      const pr = createReadyMergePr(context);
      const result = reconcilePullRequestRuntime(context, {
        taskId: "task-pr",
        prId: pr.id,
        provider: new TimeoutProvider(),
        retryAllowed: true
      });
      return {
        result,
        operation: getOperationByIdempotencyKey(context, "pr:reconcile:pr-ready-merge:0")
      };
    });

    expect(state.result).toMatchObject({ decisionKind: "retry", reasonCode: "pr-provider-timeout" });
    expect(state.operation).toMatchObject({ status: "reconciled", failureCode: "timeout" });
    expect(state.operation?.lastObservedState).toMatchObject({ failureKind: "timeout" });
  });
});

function createReadyMergePr(context: DbContext) {
  return createPullRequest(context, {
    id: "pr-ready-merge",
    projectId: "project-pr",
    taskId: "task-pr",
    attemptId: "attempt-pr",
    providerKind: "github",
    status: "open",
    headBranch: "coordinator/task-pr/attempt-pr",
    baseBranch: "main",
    headSha: "head-1",
    baseSha: "base-1",
    reviewStatus: "clean",
    validationRunId: "validation-1",
    mergeStrategy: "squash"
  });
}

function getLockForTest(context: DbContext, resourceKind: string, resourceId: string) {
  return context.db
    .prepare("SELECT * FROM locks WHERE resource_kind = ? AND resource_id = ?")
    .get(resourceKind, resourceId);
}

function createApprovedMergeRequest(context: DbContext, prId: string) {
  return createHumanRequest(context, {
    id: "approval-ready-merge",
    projectId: "project-pr",
    taskId: "task-pr",
    attemptId: "attempt-pr",
    prId,
    blockedKey: `merge:${prId}`,
    kind: "merge_approval",
    status: "approved",
    questionArtifactPath: "merge-approval.md",
    approvalSnapshot: {
      headSha: "head-1",
      baseSha: "base-1",
      validationRunId: "validation-1",
      mergeStrategy: "squash",
      valid: true
    }
  });
}

function createPendingMergeRequest(context: DbContext, prId: string) {
  return createHumanRequest(context, {
    id: "pending-ready-merge",
    projectId: "project-pr",
    taskId: "task-pr",
    attemptId: "attempt-pr",
    prId,
    blockedKey: `merge:${prId}`,
    kind: "merge_approval",
    status: "pending",
    questionArtifactPath: "merge-approval.md",
    approvalSnapshot: {
      headSha: "head-1",
      baseSha: "base-1",
      validationRunId: "validation-1",
      mergeStrategy: "squash",
      valid: true
    }
  });
}

class ExistingPrProvider extends FakePullRequestProvider {
  createCalls = 0;

  inspectExisting(input: PullRequestProviderInspectExistingInput): PullRequestProviderInspectExistingResult {
    return {
      state: "found",
      pullRequest: {
        externalId: "existing-pr-1",
        url: "https://example.com/existing-pr-1",
        headBranch: input.headBranch,
        baseBranch: input.baseBranch,
        headSha: "existing-head",
        baseSha: "existing-base"
      }
    };
  }

  create(input: PullRequestProviderCreateInput): PullRequestProviderCreateResult {
    this.createCalls += 1;
    return super.create(input);
  }
}

class ConflictingExistingPrProvider extends ExistingPrProvider {
  inspectExisting(input: PullRequestProviderInspectExistingInput): PullRequestProviderInspectExistingResult {
    return {
      state: "found",
      pullRequest: {
        externalId: "conflicting-pr-1",
        url: "https://example.com/conflicting-pr-1",
        headBranch: input.headBranch,
        baseBranch: "release/other",
        headSha: "conflicting-head",
        baseSha: "conflicting-base"
      }
    };
  }
}

class FailingInspectProvider extends FakePullRequestProvider {
  inspectExisting(_input: PullRequestProviderInspectExistingInput): PullRequestProviderInspectExistingResult {
    throw new Error("inspect failed");
  }
}

class ChangedHeadProvider extends FakePullRequestProvider {
  inspectReview(input: PullRequestProviderReviewInput) {
    return {
      reviewStatus: "clean",
      reviewSummary: "changed head",
      headSha: "head-2",
      baseSha: "base-1",
      validationRunId: "validation-1",
      mergeable: true,
      url: input.pr.url
    };
  }
}

class BlockingReviewProvider extends FakePullRequestProvider {
  inspectReview(input: PullRequestProviderReviewInput) {
    return {
      reviewStatus: "changes_requested",
      reviewSummary: "blocking review",
      headSha: input.pr.headSha,
      baseSha: input.pr.baseSha,
      validationRunId: input.pr.validationRunId,
      mergeable: false,
      url: input.pr.url
    };
  }
}

class UppercaseApprovedProvider extends FakePullRequestProvider {
  inspectReview(input: PullRequestProviderReviewInput) {
    return {
      reviewStatus: "APPROVED",
      reviewSummary: "approved",
      headSha: input.pr.headSha,
      baseSha: input.pr.baseSha,
      validationRunId: input.pr.validationRunId ?? "validation-uppercase",
      mergeable: true,
      url: input.pr.url
    };
  }
}

class UppercaseChangesRequestedProvider extends FakePullRequestProvider {
  inspectReview(input: PullRequestProviderReviewInput) {
    return {
      reviewStatus: "CHANGES_REQUESTED",
      reviewSummary: "changes requested",
      headSha: input.pr.headSha,
      baseSha: input.pr.baseSha,
      validationRunId: input.pr.validationRunId,
      mergeable: false,
      url: input.pr.url
    };
  }
}

class ThrowingMergeProvider extends FakePullRequestProvider implements PullRequestProvider {
  inspectReview(input: PullRequestProviderReviewInput) {
    return {
      reviewStatus: "clean",
      reviewSummary: "ready",
      headSha: "head-1",
      baseSha: "base-1",
      validationRunId: "validation-1",
      mergeable: true,
      url: input.pr.url
    };
  }

  merge(_input: PullRequestProviderMergeInput): ReturnType<FakePullRequestProvider["merge"]> {
    throw new Error("merge failed");
  }
}

class ClosedUnmergedProvider extends FakePullRequestProvider {
  inspectReview(input: PullRequestProviderReviewInput): PullRequestProviderReviewResult {
    return {
      reviewStatus: "closed",
      reviewSummary: "closed without merge",
      headSha: input.pr.headSha,
      baseSha: input.pr.baseSha,
      validationRunId: input.pr.validationRunId,
      mergeable: false,
      url: input.pr.url
    };
  }
}

class AlreadyMergedProvider extends FakePullRequestProvider {
  mergeCalls = 0;

  inspectReview(input: PullRequestProviderReviewInput): PullRequestProviderReviewResult {
    return {
      reviewStatus: "merged",
      reviewSummary: "already merged",
      headSha: input.pr.headSha,
      baseSha: input.pr.baseSha,
      validationRunId: input.pr.validationRunId,
      mergeable: false,
      url: input.pr.url
    };
  }

  merge(input: PullRequestProviderMergeInput): ReturnType<FakePullRequestProvider["merge"]> {
    this.mergeCalls += 1;
    return super.merge(input);
  }
}

class ConflictProvider extends FakePullRequestProvider {
  inspectReview(input: PullRequestProviderReviewInput): PullRequestProviderReviewResult {
    return {
      reviewStatus: "clean",
      reviewSummary: "ready",
      headSha: input.pr.headSha,
      baseSha: input.pr.baseSha,
      validationRunId: input.pr.validationRunId,
      mergeable: true,
      url: input.pr.url
    };
  }

  merge(_input: PullRequestProviderMergeInput): ReturnType<FakePullRequestProvider["merge"]> {
    throw new Error("merge conflict");
  }
}

class AuthMissingProvider extends FakePullRequestProvider {
  inspectReview(_input: PullRequestProviderReviewInput): PullRequestProviderReviewResult {
    throw new Error("auth missing");
  }
}

class TimeoutProvider extends FakePullRequestProvider {
  inspectReview(_input: PullRequestProviderReviewInput): PullRequestProviderReviewResult {
    throw new Error("timeout");
  }
}
