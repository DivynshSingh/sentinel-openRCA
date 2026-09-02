import {
  Component,
  MetricPoint,
  Span,
  LogEntry,
  MetricAnomaly,
  TraceSummary,
  TracePath,
  LogSummary,
  QueryRecord,
  Hypothesis,
  HypothesisEvidence,
  Finding,
  AgentStep,
} from './types.js';

class InMemoryDB {
  components: Map<string, Component> = new Map();
  metricPoints: Map<string, MetricPoint> = new Map();
  spans: Map<string, Span> = new Map();
  logEntries: Map<string, LogEntry> = new Map();
  metricAnomalies: Map<string, MetricAnomaly> = new Map();
  traceSummaries: Map<string, TraceSummary> = new Map();
  tracePaths: Map<string, TracePath> = new Map();
  logSummaries: Map<string, LogSummary> = new Map();
  queries: Map<string, QueryRecord> = new Map();
  hypotheses: Map<string, Hypothesis> = new Map();
  hypothesisEvidences: Map<string, HypothesisEvidence> = new Map();
  findings: Map<string, Finding> = new Map();
  agentSteps: Map<string, AgentStep> = new Map();

  private initialized = false;

  constructor() {
    this.seed();
  }

  seed() {
    if (this.initialized) return;
    this.initialized = true;

    // 1. Components (14 pods for Bank microservices system)
    const podNames = [
      'pod-01', 'pod-02', 'pod-03', 'pod-04', 'pod-05',
      'pod-06', 'pod-07', 'pod-08', 'pod-09', 'pod-10',
      'pod-11', 'pod-12', 'pod-13', 'pod-14'
    ];

    podNames.forEach((pod) => {
      this.components.set(pod, {
        cmdb_id: pod,
        name: pod,
        type: 'pod',
        system: 'Bank',
      });
    });

    // Root cause specs
    const baseTime = new Date('2021-03-04T18:00:00Z');
    const rootCauseComponent = 'pod-07';
    const rootCauseTime = new Date('2021-03-04T18:12:00Z');

    // 2. Metrics Generation
    const metricNames = ['cpu_usage', 'memory_usage', 'disk_io', 'network_latency', 'error_rate'];

    let mpCounter = 1;
    podNames.forEach((comp) => {
      metricNames.forEach((metric) => {
        for (let i = 0; i < 30; i++) {
          const ts = new Date(baseTime.getTime() + i * 60 * 1000);
          let baseVal = 0;

          if (metric === 'cpu_usage') baseVal = 30 + Math.sin(i + comp.charCodeAt(4)) * 12 + Math.random() * 8;
          else if (metric === 'memory_usage') baseVal = 45 + Math.cos(i) * 10 + Math.random() * 5;
          else if (metric === 'disk_io') baseVal = 15 + Math.random() * 10;
          else if (metric === 'network_latency') baseVal = 25 + Math.random() * 15;
          else if (metric === 'error_rate') baseVal = Math.random() * 1.5;

          // Inject fault on pod-07 at 18:12
          if (comp === rootCauseComponent && ts.getTime() >= rootCauseTime.getTime()) {
            if (metric === 'cpu_usage') baseVal = 88 + Math.random() * 10;
            else if (metric === 'memory_usage') baseVal = 92 + Math.random() * 6;
            else if (metric === 'error_rate') baseVal = 22 + Math.random() * 8;
          }

          // Downstream cascading impact on pod-05, pod-06, pod-08 after 3 mins
          if (['pod-05', 'pod-06', 'pod-08'].includes(comp) && ts.getTime() >= rootCauseTime.getTime() + 3 * 60 * 1000) {
            if (metric === 'network_latency') baseVal = 280 + Math.random() * 150;
            else if (metric === 'error_rate') baseVal = 8 + Math.random() * 5;
          }

          const id = `mp-${mpCounter++}`;
          this.metricPoints.set(id, {
            id,
            component_id: comp,
            kpi_name: metric,
            ts: ts.toISOString(),
            value: parseFloat(baseVal.toFixed(2)),
            is_anomalous: false,
          });
        }
      });
    });

    // 3. Spans Generation
    const traceId = 'trace-bank-7701a';
    const rootSpanId = 'span-root-01';

    // Root span on pod-01 (API Gateway)
    this.spans.set(rootSpanId, {
      span_id: rootSpanId,
      trace_id: traceId,
      parent_span_id: null,
      component_id: 'pod-01',
      start_time: new Date(baseTime.getTime() + 10 * 60 * 1000).toISOString(),
      duration_ms: 45,
      status: 'ok',
      call_type: 'GET /api/v1/users',
    });

    // Span on pod-05 (Order Orchestrator)
    const span05Id = 'span-ord-05';
    this.spans.set(span05Id, {
      span_id: span05Id,
      trace_id: traceId,
      parent_span_id: rootSpanId,
      component_id: 'pod-05',
      start_time: new Date(baseTime.getTime() + 10 * 60 * 1000 + 1000).toISOString(),
      duration_ms: 120,
      status: 'ok',
      call_type: 'GET /api/v1/orders',
    });

    // Root cause spans on pod-07 (DB & Transaction Worker)
    let lastSpan = span05Id;
    [12, 13, 14, 15, 18, 22].forEach((min, idx) => {
      const spanId = `span-tx-07-${idx + 1}`;
      const isFault = min >= 12;
      this.spans.set(spanId, {
        span_id: spanId,
        trace_id: traceId,
        parent_span_id: lastSpan,
        component_id: rootCauseComponent,
        start_time: new Date(baseTime.getTime() + min * 60 * 1000).toISOString(),
        duration_ms: isFault ? 1150 + Math.floor(Math.random() * 400) : 65,
        status: min >= 13 ? 'error' : 'ok',
        call_type: 'POST /db/query',
      });
      lastSpan = spanId;
    });

    // Downstream spans on pod-08 (Cache & Ledger Service)
    const span08Id = 'span-cache-08';
    this.spans.set(span08Id, {
      span_id: span08Id,
      trace_id: traceId,
      parent_span_id: lastSpan,
      component_id: 'pod-08',
      start_time: new Date(baseTime.getTime() + 15 * 60 * 1000 + 500).toISOString(),
      duration_ms: 640,
      status: 'error',
      call_type: 'GET /cache/refresh',
    });

    // Add general background traffic spans
    let bgSpanCount = 1;
    podNames.forEach((pod) => {
      for (let s = 0; s < 4; s++) {
        const sid = `span-bg-${bgSpanCount++}`;
        const startTime = new Date(baseTime.getTime() + (s * 7 + 2) * 60 * 1000).toISOString();
        this.spans.set(sid, {
          span_id: sid,
          trace_id: `trace-bg-${pod}-${s}`,
          parent_span_id: s > 0 ? `span-bg-${bgSpanCount - 2}` : null,
          component_id: pod,
          start_time: startTime,
          duration_ms: Math.floor(20 + Math.random() * 60),
          status: 'ok',
          call_type: 'RPC /internal/health',
        });
      }
    });

    // 4. Log Entries Generation
    let logCount = 1;
    podNames.forEach((comp) => {
      for (let i = 0; i < 6; i++) {
        const ts = new Date(baseTime.getTime() + i * 5 * 60 * 1000).toISOString();
        const lid = `le-${logCount++}`;
        this.logEntries.set(lid, {
          id: lid,
          component_id: comp,
          ts,
          level: 'INFO',
          message: `Service ${comp} periodic health check passed [status=healthy, load_avg=0.34]`,
        });
      }
    });

    // Root cause critical error logs
    const errorTemplates = [
      'Connection timeout to database 192.168.1.42: Connection refused after 3 retries',
      'Failed to process request f8c91a02: OutOfMemoryError in pod-07 heap allocation',
      'CRITICAL: pod-07 CPU throttled at 96% — performance severely degraded',
      'Error: unable to allocate 1024MB heap memory buffer in pod-07 JVM container',
    ];

    [12, 13, 14, 15, 16, 19, 21].forEach((min, idx) => {
      const ts = new Date(baseTime.getTime() + min * 60 * 1000).toISOString();
      const lid = `le-${logCount++}`;
      this.logEntries.set(lid, {
        id: lid,
        component_id: rootCauseComponent,
        ts,
        level: 'ERROR',
        message: errorTemplates[idx % errorTemplates.length],
      });
    });

    // Downstream cascading logs
    ['pod-05', 'pod-08'].forEach((comp) => {
      const ts = new Date(baseTime.getTime() + 15 * 60 * 1000).toISOString();
      const lid = `le-${logCount++}`;
      this.logEntries.set(lid, {
        id: lid,
        component_id: comp,
        ts,
        level: 'ERROR',
        message: `Upstream dependency pod-07 unavailable: cascading failure in ${comp} response timeout`,
      });
    });

    // 5. Benchmark Queries (OpenRCA v1 Bank Benchmark Dataset)
    const benchmarkScenarios = [
      {
        id: '1',
        alias: 'bank_001',
        title: 'Bank Incident 001 — Database Pool Starvation & CPU Throttling',
        question: 'On March 4, 2021, between 18:00 and 18:30, there was a single critical failure observed in the Bank system. The exact component that caused this failure is unknown, and the reason behind the failure is also undetermined. Your task is to identify the root cause component, root cause time, and the root cause reason for this failure.',
        window_start: '2021-03-04T18:00:00Z',
        window_end: '2021-03-04T18:30:00Z',
        gt_component: 'pod-07',
        gt_time: '2021-03-04 18:12:00',
        gt_reason: 'high cpu usage (96%) and memory exhaustion in pod-07 leading to database connection pool timeouts and cascading latency spikes downstream',
      },
      {
        id: '2',
        alias: 'bank_002',
        title: 'Bank Incident 002 — RPC Gateway Packet Drop & Network Latency',
        question: 'On March 4, 2021, between 18:00 and 18:30, API Gateway transaction latency increased by 600%. Identify the root cause component and reason behind the failure.',
        window_start: '2021-03-04T18:00:00Z',
        window_end: '2021-03-04T18:30:00Z',
        gt_component: 'pod-04',
        gt_time: '2021-03-04 18:08:00',
        gt_reason: 'network latency surge and packet loss in pod-04 gateway routing proxy causing RPC timeouts on downstream client requests',
      },
      {
        id: '3',
        alias: 'bank_003',
        title: 'Bank Incident 003 — Disk IO Throttling & Storage Queue Saturation',
        question: 'On March 4, 2021, between 18:00 and 18:30, ledger transaction throughput collapsed. Identify the root cause component, failure time, and exact failure mechanism.',
        window_start: '2021-03-04T18:00:00Z',
        window_end: '2021-03-04T18:30:00Z',
        gt_component: 'pod-11',
        gt_time: '2021-03-04 18:15:00',
        gt_reason: 'disk io bottleneck and storage queue saturation in pod-11 causing write stalls and database flush delays across cluster',
      },
      {
        id: '4',
        alias: 'bank_004',
        title: 'Bank Incident 004 — Auth Token Thread Leak & Error Rate Surge',
        question: 'On March 4, 2021, between 18:00 and 18:30, user authentication requests failed with 500 error spikes. Determine root cause component and reason.',
        window_start: '2021-03-04T18:00:00Z',
        window_end: '2021-03-04T18:30:00Z',
        gt_component: 'pod-02',
        gt_time: '2021-03-04 18:05:00',
        gt_reason: 'thread pool exhaustion and memory leak in pod-02 auth worker resulting in token validation timeouts and 500 internal server errors',
      },
      {
        id: '5',
        alias: 'bank_005',
        title: 'Bank Incident 005 — JVM Major GC Pause & Memory Thrashing',
        question: 'On March 4, 2021, between 18:00 and 18:30, transaction settlement workers became unresponsive. Identify the root cause component, onset time, and reason.',
        window_start: '2021-03-04T18:00:00Z',
        window_end: '2021-03-04T18:30:00Z',
        gt_component: 'pod-09',
        gt_time: '2021-03-04 18:20:00',
        gt_reason: 'prolonged jvm garbage collection pauses and heap memory thrashing in pod-09 causing thread blocking and node heartbeat loss',
      },
    ];

    benchmarkScenarios.forEach((sc) => {
      this.queries.set(sc.id, {
        query_id: sc.id,
        question_text: sc.question,
        window_start: sc.window_start,
        window_end: sc.window_end,
        system: 'Bank',
        status: 'pending',
        ground_truth: {
          root_cause_time: sc.gt_time,
          root_cause_component: sc.gt_component,
          root_cause_reason: sc.gt_reason,
        },
      });
      // also alias bank_001, etc.
      this.queries.set(sc.alias, {
        query_id: sc.alias,
        question_text: sc.question,
        window_start: sc.window_start,
        window_end: sc.window_end,
        system: 'Bank',
        status: 'pending',
        ground_truth: {
          root_cause_time: sc.gt_time,
          root_cause_component: sc.gt_component,
          root_cause_reason: sc.gt_reason,
        },
      });
    });
  }

