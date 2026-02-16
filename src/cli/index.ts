import { Command } from 'commander';
import chalk from 'chalk';
import { getRecentEpisodes, getStats, clearProject, getEpisodesByProject } from '../storage/db.js';
import { searchMemory } from '../retrieval/index.js';
import { handleTerminalEvent, generateShellHook } from '../capture/index.js';
import { summarizeEpisode } from '../extraction/index.js';
import { hashProjectPath } from '../extraction/index.js';

const program = new Command();

program
  .name('ghostly-memory')
  .description('Terminal memory layer - remembers your debugging sessions')
  .version('1.0.0');

// Capture command - process a terminal event
program
  .command('capture')
  .description('Capture a terminal event')
  .requiredOption('-c, --command <command>', 'Command that was executed')
  .requiredOption('-e, --exit <code>', 'Exit code', parseInt)
  .option('-d, --cwd <path>', 'Current working directory', process.cwd())
  .option('-s, --session <id>', 'Session ID')
  .option('--stderr <text>', 'Standard error output')
  .option('--stdout <text>', 'Standard output')
  .action(async (options) => {
    const result = await handleTerminalEvent(
      options.command,
      options.exit,
      options.stderr || '',
      options.stdout || ''
    );

    if (result?.suggestion?.shouldShow) {
      console.log(chalk.cyan(result.suggestion.message));
      if (result.suggestion.suggestedCommand) {
        console.log(chalk.green(`\nSuggested next step:`));
        console.log(chalk.yellow(`  > ${result.suggestion.suggestedCommand}`));
      }
    }
    
    if (result?.episode) {
      console.log(chalk.gray('Stored new episode in memory.'));
    }
  });

// Query command - search memory
program
  .command('query')
  .description('Search memory by text query')
  .argument('<query>', 'Search query')
  .option('-n, --max-results <number>', 'Maximum results', '5')
  .action(async (query, options) => {
    const episodes = await searchMemory(query, parseInt(options.maxResults));
    
    if (episodes.length === 0) {
      console.log(chalk.yellow('No matching memories found.'));
      return;
    }
    
    console.log(chalk.cyan(`\nFound ${episodes.length} relevant memories:\n`));
    
    episodes.forEach((episode, index) => {
      const date = new Date(episode.last_seen);
      console.log(chalk.bold(`${index + 1}. ${episode.problem_summary}`));
      console.log(chalk.gray(`   Directory: ${episode.directory}`));
      console.log(chalk.gray(`   Fix: ${episode.fix_sequence}`));
      console.log(chalk.gray(`   Seen: ${date.toLocaleDateString()} (${episode.occurrence_count}x)`));
      console.log();
    });
  });

// Recent command - show recent episodes
program
  .command('recent')
  .description('Show recent memory episodes')
  .option('-n, --max-results <number>', 'Maximum results', '10')
  .action(async (options) => {
    const episodes = getRecentEpisodes(parseInt(options.maxResults));
    
    if (episodes.length === 0) {
      console.log(chalk.yellow('No memories yet. Start using your terminal!'));
      return;
    }
    
    console.log(chalk.cyan(`Recent memories:\n`));
    
    episodes.forEach((episode, index) => {
      const date = new Date(episode.last_seen);
      console.log(chalk.bold(`${index + 1}. ${episode.problem_summary}`));
      console.log(chalk.gray(`   ${episode.directory}`));
      console.log(chalk.gray(`   Fix: ${episode.fix_sequence.substring(0, 50)}...`));
      console.log(chalk.gray(`   ${date.toLocaleString()}`));
      console.log();
    });
  });

// Stats command - show memory statistics
program
  .command('stats')
  .description('Show memory statistics')
  .action(() => {
    const stats = getStats();
    
    console.log(chalk.cyan('Ghostly Memory Stats:\n'));
    console.log(chalk.bold('Total Episodes:'), stats.totalEpisodes);
    console.log(chalk.bold('Total Events:'), stats.totalEvents);
    console.log(chalk.bold('Projects:'), stats.projects);
  });

// Clear command - clear memory for a project
program
  .command('clear')
  .description('Clear memory for a project')
  .option('-p, --project <path>', 'Project path (uses cwd if not specified)')
  .action(async (options) => {
    const projectPath = options.project || process.cwd();
    const projectHash = hashProjectPath(projectPath);
    
    clearProject(projectHash);
    console.log(chalk.green(`Cleared memory for: ${projectPath}`));
  });

// Show command - show episodes for a project
program
  .command('show')
  .description('Show memory for a specific project')
  .option('-p, --project <path>', 'Project path (uses cwd if not specified)')
  .action(async (options) => {
    const projectPath = options.project || process.cwd();
    const projectHash = hashProjectPath(projectPath);
    const episodes = getEpisodesByProject(projectHash);
    
    if (episodes.length === 0) {
      console.log(chalk.yellow(`No memories for: ${projectPath}`));
      return;
    }
    
    console.log(chalk.cyan(`Memories for: ${projectPath}\n`));
    
    episodes.forEach((episode, index) => {
      console.log(chalk.bold(`${index + 1}. ${episode.problem_summary}`));
      console.log(chalk.gray(`   Fix: ${episode.fix_sequence}`));
      console.log(chalk.gray(`   Keywords: ${episode.keywords}`));
      console.log(chalk.gray(`   Seen: ${episode.occurrence_count}x`));
      console.log();
    });
  });

// Hook command - generate shell hook
program
  .command('hook')
  .description('Generate shell hook script')
  .action(() => {
    console.log(generateShellHook());
  });

// Interactive command
program
  .command('interactive')
  .description('Interactive memory explorer')
  .action(async () => {
    const { default: inquirer } = await import('inquirer');
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          'Search memory',
          'View recent memories',
          'View stats',
          'Clear project memory',
        ],
      },
    ]);
    
    if (answers.action === 'Search memory') {
      const { query } = await inquirer.prompt([
        {
          type: 'input',
          name: 'query',
          message: 'Enter search query:',
        },
      ]);
      program.parse(['node', 'ghostly-memory', 'query', query.query]);
    } else if (answers.action === 'View recent memories') {
      program.parse(['node', 'ghostly-memory', 'recent']);
    } else if (answers.action === 'View stats') {
      program.parse(['node', 'ghostly-memory', 'stats']);
    } else if (answers.action === 'Clear project memory') {
      const { path } = await inquirer.prompt([
        {
          type: 'input',
          name: 'path',
          message: 'Project path (or press Enter for cwd):',
          default: process.cwd(),
        },
      ]);
      program.parse(['node', 'ghostly-memory', 'clear', '--project', path.path]);
    }
  });

export { program };
