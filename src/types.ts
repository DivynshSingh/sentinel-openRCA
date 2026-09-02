export interface QueryRecord {
  query_id: string;
  question_text: string;
  window_start: string;
  window_end: string;
  system: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  ground_truth?: {
    root_cause_time?: string;
    root_cause_component?: string;
    root_cause_reason?: string;
    [key: string]: any;
  };
}

export interface MetricAnomaly {
  id: string;
  query_id: string;
  component_id: string;
  metric_name: string;
  anomaly_pattern: 'spike' | 'steady_rise' | 'level_shift' | 'unknown';
  ts: string;
  deviation_score: number;
}

export interface MetricPoint {
  id: string;
  component_id: string;
  kpi_name: string;
  ts: string;
  value: number;
  is_anomalous?: boolean;
}

export interface TraceSummary {
  id: string;
  query_id: string;
  callee_id: string;
  window_start: string;
  window_end: string;
  total_calls: number;
  max_latency_ms: number;
  caller_distribution: Record<string, number>;
}

export interface TracePath {
  id: string;
  query_id: string;
  grandparent_id?: string | null;
  caller_id: string;
  callee_id: string;
  frequency: number;
  is_high_latency: boolean;
}

export interface Span {
  span_id: string;
  trace_id: string;
  parent_span_id?: string | null;
  component_id: string;
  start_time: string;
  duration_ms: number;
  status: string;
  call_type?: string;
}

export interface LogSummary {
  id: string;
  query_id: string;
  component_id: string;
  template_id: string;
  template_text: string;
  tfidf_score: number;
  rank_pct: number;
  earliest_ts: string;
  level: string;
}

export interface LogEntry {
  id: string;
  component_id: string;
  ts: string;
  level: string;
  message: string;
}

export interface Hypothesis {
  hypothesis_id: string;
  query_id: string;
  component_id: string;
  phase_created: string;
  reason: string;
  confidence?: number;
  status: 'active' | 'dropped' | 'confirmed';
  superseded_by?: string | null;
  created_at: string;
}

export interface Finding {
  finding_id: string;
  query_id: string;
  hypothesis_id?: string | null;
  root_cause_time?: string | null;
  root_cause_component?: string | null;
  root_cause_reason?: string | null;
  confirmed_at: string;
}

export interface AgentStep {
  step_id: string;
  query_id: string;
  phase: string;
  tool_name: string;
  args?: Record<string, any>;
  result_summary?: string;
  ts: string;
}

export interface SystemStats {
  system: string;
  componentsCount: number;
  metricPointsCount: number;
  spansCount: number;
  logEntriesCount: number;
  queriesCount: number;
  metricAnomaliesCount: number;
  traceSummariesCount: number;
  logSummariesCount: number;
  hypothesesCount: number;
  findingsCount: number;
  agentStepsCount: number;
}

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
  };
  metrics: {
    ac_at_1: boolean;
    ac_at_3: boolean;
    ac_at_5: boolean;
    time_exact_match: boolean;
    time_within_3min: boolean;
    time_within_5min: boolean;
    time_delta_seconds: number | null;
    reason_precision: number;
    reason_recall: number;
    reason_f1: number;
    salience_refuted: boolean;
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

