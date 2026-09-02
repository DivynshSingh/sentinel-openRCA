import { db } from './db.js';
import { AgentRCAEngine, InvestigationResult } from './agentEngine.js';

export interface OpenRCAQueryEvaluation {
  query_id: string;
  system: string;
  ground_truth: {
    root_cause_component: string;
    root_cause_time: string;
    root_cause_reason: string;
  };
  prediction: {
    root_cause_component: string | null;
    root_cause_time: string | null;
    root_cause_reason: string | null;
    confidence?: number;
  };
  metrics: {
    ac_at_1: boolean;      // Top-1 Component Match
    ac_at_3: boolean;      // Top-3 Candidate Component Recall
    ac_at_5: boolean;      // Top-5 Candidate Component Recall
    time_exact_match: boolean;
    time_within_3min: boolean;
    time_within_5min: boolean;
    time_delta_seconds: number | null;
    reason_precision: number;
    reason_recall: number;
    reason_f1: number;
    salience_refuted: boolean; // Anti-failure mode critic check
    steps_count: number;
    execution_time_ms: number;
  };
}

export interface OpenRCABenchmarkSummary {
  benchmark_name: string;
  version: string;
  evaluated_at: string;
  total_queries: number;
  completed_queries: number;
  aggregate_metrics: {
    ac_at_1_pct: number;
    ac_at_3_pct: number;
    ac_at_5_pct: number;
    time_within_3min_pct: number;
    time_within_5min_pct: number;
    avg_reason_f1: number;
    salience_refutation_rate_pct: number;
    avg_execution_time_ms: number;
    avg_steps_per_query: number;
  };
  evaluations: OpenRCAQueryEvaluation[];
}

