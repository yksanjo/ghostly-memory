import { TerminalEvent } from '../types.js';
import { hashProjectPath } from '../extraction/index.js';
import { processEvent } from '../extraction/index.js';
import { retrieveAndSuggest } from '../retrieval/index.js';
import { getLastEventForCommand } from '../storage/db.js';
import { execSync } from 'child_process';
import os from 'os';

// Get current git branch
export function getGitBranch(cwd: string): string | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      timeout: 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return branch || null;
  } catch {
    return null;
  }
}

// Get the last command from shell history
export function getLastCommand(): string {
  try {
    const shell = process.env.SHELL || '';
    
    if (shell.includes('zsh')) {
      const history = execSync('history -1', {
        encoding: 'utf-8',
        timeout: 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      // Remove line number
      return history.replace(/^\s*\d+\s+/, '');
    } else if (shell.includes('bash')) {
      const history = execSync('history 1', {
        encoding: 'utf-8',
        timeout: 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return history.replace(/^\s*\d+\s+/, '');
    }
  } catch {
    // Ignore errors
  }
  
  return '';
}

// Get the last exit code
export function getLastExitCode(): number {
  try {
    // Check bash/last exit code
    const code = execSync('echo $?', {
      encoding: 'utf-8',
      timeout: 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return parseInt(code) || 0;
  } catch {
    return 0;
  }
}

// Capture a terminal event from the current shell state
export async function captureEvent(
  command: string,
  exitCode: number,
  stderr: string,
  stdout: string
): Promise<TerminalEvent> {
  const cwd = process.cwd();
  const sessionId = process.env.GHOSTLY_SESSION_ID || `${os.hostname()}-${process.pid}`;
  
  const event: TerminalEvent = {
    timestamp: Date.now(),
    cwd,
    git_branch: getGitBranch(cwd),
    command,
    exit_code: exitCode,
    stderr: stderr.substring(0, 5000), // Truncate to 5KB
    stdout_truncated: stdout.substring(0, 2000), // Truncate to 2KB
    session_id: sessionId,
    project_hash: hashProjectPath(cwd),
  };
  
  return event;
}

// Process and store an event, then retrieve relevant memory
export async function handleTerminalEvent(
  command: string,
  exitCode: number,
  stderr: string,
  stdout: string
): Promise<{ episode: any; suggestion: any } | null> {
  // Capture the event
  const event = await captureEvent(command, exitCode, stderr, stdout);
  
  // Process the event (store and extract episode if error)
  const episode = await processEvent(event);
  
  // Check if we should retrieve a suggestion
  const suggestion = await retrieveAndSuggest({
    cwd: event.cwd,
    command: event.command,
    exit_code: event.exit_code,
    stderr: event.stderr,
    git_branch: event.git_branch,
    project_hash: event.project_hash,
  });
  
  return {
    episode,
    suggestion,
  };
}

// Check if command was repeated within 24 hours
export async function wasCommandRepeated(
  cwd: string,
  command: string
): Promise<boolean> {
  const lastEvent = getLastEventForCommand(cwd, command, 24);
  return lastEvent !== null;
}

// Shell hook script to add to .zshrc or .bashrc
export const SHELL_HOOK_SCRIPT = `
# Ghostly Memory Bank - Terminal Event Capture
# Add this to your .zshrc or .bashrc

ghostly_capture() {
  local last_cmd=$(history -1 | sed 's/^ *[0-9]* *//')
  local exit_code=$?
  local cwd="\$(pwd)"
  
  # Skip empty commands and common noise
  if [ -z "$last_cmd" ] || [ "$last_cmd" = "ghostly_capture" ]; then
    return
  fi
  
  # Get stderr from the last command (if available)
  local stderr=""
  if [ -t 2 ]; then
    # Try to capture last stderr (limited)
  fi
  
  # Call ghostly-memory capture with the event data
  # This would require a daemon or IPC mechanism
  # For MVP, we'll use a simpler approach
}

# Hook into precmd (zsh) or PROMPT_COMMAND (bash)
# ghostly-memory capture --command "$last_cmd" --exit "$exit_code" --cwd "$cwd"
`;

// Generate shell hook for manual setup
export function generateShellHook(): string {
  return `#!/bin/bash
# Ghostly Memory Bank - Shell Hook
# Add to your ~/.bashrc or ~/.zshrc

GHOSTLY_BIN="${process.cwd()}/dist/index.js"

ghostly_track() {
  local last_cmd="\$(history 1 | sed 's/^ *[0-9]* *//')"
  local exit_code=\$?
  
  # Skip if empty or our own commands
  [[ -z "\$last_cmd" ]] && return
  [[ "\$last_cmd" == ghostly_* ]] && return
  [[ "\$last_cmd" == *"ghostly"* ]] && return
  
  # Capture to ghostly-memory (async)
  node "\$GHOSTLY_BIN" capture \\
    --command "\$last_cmd" \\
    --exit \$exit_code \\
    --cwd "\$(pwd)" \\
    --session "\$\$" > /dev/null 2>&1 &
}

# For bash
# PROMPT_COMMAND="ghostly_track;\$PROMPT_COMMAND"

# For zsh
# autoload -Uz add-zsh-hook
# add-zsh-hook precmd ghostly_track
`;
}
