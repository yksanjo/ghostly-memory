# Ghostly Memory Bank - MVP Specification

## Project Overview
- **Project Name**: Ghostly Memory Bank
- **Type**: Terminal Memory Layer / Developer Productivity Tool
- **Core Functionality**: A local-first terminal memory system that captures terminal events, extracts meaningful debugging episodes, indexes them semantically, and surfaces relevant past sessions when similar errors or workflows reoccur.
- **Target Users**: Developers who use Ghostty terminal and want contextual memory of their terminal sessions

## Architecture

```
ghostly-memory/
├── src/
│   ├── capture/          # Event capture layer
│   │   └── index.ts      # Terminal event listener
│   ├── storage/          # SQLite + embeddings
│   │   ├── db.ts        # SQLite operations
│   │   └── embeddings.ts # Embedding generation
│   ├── extraction/       # Episode extraction
│   │   └── index.ts     # Heuristic episode logic
│   ├── retrieval/       # Context-aware retrieval
│   │   └── index.ts     # Similarity search + triggers
│   ├── cli/             # CLI interface
│   │   └── index.ts
│   └── index.ts         # Main entry
├── data/                # Local storage
└── package.json
```

## Database Schema (SQLite)

### Table: episodes
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| project_hash | TEXT | Hash of project path |
| directory | TEXT | Working directory |
| git_branch | TEXT | Current git branch |
| problem_summary | TEXT | What went wrong |
| environment | TEXT | Context (packages, OS, etc) |
| fix_sequence | TEXT | Commands that fixed it |
| keywords | TEXT | Searchable keywords |
| embedding | BLOB | Vector embedding |
| first_seen | INTEGER | Timestamp |
| last_seen | INTEGER | Timestamp |
| occurrence_count | INTEGER | How many times this occurred |

### Table: raw_events
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| episode_id | INTEGER | FK to episodes |
| timestamp | INTEGER | Unix timestamp |
| cwd | TEXT | Working directory |
| git_branch | TEXT | Git branch |
| command | TEXT | Command executed |
| exit_code | INTEGER | Exit code |
| stderr | TEXT | Error output (truncated) |
| stdout_truncated | TEXT | Output (truncated) |
| session_id | TEXT | Terminal session ID |

## Event Capture Specification

### Terminal Events to Capture
```typescript
interface TerminalEvent {
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
```

### MVP: Capture via Shell Hook
- Use shell `PROMPT_COMMAND` or `zsh` precmd
- Capture: cwd, last command, exit code
- Optional git branch detection

## Episode Extraction Heuristics (MVP)

### Store as Episode When:
1. **Error Detected**
   - exit_code !== 0
   - OR stderr contains: error|fail|exception|fatal|E

2. **Multi-step Fix Sequence**
   - 3+ commands in same directory within 5 minutes
   - Ends with success after failure

### Episode Structure
```typescript
interface Episode {
  problem_signature: string;    // Hash of error type
  directory: string;
  git_branch: string | null;
  problem_summary: string;      // What went wrong
  environment: string;          // Node version, OS, etc
  fix_sequence: string[];        // Commands that fixed it
  keywords: string[];           // For retrieval
}
```

## Embedding Specification

### Prompt for Embedding Generation
```
You are converting a terminal debugging episode into a searchable semantic memory entry.

Summarize:
1. What was the problem?
2. What environment/context was active?
3. What commands fixed it?
4. What keywords would help retrieve this later?

Terminal Episode:
{episode_raw_data}

Output format:
Problem: ...
Environment: ...
Fix: ...
Keywords: ...
```

### MVP Implementation
- Use OpenAI embeddings API (or local model if available)
- Store 1536-dimensional vectors
- Use cosine similarity for retrieval

## Retrieval Trigger Conditions

Run retrieval when:
1. **Command fails** - exit_code !== 0
2. **Repeated command** - Same command within 24h
3. **Project entry** - cd into known project with past errors
4. **Git branch change** - Switch to branch with known issues
5. **Keyword match** - stderr matches known error patterns

## Retrieval Prompt

```typescript
const RETRIEVAL_PROMPT = `
You are a terminal assistant helping recall past debugging sessions.

Current Context:
- Directory: {cwd}
- Command: {command}
- Error: {stderr}

Here are past similar episodes:
{top_memories}

Determine:
1. Is one highly relevant?
2. If yes, summarize the fix in 1–3 lines.
3. If no strong match, output: NO_RELEVANT_MEMORY.
`;
```

## Confidence Scoring

```
confidence = 
  0.5 * semantic_similarity
+ 0.3 * project_match  
+ 0.2 * command_similarity
```

**Only surface if confidence > 0.75**

## Output Behavior

### High Confidence (>= 0.75)
```
💭 You hit something similar before:

Last time:
- Problem: {problem_summary}
- Fix: {fix_command}

Suggested next step:
> {suggested_command}
```

### Low Confidence
Silent. No output. (Silence > Noise)

## CLI Commands

```bash
# Start event capture daemon
ghostly-memory capture

# Query memory manually
ghostly-memory query "npm install failed"

# List recent episodes
ghostly-memory recent

# Stats
ghostly-memory stats

# Clear memory for a project
ghostly-memory clear --project <path>
```

## MVP Scope (2-3 Weeks)

### Week 1: Core
- [x] Event capture via shell hook
- [x] SQLite schema
- [x] Error-only episode extraction
- [x] Basic CLI

### Week 2: Intelligence  
- [ ] Embedding generation
- [ ] Similarity search
- [ ] Retrieval triggers
- [ ] Inline suggestion rendering

### Week 3: Polish
- [ ] Confidence tuning
- [ ] False positive reduction
- [ ] Performance optimization

## Acceptance Criteria

1. Can capture terminal events via shell hook
2. Extracts error episodes to SQLite
3. Generates embeddings for episodes
4. Retrieves similar past episodes on command failure
5. Shows inline suggestion (not chat UI)
6. Works fully local (no cloud required)
7. Respects privacy - all data local