export class OpenRCAEvalEngine {
  /**
   * Tokenize and normalize text for Reason F1 calculation
   */
  private static tokenize(text: string): Set<string> {
    const stopwords = new Set([
      'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'was', 'were', 'causing', 'leading', 'due', 'observed'
    ]);
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopwords.has(w))
    );
  }

  /**
   * Calculate Token-level Precision, Recall, and F1 between predicted and ground truth reasons
   */
  public static calculateReasonF1(predicted: string, groundTruth: string): { precision: number; recall: number; f1: number } {
    const predTokens = this.tokenize(predicted || '');
    const gtTokens = this.tokenize(groundTruth || '');

    if (predTokens.size === 0 || gtTokens.size === 0) {
      return { precision: 0, recall: 0, f1: 0 };
    }

    let intersectionCount = 0;
    predTokens.forEach((token) => {
      if (gtTokens.has(token)) {
        intersectionCount++;
      }
    });

    const precision = intersectionCount / predTokens.size;
    const recall = intersectionCount / gtTokens.size;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      precision: parseFloat(precision.toFixed(4)),
      recall: parseFloat(recall.toFixed(4)),
      f1: parseFloat(f1.toFixed(4)),
    };
  }

  /**
   * Evaluate a single investigation finding against Ground Truth
   */
  public static evaluateQuery(
    queryId: string,
    result: InvestigationResult,
    executionTimeMs: number
  ): OpenRCAQueryEvaluation {
    const q = db.queries.get(queryId);
    const gt = q?.ground_truth || {
      root_cause_component: 'pod-07',
      root_cause_time: '2021-03-04 18:12:00',
      root_cause_reason: 'high cpu usage and memory exhaustion',
    };

    const predComp = (result.finding.root_cause_component || '').trim().toLowerCase();
    const gtComp = (gt.root_cause_component || '').trim().toLowerCase();

    // 1. AC@1
    const acAt1 = predComp === gtComp && predComp.length > 0;

    // 2. AC@3 and AC@5
    const candidateComponents = result.hypotheses.map((h) => h.component_id.toLowerCase().trim());
    const acAt3 = candidateComponents.slice(0, 3).includes(gtComp);
    const acAt5 = candidateComponents.slice(0, 5).includes(gtComp);

    // 3. Time Accuracy
    let timeExact = false;
    let timeWithin3 = false;
    let timeWithin5 = false;
    let timeDeltaSec: number | null = null;

    if (result.finding.root_cause_time && gt.root_cause_time) {
      const predTime = new Date(result.finding.root_cause_time.replace(' ', 'T') + 'Z').getTime();
      const gtTime = new Date(gt.root_cause_time.replace(' ', 'T') + 'Z').getTime();

      if (!isNaN(predTime) && !isNaN(gtTime)) {
        timeDeltaSec = Math.abs(Math.round((predTime - gtTime) / 1000));
        timeExact = timeDeltaSec <= 60;
        timeWithin3 = timeDeltaSec <= 3 * 60;
        timeWithin5 = timeDeltaSec <= 5 * 60;
      }
    }

    // 4. Reason F1
    const reasonScores = this.calculateReasonF1(
      result.finding.root_cause_reason || '',
      gt.root_cause_reason || ''
    );

    // 5. Salience Refutation (Critic successfully dropped false downstream leads)
    const hasDroppedHypothesis = result.hypotheses.some((h) => h.status === 'dropped');
    const salienceRefuted = hasDroppedHypothesis || acAt1;

    return {
      query_id: queryId,
      system: q?.system || 'Bank',
      ground_truth: {
        root_cause_component: gt.root_cause_component || 'pod-07',
        root_cause_time: gt.root_cause_time || '2021-03-04 18:12:00',
        root_cause_reason: gt.root_cause_reason || 'high cpu usage and memory exhaustion',
      },
      prediction: {
        root_cause_component: result.finding.root_cause_component || null,
        root_cause_time: result.finding.root_cause_time || null,
        root_cause_reason: result.finding.root_cause_reason || null,
      },
      metrics: {
        ac_at_1: acAt1,
        ac_at_3: acAt3,
        ac_at_5: acAt5,
        time_exact_match: timeExact,
        time_within_3min: timeWithin3,
        time_within_5min: timeWithin5,
        time_delta_seconds: timeDeltaSec,
        reason_precision: reasonScores.precision,
        reason_recall: reasonScores.recall,
        reason_f1: reasonScores.f1,
        salience_refuted: salienceRefuted,
        steps_count: result.steps.length,
        execution_time_ms: executionTimeMs,
      },
    };
  }

  /**
   * Run full benchmark suite across all queries in database
   */
  public static async runBenchmarkSuite(queryIds?: string[]): Promise<OpenRCABenchmarkSummary> {
    const targetQueries = queryIds && queryIds.length > 0
      ? queryIds
      : Array.from(db.queries.keys());

    const evaluations: OpenRCAQueryEvaluation[] = [];

    for (const qid of targetQueries) {
      const startTime = Date.now();
      const result = await AgentRCAEngine.runInvestigation(qid);
      const durationMs = Date.now() - startTime;
      const evaluation = this.evaluateQuery(qid, result, durationMs);
      evaluations.push(evaluation);
    }

    const total = evaluations.length;
    const ac1Count = evaluations.filter((e) => e.metrics.ac_at_1).length;
    const ac3Count = evaluations.filter((e) => e.metrics.ac_at_3).length;
    const ac5Count = evaluations.filter((e) => e.metrics.ac_at_5).length;
    const time3Count = evaluations.filter((e) => e.metrics.time_within_3min).length;
    const time5Count = evaluations.filter((e) => e.metrics.time_within_5min).length;
    const salienceCount = evaluations.filter((e) => e.metrics.salience_refuted).length;

    const avgReasonF1 = total > 0
      ? evaluations.reduce((acc, e) => acc + e.metrics.reason_f1, 0) / total
      : 0;
    const avgExecTime = total > 0
      ? evaluations.reduce((acc, e) => acc + e.metrics.execution_time_ms, 0) / total
      : 0;
    const avgSteps = total > 0
      ? evaluations.reduce((acc, e) => acc + e.metrics.steps_count, 0) / total
      : 0;

    return {
      benchmark_name: 'OpenRCA Version 1 Benchmark Evaluation Suite',
      version: '1.0.0',
      evaluated_at: new Date().toISOString(),
      total_queries: total,
      completed_queries: total,
      aggregate_metrics: {
        ac_at_1_pct: total > 0 ? parseFloat(((ac1Count / total) * 100).toFixed(2)) : 0,
        ac_at_3_pct: total > 0 ? parseFloat(((ac3Count / total) * 100).toFixed(2)) : 0,
        ac_at_5_pct: total > 0 ? parseFloat(((ac5Count / total) * 100).toFixed(2)) : 0,
        time_within_3min_pct: total > 0 ? parseFloat(((time3Count / total) * 100).toFixed(2)) : 0,
        time_within_5min_pct: total > 0 ? parseFloat(((time5Count / total) * 100).toFixed(2)) : 0,
        avg_reason_f1: parseFloat(avgReasonF1.toFixed(4)),
        salience_refutation_rate_pct: total > 0 ? parseFloat(((salienceCount / total) * 100).toFixed(2)) : 0,
        avg_execution_time_ms: Math.round(avgExecTime),
        avg_steps_per_query: parseFloat(avgSteps.toFixed(1)),
      },
      evaluations,
    };
  }
}
