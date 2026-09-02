export interface Component {
  cmdb_id: string;
  name: string;
  type: string; // pod | service | node | container
  system: string; // Bank | Telecom | Market
}

export interface MetricPoint {
  id: string;
  component_id: string;
  kpi_name: string;
  ts: string;
  value: number;
  is_anomalous?: boolean;
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

export interface LogEntry {
  id: string;
  component_id: string;
  ts: string;
  level: string;
  message: string;
  template_id?: string;
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
  evidence?: HypothesisEvidence[];
}

export interface HypothesisEvidence {
  evidence_id: string;
  hypothesis_id: string;
  evidence_type: string;
  evidence_table: string;
  evidence_pk: string;
  citation_text?: string;
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
