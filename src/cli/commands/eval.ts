import chalk from 'chalk';
import { loadConfigOrExit } from '../util.js';
import { LLMOrchestrator } from '../../llm/orchestrator.js';
import { runEval, BUILTIN_CASES } from '../../eval/harness.js';
import { log } from '../../util/logger.js';

/**
 * `kafuops eval` — run the seeded fix-quality suite against the configured
 * provider and report the actual fix-success rate + confidence calibration.
 * The whole point is to measure whether generated fixes really work.
 */
export async function evalCommand(): Promise<void> {
  const { config } = loadConfigOrExit({ allowMissing: true });
  log.banner('KafuOps eval — seeded fix-quality suite');

  const probe = new LLMOrchestrator({ rootDir: process.cwd(), config });
  log.info(
    `Provider: ${probe.getProvider()} (analysis=${config.llm.models.analysis || '(cli default)'} patch=${config.llm.models.patch || '(cli default)'})`,
  );
  if (probe.isDryRun()) {
    log.warn('Dry-run: no real model calls — fixes will be empty (fix rate ~0%). Configure a provider/key to measure real quality.');
  }

  const report = await runEval(BUILTIN_CASES, {
    llm: { provider: config.llm.provider, models: config.llm.models },
    orchestratorFactory: (rootDir, cfg) => new LLMOrchestrator({ rootDir, config: cfg }),
  });

  log.info('');
  for (const c of report.cases) {
    const mark = c.fixed ? chalk.green('✓ fixed    ') : chalk.red('✗ not fixed');
    log.info(`  ${mark} ${c.name}  [status=${c.status} attempts=${c.attempts ?? '-'} confidence=${c.confidence ?? '-'}]`);
  }
  log.info('');
  log.info(
    `Fix rate: ${Math.round(report.fixRate * 100)}% (${report.fixed}/${report.total}) · avg attempts ${report.avgAttempts.toFixed(1)}`,
  );
  if (report.calibration.fixedAvgConfidence != null) {
    log.info(
      `Calibration: fixed avg confidence ${report.calibration.fixedAvgConfidence.toFixed(0)}` +
        (report.calibration.unfixedAvgConfidence != null
          ? ` vs unfixed ${report.calibration.unfixedAvgConfidence.toFixed(0)}`
          : ''),
    );
  }
}
