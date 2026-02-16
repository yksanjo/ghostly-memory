import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Episode, RawEvent } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'ghostly-memory.db');

let db: SqlJsDatabase | null = null;
let SQL: any = null;

// Initialize the database
async function initDb(): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  
  if (!db) {
    // Try to load existing database
    try {
      if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
      } else {
        db = new SQL.Database();
      }
    } catch {
      db = new SQL.Database();
    }
    
    initSchema();
  }
}

function initSchema(): void {
  const database = db!;
  
  // Episodes table - stores extracted problem→fix episodes
  database.run(`
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_hash TEXT NOT NULL,
      directory TEXT NOT NULL,
      git_branch TEXT,
      problem_summary TEXT NOT NULL,
      environment TEXT,
      fix_sequence TEXT NOT NULL,
      keywords TEXT,
      embedding BLOB,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      occurrence_count INTEGER DEFAULT 1
    )
  `);
  
  // Raw events table - stores individual terminal events
  database.run(`
    CREATE TABLE IF NOT EXISTS raw_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER,
      timestamp INTEGER NOT NULL,
      cwd TEXT NOT NULL,
      git_branch TEXT,
      command TEXT NOT NULL,
      exit_code INTEGER,
      stderr TEXT,
      stdout_truncated TEXT,
      session_id TEXT,
      FOREIGN KEY (episode_id) REFERENCES episodes(id)
    )
  `);
  
  // Create indexes
  database.run(`CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes(project_hash)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_episodes_directory ON episodes(directory)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_raw_events_cwd ON raw_events(cwd)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_raw_events_timestamp ON raw_events(timestamp)`);
}

// Save database to file
function saveDb(): void {
  if (!db) return;
  
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    
    // Ensure directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    fs.writeFileSync(DB_PATH, buffer);
  } catch (error) {
    console.error('Failed to save database:', error);
  }
}

export async function getDb(): Promise<SqlJsDatabase> {
  await initDb();
  return db!;
}

// Episode operations
export function insertEpisode(episode: Omit<Episode, 'id'>): number {
  const database = db!;
  
  database.run(`
    INSERT INTO episodes (
      project_hash, directory, git_branch, problem_summary, 
      environment, fix_sequence, keywords, embedding,
      first_seen, last_seen, occurrence_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    episode.project_hash,
    episode.directory,
    episode.git_branch,
    episode.problem_summary,
    episode.environment,
    episode.fix_sequence,
    episode.keywords,
    episode.embedding ? new Uint8Array(episode.embedding) : null,
    episode.first_seen,
    episode.last_seen,
    episode.occurrence_count,
  ]);
  
  const result = database.exec('SELECT last_insert_rowid() as id');
  const id = result[0]?.values[0]?.[0] as number;
  
  saveDb();
  return id;
}

export function updateEpisode(id: number, updates: Partial<Episode>): void {
  const database = db!;
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.last_seen !== undefined) {
    fields.push('last_seen = ?');
    values.push(updates.last_seen);
  }
  if (updates.occurrence_count !== undefined) {
    fields.push('occurrence_count = ?');
    values.push(updates.occurrence_count);
  }
  if (updates.embedding !== undefined) {
    fields.push('embedding = ?');
    values.push(updates.embedding ? new Uint8Array(updates.embedding) : null);
  }
  
  if (fields.length > 0) {
    values.push(id);
    database.run(`UPDATE episodes SET ${fields.join(', ')} WHERE id = ?`, values);
    saveDb();
  }
}

export function findSimilarEpisode(projectHash: string, problemSummary: string): Episode | null {
  const database = db!;
  const result = database.exec(
    `SELECT * FROM episodes WHERE project_hash = ? AND problem_summary = ? LIMIT 1`,
    [projectHash, problemSummary]
  );
  
  if (!result[0]) return null;
  
  return rowToEpisode(result[0].columns, result[0].values[0]);
}

export function searchEpisodesByText(text: string, limit: number = 5): Episode[] {
  const database = db!;
  const pattern = `%${text}%`;
  
  const result = database.exec(
    `SELECT * FROM episodes WHERE problem_summary LIKE ? OR keywords LIKE ? ORDER BY last_seen DESC LIMIT ?`,
    [pattern, pattern, limit]
  );
  
  if (!result[0]) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(row => rowToEpisode(cols, row));
}

export function getRecentEpisodes(limit: number = 10): Episode[] {
  const database = db!;
  const result = database.exec(
    `SELECT * FROM episodes ORDER BY last_seen DESC LIMIT ?`,
    [limit]
  );
  
  if (!result[0]) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(row => rowToEpisode(cols, row));
}

export function getEpisodesByProject(projectHash: string): Episode[] {
  const database = db!;
  const result = database.exec(
    `SELECT * FROM episodes WHERE project_hash = ? ORDER BY last_seen DESC`,
    [projectHash]
  );
  
  if (!result[0]) return [];
  
  return result[0].values.map(row => rowToEpisode(result[0].columns, row));
}

export function getAllEpisodesWithEmbeddings(): Episode[] {
  const database = db!;
  const result = database.exec(
    `SELECT * FROM episodes WHERE embedding IS NOT NULL ORDER BY last_seen DESC`
  );
  
  if (!result[0]) return [];
  
  return result[0].values.map(row => rowToEpisode(result[0].columns, row));
}

// Raw event operations
export function insertRawEvent(event: Omit<RawEvent, 'id'>): number {
  const database = db!;
  
  database.run(`
    INSERT INTO raw_events (
      episode_id, timestamp, cwd, git_branch, command,
      exit_code, stderr, stdout_truncated, session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    event.episode_id,
    event.timestamp,
    event.cwd,
    event.git_branch,
    event.command,
    event.exit_code,
    event.stderr,
    event.stdout_truncated,
    event.session_id,
  ]);
  
  const result = database.exec('SELECT last_insert_rowid() as id');
  const id = result[0]?.values[0]?.[0] as number;
  
  saveDb();
  return id;
}

