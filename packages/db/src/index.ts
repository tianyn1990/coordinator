import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationRecord = {
  id: string;
  applied: boolean;
};

export type MigrationSummary = {
  databasePath: string;
  applied: MigrationRecord[];
};

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function defaultMigrationsDir(): string {
  return join(moduleDir, "..", "migrations");
}

export function openDatabase(databasePath: string): DatabaseSync {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function runMigrations(databasePath: string, migrationsDir = defaultMigrationsDir()): MigrationSummary {
  const db = openDatabase(databasePath);
  try {
    ensureMigrationTable(db);
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const applied: MigrationRecord[] = [];
    db.exec("BEGIN");
    try {
      for (const file of files) {
        const exists = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(file);
        if (exists) {
          applied.push({ id: file, applied: false });
          continue;
        }

        const sql = readFileSync(join(migrationsDir, file), "utf8");
        // migration 与记录放在同一事务中，保证重启后能明确知道执行边界。
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
        applied.push({ id: file, applied: true });
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return { databasePath, applied };
  } finally {
    db.close();
  }
}

function ensureMigrationTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
