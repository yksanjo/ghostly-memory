import { TerminalEvent, Episode, ERROR_PATTERNS, PROJECT_HASH_ALIASES } from '../types.js';
import { getRecentEventsForDirectory, insertEpisode, findSimilarEpisode, updateEpisode, insertRawEvent } from '../storage/db.js';
import { generateEmbedding, generateEpisodeEmbedding, extractKeywords } from '../storage/embeddings.js';
import CryptoJS from 'crypto-js';
import os from 'os';

// Hash a project path to create a consistent identifier
export function hashProjectPath(cwd: string): string {
  return CryptoJS.MD5(cwd).toString().substring(0, 12);
}

// Detect if output contains an error
export function isError(stderr: string, exitCode: number): boolean {
  if (exitCode !== 0) return true;
  
  const lowerStderr = stderr.toLowerCase();
  return ERROR_PATTERNS.some(pattern => lowerStderr.includes(pattern.toLowerCase()));
}

// Extract key information from an error
export function extractErrorSignature(stderr: string, command: string): string {
  // Extract first line or key error message
  const lines = stderr.split('\n').filter(l => l.trim());
  const firstLine = lines[0] || '';
  
  // Try to extract error code or module name
  const errorMatch = stderr.match(/(Error|Exception):\s*(.+?)(?:\n|$)/i) 
    || stderr.match(/(ERR_\w+)/i)
    || stderr.match(/(\w+\s+error)/i);
  
  if (errorMatch) {
    return errorMatch[1].substring(0, 100);
  }
  
  return firstLine.substring(0, 100);
}

// Get environment context
export function getEnvironment(): string {
  const parts = [
    os.platform(),
    os.arch(),
    process.version,
  ];
  return parts.join(' | ');
}

// Check if a command is likely a fix attempt
export function isFixCommand(command: string): boolean {
  const fixIndicators = [
    'npm install',
    'yarn install',
    'pnpm install',
    'pip install',
    'cargo build',
    'make',
    'cmake',
    'git',
    'apt-get',
    'brew',
    'npm update',
    'yarn upgrade',
  ];
  
  const lower = command.toLowerCase();
  return fixIndicators.some(indicator => lower.includes(indicator.toLowerCase()));
}

// Extract an episode from recent events
export async function extractEpisode(
  errorEvent: TerminalEvent,
  followingCommands: any[]
): Promise<Episode | null> {
  if (followingCommands.length === 0) {
    return null;
  }
  
  const problemSignature = extractErrorSignature(errorEvent.stderr, errorEvent.command);
  const projectHash = hashProjectPath(errorEvent.cwd);
  
  // Check if similar episode already exists
  const existing = findSimilarEpisode(projectHash, problemSignature);
  if (existing) {
    // Update occurrence count
    updateEpisode(existing.id!, {
      last_seen: Date.now(),
      occurrence_count: existing.occurrence_count + 1,
    });
    return null;
  }
  
  // Build fix sequence from following commands
  const fixCommands = followingCommands
    .filter(e => e.exit_code === 0)
    .map(e => e.command)
    .slice(0, 5); // Max 5 commands
  
  const fixSequence = fixCommands.join(' && ') || 'Unknown fix';
  
  // Generate keywords from error and command
  const keywordsText = `${errorEvent.command} ${errorEvent.stderr} ${fixSequence}`;
  const keywords = extractKeywords(keywordsText).join(', ');
  
  // Create episode
  const episode: Omit<Episode, 'id'> = {
    project_hash: projectHash,
    directory: errorEvent.cwd,
    git_branch: errorEvent.git_branch,
    problem_summary: problemSignature,
    environment: getEnvironment(),
    fix_sequence: fixSequence,
    keywords,
    embedding: null,
    first_seen: errorEvent.timestamp,
    last_seen: Date.now(),
    occurrence_count: 1,
  };
  
  // Generate embedding asynchronously
  const embedding = await generateEpisodeEmbedding(episode);
  if (embedding) {
    episode.embedding = embedding;
  }
  
  const id = insertEpisode(episode);
  
  // Store raw events for this episode
  const allEvents = [errorEvent, ...followingCommands];
  for (const event of allEvents) {
    insertRawEvent({
      episode_id: id,
      timestamp: event.timestamp,
      cwd: event.cwd,
      git_branch: event.git_branch,
      command: event.command,
      exit_code: event.exit_code,
      stderr: event.stderr,
      stdout_truncated: event.stdout_truncated,
      session_id: event.session_id,
    });
  }
  
  return { ...episode, id };
}

// Process a terminal event and extract episodes if needed
export async function processEvent(event: TerminalEvent): Promise<Episode | null> {
  // Store raw event
  insertRawEvent({
    episode_id: null,
    timestamp: event.timestamp,
    cwd: event.cwd,
    git_branch: event.git_branch,
    command: event.command,
    exit_code: event.exit_code,
    stderr: event.stderr,
    stdout_truncated: event.stdout_truncated,
    session_id: event.session_id,
  });
  
  // Check if this is an error
  if (!isError(event.stderr, event.exit_code)) {
    return null;
  }
  
  // Get recent events in this directory
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  const recentEvents = await getRecentEventsForDirectory(event.cwd, fiveMinutesAgo);
  
  // Filter to events after the error
  const followingEvents = recentEvents
    .filter(e => e.timestamp > event.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
  
  // Try to extract episode
  return extractEpisode(event, followingEvents);
}

// Summarize an episode for display
export function summarizeEpisode(episode: Episode): string {
  const date = new Date(episode.last_seen);
  const dateStr = date.toLocaleDateString();
  
  return `
Problem: ${episode.problem_summary}
Directory: ${episode.directory}
Fix: ${episode.fix_sequence}
Seen: ${dateStr} (${episode.occurrence_count} times)
  `.trim();
}
