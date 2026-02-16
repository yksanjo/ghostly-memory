// Core types for Ghostly Memory Bank

export interface TerminalEvent {
  timestamp: number;
  cwd: string;
  git_branch: string | null;
  command: string;
  exit_code: number;
  stderr: string;
  stdout_truncated: string;
  session_id: string;
  project_hash: string;
}

export interface Episode {
  id?: number;
  project_hash: string;
  directory: string;
  git_branch: string | null;
  problem_summary: string;
  environment: string;
  fix_sequence: string;
  keywords: string;
  embedding: number[] | null;
  first_seen: number;
  last_seen: number;
  occurrence_count: number;
}

export interface RawEvent {
  id?: number;
  episode_id: number | null;
  timestamp: number;
  cwd: string;
  git_branch: string | null;
  command: string;
  exit_code: number;
  stderr: string;
  stdout_truncated: string;
  session_id: string;
}

export interface RetrievalResult {
  episode: Episode;
  similarity: number;
  confidence: number;
}

export interface RetrievalContext {
  cwd: string;
  command: string;
  exit_code: number;
  stderr: string;
  git_branch: string | null;
  project_hash: string;
}

export const ERROR_PATTERNS = [
  'error',
  'fail',
  'failed',
  'failure',
  'exception',
  'fatal',
  'E ',
  'ENOENT',
  'ECONNREFUSED',
  'EACCES',
  'ENOEXEC',
  'ERR_',
  'panic',
  ' Segmentation fault',
  'core dumped',
];

export const PROJECT_HASH_ALIASES = [
  '.git',
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
];
