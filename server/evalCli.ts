#!/usr/bin/env node
import { OpenRCAEvalEngine } from './evalEngine.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('===============================================================');
  console.log('       SENTINEL RCA AGENT — OPENRCA v1 BENCHMARK RUNNER       ');
  console.log('===============================================================');
  console.log('Running evaluation against OpenRCA version 1 benchmark suite...\n');

  const startTime = Date.now();
  const summary = await OpenRCAEvalEngine.runBenchmarkSuite();
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`Evaluated ${summary.total_queries} incidents in ${totalElapsed}s\n`);

  console.log('----------------------------------------------------------------------------------------------------------------------');
  console.log('| Query ID | Ground Truth Comp | Predicted Comp | AC@1 | AC@3 | Time (±3m) | Reason F1 | Salience Refuted | Latency |');
  console.log('----------------------------------------------------------------------------------------------------------------------');

  summary.evaluations.forEach((e) => {
    const qid = e.query_id.padEnd(8, ' ');
    const gtComp = e.ground_truth.root_cause_component.padEnd(17, ' ');
    const predComp = (e.prediction.root_cause_component || 'N/A').padEnd(14, ' ');
    const ac1 = (e.metrics.ac_at_1 ? ' PASS ' : ' FAIL ').padEnd(4, ' ');
    const ac3 = (e.metrics.ac_at_3 ? ' PASS ' : ' FAIL ').padEnd(4, ' ');
    const time3 = (e.metrics.time_within_3min ? ' PASS ' : ' FAIL ').padEnd(10, ' ');
    const f1 = e.metrics.reason_f1.toFixed(3).padEnd(9, ' ');
    const salience = (e.metrics.salience_refuted ? '  YES ' : '  NO  ').padEnd(16, ' ');
    const lat = `${e.metrics.execution_time_ms}ms`.padEnd(7, ' ');

    console.log(`| ${qid} | ${gtComp} | ${predComp} | ${ac1} | ${ac3} | ${time3} | ${f1} | ${salience} | ${lat} |`);
  });
  console.log('----------------------------------------------------------------------------------------------------------------------\n');

  console.log('===============================================================');
  console.log('              OPENRCA v1 BENCHMARK SCORECARD                  ');
  console.log('===============================================================');
  console.log(` Top-1 Accuracy (AC@1):                 ${summary.aggregate_metrics.ac_at_1_pct}% (Baseline OpsAgent: 16.5%)`);
  console.log(` Top-3 Recall   (AC@3):                 ${summary.aggregate_metrics.ac_at_3_pct}%`);
  console.log(` Top-5 Recall   (AC@5):                 ${summary.aggregate_metrics.ac_at_5_pct}%`);
  console.log(` Time Window Accuracy (±3 mins):        ${summary.aggregate_metrics.time_within_3min_pct}%`);
  console.log(` Time Window Accuracy (±5 mins):        ${summary.aggregate_metrics.time_within_5min_pct}%`);
  console.log(` Reason Semantic F1 Score:              ${summary.aggregate_metrics.avg_reason_f1}`);
  console.log(` Salience Defense Refutation Rate:      ${summary.aggregate_metrics.salience_refutation_rate_pct}%`);
  console.log(` Average Investigation Latency:         ${summary.aggregate_metrics.avg_execution_time_ms}ms`);
  console.log(` Average Agent Steps Per Query:         ${summary.aggregate_metrics.avg_steps_per_query}`);
  console.log('===============================================================\n');

  const outputPath = path.join(process.cwd(), 'openrca_eval_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(` Exported full OpenRCA v1 benchmark results -> ${outputPath}\n`);
}

main().catch((err) => {
  console.error('Benchmark execution failed:', err);
  process.exit(1);
});
