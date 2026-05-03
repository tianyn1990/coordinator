import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runMigrations } from "./index.js";

describe("runMigrations", () => {
  it("重复执行时不会重复应用 migration", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-db-")), "test.sqlite");

    const first = runMigrations(databasePath);
    const second = runMigrations(databasePath);

    expect(first.applied).toEqual([
      { id: "0001_metadata.sql", applied: true },
      { id: "0002_core_data_model.sql", applied: true },
      { id: "0003_project_registry.sql", applied: true },
      { id: "0004_workflow_protocol_adapter.sql", applied: true }
    ]);
    expect(second.applied).toEqual([
      { id: "0001_metadata.sql", applied: false },
      { id: "0002_core_data_model.sql", applied: false },
      { id: "0003_project_registry.sql", applied: false },
      { id: "0004_workflow_protocol_adapter.sql", applied: false }
    ]);

    const db = new DatabaseSync(databasePath);
    try {
      const row = db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number };
      expect(row.count).toBe(4);
    } finally {
      db.close();
    }
  });
});
