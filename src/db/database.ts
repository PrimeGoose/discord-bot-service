import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { migrations } from './schema.js'

export type Params = Record<string, SQLInputValue>

/**
 * Thin wrapper over Node's built-in `node:sqlite` (no native add-on to compile,
 * which keeps Docker images and CI simple). All access is synchronous: SQLite
 * calls take microseconds and the bot is single-process.
 */
export class Database {
  readonly raw: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private depth = 0

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  run(sql: string, params: Params = {}): { changes: number; lastInsertRowid: number } {
    const result = this.statement(sql).run(params)
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  // Row typing is the caller's contract with the SQL it wrote.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  get<T>(sql: string, params: Params = {}): T | undefined {
    return this.statement(sql).get(params) as T | undefined
  }

  all<T>(sql: string, params: Params = {}): T[] {
    return this.statement(sql).all(params) as T[]
  }

  /** Runs `fn` atomically. Nested calls become savepoints, so repositories can compose. */
  transaction<T>(fn: () => T): T {
    const savepoint = `sp_${this.depth}`
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
    this.depth++
    try {
      const result = fn()
      this.depth--
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
      return result
    } catch (error) {
      this.depth--
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
      throw error
    }
  }

  schemaVersion(): number {
    return this.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0
  }

  close(): void {
    this.statements.clear()
    if (this.raw.isOpen) this.raw.close()
  }

  /** Prepared statements are cached per SQL string. Unknown named params throw, which catches typos. */
  private statement(sql: string): StatementSync {
    let stmt = this.statements.get(sql)
    if (!stmt) {
      stmt = this.raw.prepare(sql)
      this.statements.set(sql, stmt)
    }
    return stmt
  }

  private migrate(): void {
    this.raw.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
    )
    const current = this.schemaVersion()
    for (const m of migrations.filter((x) => x.version > current)) {
      this.transaction(() => {
        this.raw.exec(m.sql)
        this.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (:v, :n, :t)', {
          v: m.version,
          n: m.name,
          t: new Date().toISOString(),
        })
      })
    }
  }
}
