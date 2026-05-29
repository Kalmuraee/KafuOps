import { Command } from 'commander';
import chalk from 'chalk';
import { log, setLogLevel } from '../util/logger.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { scanCommand } from './commands/scan.js';
import { runCommand } from './commands/run.js';
import {
  listIncidents,
  showIncident,
  analyzeIncident,
  buildContextCommand,
  openMrCommand,
  markResolved,
  markMerged,
  markRejected,
} from './commands/incidents.js';
import { simulateCommand } from './commands/simulate.js';
import { memoryShow, memoryUpdate, memoryValidate, memoryDiff } from './commands/memory.js';
import { policiesValidate, policiesExplain } from './commands/policies.js';
import { auditList, auditShow, auditExport } from './commands/audit.js';
import { webhooksStart, webhooksTest } from './commands/webhooks.js';
import { agentStart, workerStart } from './commands/agent.js';

const program = new Command();

program
  .name('kafuops')
  .description('Open-source production-debugging agent.')
  .version('0.2.0')
  .option('--debug', 'verbose logging')
  .hook('preAction', (cmd) => {
    if (cmd.opts().debug) setLogLevel('debug');
  });

program
  .command('init')
  .description('Run the setup wizard and create .kafuops.yml')
  .option('-y, --yes', 'accept defaults without prompting')
  .action(async (opts) => {
    await initCommand({ yes: !!opts.yes });
  });

program
  .command('doctor')
  .description('Validate config, tokens, redaction, and tooling.')
  .action(doctorCommand);

program
  .command('scan')
  .description('Build project memory + architecture graph.')
  .option('--full', 'full scan')
  .option('--memory-only', 'memory only, skip graph')
  .option('--graph-only', 'graph only, skip memory')
  .option('--no-write', 'do not write files; print summary only')
  .action((opts) =>
    scanCommand({
      full: !!opts.full,
      memoryOnly: !!opts.memoryOnly,
      graphOnly: !!opts.graphOnly,
      write: opts.write !== false,
    }),
  );

program
  .command('run')
  .description('Wrap and observe a backend command. Usage: kafuops run -- <cmd>')
  .option('--service <name>', 'service name for events')
  .option('--env <name>', 'environment label')
  .allowUnknownOption(true)
  .argument('[args...]', 'command and args after `--`')
  .action(async (args: string[], opts) => {
    const code = await runCommand(args, { service: opts.service, env: opts.env });
    process.exit(code);
  });

const agent = program.command('agent').description('Sidecar agent — ingests events via HTTP.');
agent
  .command('start')
  .description('Start the agent listener.')
  .option('-p, --port <port>', 'port', (v) => Number(v))
  .action((opts) => agentStart({ port: opts.port }));

const worker = program.command('worker').description('Analysis + patch worker.');
worker
  .command('start')
  .description('Start the background worker that drives pending incidents to MRs.')
  .option('--interval <seconds>', 'poll interval in seconds', (v) => Number(v))
  .option('--once', 'process pending incidents once, then exit')
  .action((opts) => workerStart({ intervalSeconds: opts.interval, once: !!opts.once }));

const incidents = program.command('incidents').description('Manage incidents.');
incidents.command('list').description('List incidents.').action(listIncidents);
incidents
  .command('show <id>')
  .description('Show incident JSON.')
  .action(async (id) => showIncident(id));
incidents
  .command('analyze <id>')
  .description('Run LLM root-cause analysis.')
  .action(async (id) => analyzeIncident(id));
incidents
  .command('build-context <id>')
  .description('Build a sanitized context bundle.')
  .action(async (id) => buildContextCommand(id));
incidents
  .command('open-mr <id>')
  .description('Plan, patch, validate, and open an MR/PR.')
  .option('--in-place', 'apply patch in the current repo (skip sandbox copy)')
  .option('--dry-run', 'do not push or open MR')
  .action(async (id, opts) => openMrCommand(id, { inPlace: !!opts.inPlace, dryRun: !!opts.dryRun }));
incidents
  .command('mark-resolved <id>')
  .description('Close an incident manually.')
  .action(async (id) => markResolved(id));
incidents
  .command('mark-merged <id>')
  .description('Record that a reviewer merged the MR (feeds review-feedback memory).')
  .option('--note <text>', 'reviewer note to remember')
  .action(async (id, opts) => markMerged(id, { note: opts.note }));
incidents
  .command('mark-rejected <id>')
  .description('Record that a reviewer rejected the MR (feeds review-feedback memory).')
  .option('--note <text>', 'reviewer note to remember')
  .action(async (id, opts) => markRejected(id, { note: opts.note }));

program
  .command('simulate')
  .description('Generate a synthetic incident for testing.')
  .argument('<kind>', 'error | alert | crash')
  .option('--service <name>')
  .option('--severity <level>')
  .option('--count <n>', 'how many events to emit', (v) => Number(v))
  .action(async (kind, opts) => {
    await simulateCommand({
      kind,
      service: opts.service,
      severity: opts.severity,
      count: opts.count,
    });
  });

const memory = program.command('memory').description('Inspect or update project memory.');
memory.command('show').action(memoryShow);
memory.command('update').action(memoryUpdate);
memory.command('validate').action(memoryValidate);
memory.command('diff').action(memoryDiff);

const policies = program.command('policies').description('Inspect policy decisions.');
policies.command('validate').action(policiesValidate);
policies
  .command('explain')
  .description('Explain the policy decision for a file path or an incident’s changed files.')
  .option('--file <path>', 'repo-relative file path')
  .option('--incident <id>', 'explain decisions for an incident’s changed files')
  .action(async (opts) => policiesExplain({ file: opts.file, incident: opts.incident }));

const audit = program.command('audit').description('Inspect model-call audit log.');
audit.command('list').action(auditList);
audit.command('show <id>').action(async (id) => auditShow(id));
audit
  .command('export')
  .description('Export audit entries for an incident.')
  .requiredOption('--incident <id>')
  .action(async (opts) => auditExport(opts.incident));

const webhooks = program.command('webhooks').description('Webhook intake.');
webhooks
  .command('start')
  .option('-p, --port <port>', 'port', (v) => Number(v))
  .action((opts) => webhooksStart({ port: opts.port }));
webhooks
  .command('test')
  .argument('<source>', 'sentry | datadog | alertmanager | custom')
  .action(async (source) => webhooksTest(source));

program.parseAsync(process.argv).catch((err) => {
  log.error(`Command failed: ${err && err.message ? err.message : err}`);
  if (err && err.stack && process.env.KAFUOPS_LOG_LEVEL === 'debug') {
    console.error(chalk.dim(err.stack));
  }
  process.exit(1);
});
