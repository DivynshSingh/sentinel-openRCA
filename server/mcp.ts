import { db } from './db.js';
import { defaultProcessor } from './dataProcessor.js';
import { AgentRCAEngine } from './agentEngine.js';

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export class SentinelMCPServer {
  static getTools(): MCPToolDefinition[] {
    return [
      {
        name: 'process_query',
        description: 'Run data processor for a query. Idempotent — skips if already processed.',
        inputSchema: {
          type: 'object',
          properties: {
            query_id: { type: 'string', description: 'Query ID to process' },
            force: { type: 'boolean', description: 'Force re-processing even if already done', default: false },
          },
          required: ['query_id'],
        },
      },
      {
        name: 'summarize_metrics',
        description: 'Get pre-processed metric anomalies for a query (3-sigma + shape classification + top-K).',
        inputSchema: {
          type: 'object',
          properties: { query_id: { type: 'string' } },
          required: ['query_id'],
        },
      },
      {
        name: 'fetch_metrics',
        description: 'Fetch raw metric time-series points for a query window.',
        inputSchema: {
          type: 'object',
          properties: {
            query_id: { type: 'string' },
            component: { type: 'string', description: 'Filter by component_id' },
            metric: { type: 'string', description: 'Filter by kpi_name' },
          },
          required: ['query_id'],
        },
      },
      {
        name: 'summarize_traces',
        description: 'Get pre-processed trace summaries and 3-hop call paths for a query.',
        inputSchema: {
          type: 'object',
          properties: { query_id: { type: 'string' } },
          required: ['query_id'],
        },
      },
      {
        name: 'fetch_traces',
        description: 'Fetch raw spans for a query window.',
        inputSchema: {
          type: 'object',
          properties: {
            query_id: { type: 'string' },
            trace_id: { type: 'string' },
            component: { type: 'string' },
          },
          required: ['query_id'],
        },
      },
      {
        name: 'walk_upstream_trace',
        description: 'Deterministic upstream walk from a span via parent_span_id. Returns ancestor chain with anomaly flags.',
        inputSchema: {
          type: 'object',
          properties: {
            span_id: { type: 'string', description: 'Starting span ID' },
            max_hops: { type: 'integer', default: 10 },
          },
          required: ['span_id'],
        },
      },
      {
        name: 'summarize_logs',
        description: 'Get pre-processed log summaries for a query (keyword-filtered + template-parsed + TF-IDF ranked).',
        inputSchema: {
          type: 'object',
          properties: { query_id: { type: 'string' } },
          required: ['query_id'],
        },
      },
      {
        name: 'fetch_logs',
        description: 'Fetch raw log entries for a query window.',
        inputSchema: {
          type: 'object',
          properties: {
            query_id: { type: 'string' },
            component: { type: 'string' },
            level: { type: 'string' },
          },
          required: ['query_id'],
        },
      },
      {
        name: 'run_sql',
        description: 'Execute SQL against Sentinel in-memory telemetry and evidence tables.',
        inputSchema: {
          type: 'object',
          properties: { sql: { type: 'string' } },
          required: ['sql'],
        },
      },
      {
        name: 'create_hypothesis',
        description: 'Create a new hypothesis with evidence citations.',
        inputSchema: {
          type: 'object',
          properties: {
            query_id: { type: 'string' },
            component_id: { type: 'string' },
            phase_created: { type: 'string' },
            reason: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['query_id', 'component_id', 'phase_created', 'reason'],
        },
      },
      {
        name: 'get_hypotheses',
        description: 'Get all hypotheses for a query, optionally filtered by status.',
        inputSchema: {
          type: 'object',
          properties: {
            query_id: { type: 'string' },
            status: { type: 'string' },
          },
          required: ['query_id'],
        },
      },
      {
        name: 'update_hypothesis',
        description: 'Update hypothesis status (drop, confirm, supersede).',
        inputSchema: {
          type: 'object',
          properties: {
            hypothesis_id: { type: 'string' },
            status: { type: 'string' },
            superseded_by: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['hypothesis_id'],
        },
      },
      {
        name: 'create_finding',
        description: 'Create final root cause finding. Marks query as done.',
        inputSchema: {
          type: 'object',
          properties: {
            query_id: { type: 'string' },
            hypothesis_id: { type: 'string' },
            root_cause_time: { type: 'string' },
            root_cause_component: { type: 'string' },
            root_cause_reason: { type: 'string' },
          },
          required: ['query_id'],
        },
      },
      {
        name: 'log_agent_step',
        description: 'Log an agent step for observability and debugging.',
        inputSchema: {
          type: 'object',
          properties: {
            query_id: { type: 'string' },
            phase: { type: 'string' },
            tool_name: { type: 'string' },
            args: { type: 'object' },
            result_summary: { type: 'string' },
          },
          required: ['query_id', 'phase', 'tool_name'],
        },
      },
    ];
  }

  static handleTool(name: string, args: Record<string, any>): any {
    switch (name) {
      case 'process_query':
        return defaultProcessor.processQuery(args.query_id, args.force);

      case 'summarize_metrics': {
        const list = Array.from(db.metricAnomalies.values()).filter((a) => a.query_id === args.query_id);
        list.sort((a, b) => b.deviation_score - a.deviation_score);
        return list;
      }

      case 'fetch_metrics': {
        const q = db.queries.get(args.query_id);
        if (!q) throw new Error('Query not found');
        const startMs = new Date(q.window_start).getTime();
        const endMs = new Date(q.window_end).getTime();

        return Array.from(db.metricPoints.values()).filter((mp) => {
          const tMs = new Date(mp.ts).getTime();
          if (tMs < startMs || tMs > endMs) return false;
          if (args.component && mp.component_id !== args.component) return false;
          if (args.metric && mp.kpi_name !== args.metric) return false;
          return true;
        });
      }

      case 'summarize_traces': {
        const summaries = Array.from(db.traceSummaries.values()).filter((s) => s.query_id === args.query_id);
        const paths = Array.from(db.tracePaths.values()).filter((p) => p.query_id === args.query_id);
        return { summaries, paths };
      }

      case 'fetch_traces': {
        const q = db.queries.get(args.query_id);
        if (!q) throw new Error('Query not found');
        const startMs = new Date(q.window_start).getTime();
        const endMs = new Date(q.window_end).getTime();

        return Array.from(db.spans.values()).filter((s) => {
          const tMs = new Date(s.start_time).getTime();
          if (tMs < startMs || tMs > endMs) return false;
          if (args.trace_id && s.trace_id !== args.trace_id) return false;
          if (args.component && s.component_id !== args.component) return false;
          return true;
        });
      }

      case 'walk_upstream_trace':
        return AgentRCAEngine.walkUpstreamTrace(args.span_id, args.max_hops ?? 10);

      case 'summarize_logs': {
        const list = Array.from(db.logSummaries.values()).filter((l) => l.query_id === args.query_id);
        list.sort((a, b) => b.tfidf_score - a.tfidf_score);
        return list;
      }

      case 'fetch_logs': {
        const q = db.queries.get(args.query_id);
        if (!q) throw new Error('Query not found');
        const startMs = new Date(q.window_start).getTime();
        const endMs = new Date(q.window_end).getTime();

        return Array.from(db.logEntries.values()).filter((l) => {
          const tMs = new Date(l.ts).getTime();
          if (tMs < startMs || tMs > endMs) return false;
          if (args.component && l.component_id !== args.component) return false;
          if (args.level && l.level !== args.level) return false;
          return true;
        });
      }

      case 'run_sql':
        return db.executeSql(args.sql);

      case 'create_hypothesis': {
        const hid = args.hypothesis_id || `hypo-${Math.random().toString(36).substring(2, 9)}`;
        const hypo = {
          hypothesis_id: hid,
          query_id: args.query_id,
          component_id: args.component_id,
          phase_created: args.phase_created,
          reason: args.reason,
          confidence: args.confidence,
          status: 'active' as const,
          created_at: new Date().toISOString(),
        };
        db.hypotheses.set(hid, hypo);
        return { hypothesis_id: hid, status: 'created' };
      }

      case 'get_hypotheses': {
        return Array.from(db.hypotheses.values()).filter((h) => {
          if (h.query_id !== args.query_id) return false;
          if (args.status && h.status !== args.status) return false;
          return true;
        });
      }

      case 'update_hypothesis': {
        const h = db.hypotheses.get(args.hypothesis_id);
        if (!h) throw new Error('Hypothesis not found');
        if (args.status) h.status = args.status;
        if (args.superseded_by !== undefined) h.superseded_by = args.superseded_by;
        if (args.confidence !== undefined) h.confidence = args.confidence;
        return { hypothesis_id: args.hypothesis_id, status: 'updated' };
      }

      case 'create_finding': {
        const fid = args.finding_id || `find-${Math.random().toString(36).substring(2, 9)}`;
        const finding = {
          finding_id: fid,
          query_id: args.query_id,
          hypothesis_id: args.hypothesis_id,
          root_cause_time: args.root_cause_time,
          root_cause_component: args.root_cause_component,
          root_cause_reason: args.root_cause_reason,
          confirmed_at: new Date().toISOString(),
        };
        db.findings.set(fid, finding);
        const q = db.queries.get(args.query_id);
        if (q) q.status = 'done';
        return { finding_id: fid, status: 'created' };
      }

      case 'log_agent_step': {
        const sid = args.step_id || `step-${Date.now()}`;
        const step = {
          step_id: sid,
          query_id: args.query_id,
          phase: args.phase,
          tool_name: args.tool_name,
          args: args.args,
          result_summary: args.result_summary,
          ts: new Date().toISOString(),
        };
        db.agentSteps.set(sid, step);
        return { step_id: sid, status: 'logged' };
      }

      default:
        throw new Error(`Unknown tool ${name}`);
    }
  }
}