  // Helper SQL-like query simulation
  executeSql(sql: string): { columns: string[]; rows: any[]; row_count: number } {
    const trimmed = sql.trim().toLowerCase();

    if (trimmed.includes('from metric_anomaly')) {
      const rows = Array.from(this.metricAnomalies.values());
      return {
        columns: ['id', 'query_id', 'component_id', 'metric_name', 'anomaly_pattern', 'ts', 'deviation_score'],
        rows,
        row_count: rows.length,
      };
    }

    if (trimmed.includes('from trace_summary')) {
      const rows = Array.from(this.traceSummaries.values());
      return {
        columns: ['id', 'query_id', 'callee_id', 'window_start', 'window_end', 'total_calls', 'max_latency_ms', 'caller_distribution'],
        rows,
        row_count: rows.length,
      };
    }

    if (trimmed.includes('from log_summary')) {
      const rows = Array.from(this.logSummaries.values());
      return {
        columns: ['id', 'query_id', 'component_id', 'template_id', 'template_text', 'tfidf_score', 'rank_pct', 'earliest_ts', 'level'],
        rows,
        row_count: rows.length,
      };
    }

    if (trimmed.includes('from hypothesis')) {
      const rows = Array.from(this.hypotheses.values());
      return {
        columns: ['hypothesis_id', 'query_id', 'component_id', 'phase_created', 'reason', 'confidence', 'status', 'created_at'],
        rows,
        row_count: rows.length,
      };
    }

    if (trimmed.includes('from component')) {
      const rows = Array.from(this.components.values());
      return {
        columns: ['cmdb_id', 'name', 'type', 'system'],
        rows,
        row_count: rows.length,
      };
    }

    if (trimmed.includes('from query')) {
      const rows = Array.from(this.queries.values());
      return {
        columns: ['query_id', 'question_text', 'window_start', 'window_end', 'system', 'status'],
        rows,
        row_count: rows.length,
      };
    }

    // Default sample result
    return {
      columns: ['table_name', 'row_count'],
      rows: [
        { table_name: 'metric_point', row_count: this.metricPoints.size },
        { table_name: 'span', row_count: this.spans.size },
        { table_name: 'log_entry', row_count: this.logEntries.size },
        { table_name: 'metric_anomaly', row_count: this.metricAnomalies.size },
        { table_name: 'trace_summary', row_count: this.traceSummaries.size },
        { table_name: 'log_summary', row_count: this.logSummaries.size },
      ],
      row_count: 6,
    };
  }
}

export const db = new InMemoryDB();