export function getRecentEventsForDirectory(cwd: string, since: number): RawEvent[] {
  const database = db!;
  const result = database.exec(
    `SELECT * FROM raw_events WHERE cwd = ? AND timestamp > ? ORDER BY timestamp DESC`,
    [cwd, since]
  );
  
  if (!result[0]) return [];
  
  const cols = result[0].columns;
  return result[0].values.map(row => rowToRawEvent(cols, row));
}

export function getLastEventForCommand(cwd: string, command: string, withinHours: number = 24): RawEvent | null {
  const database = db!;
  const since = Date.now() - (withinHours * 60 * 60 * 1000);
  
  const result = database.exec(
    `SELECT * FROM raw_events WHERE cwd = ? AND command = ? AND timestamp > ? ORDER BY timestamp DESC LIMIT 1`,
    [cwd, command, since]
  );
  
  if (!result[0]?.values[0]) return null;
  
  return rowToRawEvent(result[0].columns, result[0].values[0]);
}

// Stats
export function getStats(): { totalEpisodes: number; totalEvents: number; projects: number } {
  const database = db!;
  
  const episodesResult = database.exec('SELECT COUNT(*) as count FROM episodes');
  const eventsResult = database.exec('SELECT COUNT(*) as count FROM raw_events');
  const projectsResult = database.exec('SELECT COUNT(DISTINCT project_hash) as count FROM episodes');
  
  return {
    totalEpisodes: (episodesResult[0]?.values[0]?.[0] as number) || 0,
    totalEvents: (eventsResult[0]?.values[0]?.[0] as number) || 0,
    projects: (projectsResult[0]?.values[0]?.[0] as number) || 0,
  };
}

export function clearProject(projectHash: string): void {
  const database = db!;
  database.run('DELETE FROM episodes WHERE project_hash = ?', [projectHash]);
  saveDb();
}

// Helpers
function rowToEpisode(columns: string[], values: any[]): Episode {
  const obj: any = {};
  columns.forEach((col, i) => {
    obj[col] = values[i];
  });
  
  return {
    id: obj.id,
    project_hash: obj.project_hash,
    directory: obj.directory,
    git_branch: obj.git_branch,
    problem_summary: obj.problem_summary,
    environment: obj.environment,
    fix_sequence: obj.fix_sequence,
    keywords: obj.keywords,
    embedding: obj.embedding ? Array.from(new Uint8Array(obj.embedding)) : null,
    first_seen: obj.first_seen,
    last_seen: obj.last_seen,
    occurrence_count: obj.occurrence_count,
  };
}

function rowToRawEvent(columns: string[], values: any[]): RawEvent {
  const obj: any = {};
  columns.forEach((col, i) => {
    obj[col] = values[i];
  });
  
  return {
    id: obj.id,
    episode_id: obj.episode_id,
    timestamp: obj.timestamp,
    cwd: obj.cwd,
    git_branch: obj.git_branch,
    command: obj.command,
    exit_code: obj.exit_code,
    stderr: obj.stderr,
    stdout_truncated: obj.stdout_truncated,
    session_id: obj.session_id,
  };
}

export function closeDb(): void {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}
