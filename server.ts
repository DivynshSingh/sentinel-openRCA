import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db.js';
import { defaultProcessor } from './server/dataProcessor.js';
import { AgentRCAEngine } from './server/agentEngine.js';
import { SentinelMCPServer } from './server/mcp.js';
import { OpenRCAEvalEngine, OpenRCABenchmarkSummary } from './server/evalEngine.js';

let latestEvalSummary: OpenRCABenchmarkSummary | null = null;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // ------------------------------------------------------------------
  // HEALTH
  // ------------------------------------------------------------------
  app.get(['/health', '/api/health'], (req, res) => {
    res.json({ status: 'ok', service: 'sentinel-rest', version: '2.0.0', system: 'Bank' });
  });

  // ------------------------------------------------------------------
  // OVERVIEW & STATS
  // ------------------------------------------------------------------
  app.get('/api/stats', (req, res) => {
    res.json({
      system: 'Bank',
      componentsCount: db.components.size,
      metricPointsCount: db.metricPoints.size,
      spansCount: db.spans.size,
      logEntriesCount: db.logEntries.size,
      queriesCount: db.queries.size,
      metricAnomaliesCount: db.metricAnomalies.size,
      traceSummariesCount: db.traceSummaries.size,
      logSummariesCount: db.logSummaries.size,
      hypothesesCount: db.hypotheses.size,
      findingsCount: db.findings.size,
      agentStepsCount: db.agentSteps.size,
    });
  });

  // ------------------------------------------------------------------
  // QUERIES
  // ------------------------------------------------------------------
  app.get(['/queries', '/api/queries'], (req, res) => {
    const status = req.query.status as string | undefined;
    let list = Array.from(db.queries.values());
    if (status) {
      list = list.filter((q) => q.status === status);
    }
    res.json(list);
  });

  app.get(['/queries/:qid', '/api/queries/:qid'], (req, res) => {
    const q = db.queries.get(req.params.qid);
    if (!q) return res.status(404).json({ detail: 'Query not found' });
    res.json(q);
  });

  // ------------------------------------------------------------------
  // DATA PROCESSOR
  // ------------------------------------------------------------------
  app.post(['/queries/:qid/process', '/api/queries/:qid/process'], (req, res) => {
    const force = Boolean(req.body?.force);
    const result = defaultProcessor.processQuery(req.params.qid, force);
    if (result.status === 'error') {
      return res.status(404).json({ detail: result.reason });
    }
    res.json(result);
  });

  // ------------------------------------------------------------------
  // METRICS
  // ------------------------------------------------------------------
  app.get(['/queries/:qid/metrics/summary', '/api/queries/:qid/metrics/summary'], (req, res) => {
    const list = Array.from(db.metricAnomalies.values()).filter((a) => a.query_id === req.params.qid);
    list.sort((a, b) => b.deviation_score - a.deviation_score);
    res.json(list);
  });

  app.get(['/queries/:qid/metrics', '/api/queries/:qid/metrics'], (req, res) => {
    const q = db.queries.get(req.params.qid);
    if (!q) return res.status(404).json({ detail: 'Query not found' });

    const startMs = new Date(q.window_start).getTime();
    const endMs = new Date(q.window_end).getTime();
    const component = req.query.component as string | undefined;
    const metric = req.query.metric as string | undefined;

    const list = Array.from(db.metricPoints.values()).filter((mp) => {
      const tMs = new Date(mp.ts).getTime();
      if (tMs < startMs || tMs > endMs) return false;
      if (component && mp.component_id !== component) return false;
      if (metric && mp.kpi_name !== metric) return false;
      return true;
    });
    res.json(list);
  });

  // ------------------------------------------------------------------
  // TRACES
  // ------------------------------------------------------------------
  app.get(['/queries/:qid/traces/summary', '/api/queries/:qid/traces/summary'], (req, res) => {
    const summaries = Array.from(db.traceSummaries.values()).filter((s) => s.query_id === req.params.qid);
    const paths = Array.from(db.tracePaths.values()).filter((p) => p.query_id === req.params.qid);
    summaries.sort((a, b) => b.max_latency_ms - a.max_latency_ms);
    paths.sort((a, b) => b.frequency - a.frequency);
    res.json({ summaries, paths });
  });

  app.get(['/queries/:qid/traces', '/api/queries/:qid/traces'], (req, res) => {
    const q = db.queries.get(req.params.qid);
    if (!q) return res.status(404).json({ detail: 'Query not found' });

    const startMs = new Date(q.window_start).getTime();
    const endMs = new Date(q.window_end).getTime();
    const traceId = req.query.trace_id as string | undefined;
    const component = req.query.component as string | undefined;

    const list = Array.from(db.spans.values()).filter((s) => {
      const tMs = new Date(s.start_time).getTime();
      if (tMs < startMs || tMs > endMs) return false;
      if (traceId && s.trace_id !== traceId) return false;
      if (component && s.component_id !== component) return false;
      return true;
    });
    list.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    res.json(list);
  });

  app.get(['/traces/spans/:sid/upstream', '/api/traces/spans/:sid/upstream'], (req, res) => {
    const maxHops = parseInt((req.query.max_hops as string) || '10', 10);
    const result = AgentRCAEngine.walkUpstreamTrace(req.params.sid, maxHops);
    res.json(result);
  });

  // ------------------------------------------------------------------
  // LOGS
  // ------------------------------------------------------------------
  app.get(['/queries/:qid/logs/summary', '/api/queries/:qid/logs/summary'], (req, res) => {
    const list = Array.from(db.logSummaries.values()).filter((l) => l.query_id === req.params.qid);
    list.sort((a, b) => b.tfidf_score - a.tfidf_score);
    res.json(list);
  });

  app.get(['/queries/:qid/logs', '/api/queries/:qid/logs'], (req, res) => {
    const q = db.queries.get(req.params.qid);
    if (!q) return res.status(404).json({ detail: 'Query not found' });

    const startMs = new Date(q.window_start).getTime();
    const endMs = new Date(q.window_end).getTime();
    const component = req.query.component as string | undefined;
    const level = req.query.level as string | undefined;

    const list = Array.from(db.logEntries.values()).filter((l) => {
      const tMs = new Date(l.ts).getTime();
      if (tMs < startMs || tMs > endMs) return false;
      if (component && l.component_id !== component) return false;
      if (level && l.level !== level) return false;
      return true;
    });
    list.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    res.json(list);
  });

  // ------------------------------------------------------------------
  // SQL RUNNER
  // ------------------------------------------------------------------
  app.post(['/query', '/api/query'], (req, res) => {
    const sql = req.body?.sql || '';
    try {
      const result = db.executeSql(sql);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ detail: e.message });
    }
  });

  // ------------------------------------------------------------------
  // HYPOTHESES
  // ------------------------------------------------------------------
  app.post(['/queries/:qid/hypotheses', '/api/queries/:qid/hypotheses'], (req, res) => {
    const q = db.queries.get(req.params.qid);
    if (!q) return res.status(404).json({ detail: 'Query not found' });

    const hid = req.body.hypothesis_id || `hypo-${Math.random().toString(36).substring(2, 9)}`;
    const hypo = {
      hypothesis_id: hid,
      query_id: req.params.qid,
      component_id: req.body.component_id,
      phase_created: req.body.phase_created,
      reason: req.body.reason,
      confidence: req.body.confidence,
      status: 'active' as const,
      created_at: new Date().toISOString(),
    };
    db.hypotheses.set(hid, hypo);
    res.json({ hypothesis_id: hid, status: 'created' });
  });

  app.get(['/queries/:qid/hypotheses', '/api/queries/:qid/hypotheses'], (req, res) => {
    const status = req.query.status as string | undefined;
    let list = Array.from(db.hypotheses.values()).filter((h) => h.query_id === req.params.qid);
    if (status) {
      list = list.filter((h) => h.status === status);
    }
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(list);
  });

  app.patch(['/hypotheses/:hid', '/api/hypotheses/:hid'], (req, res) => {
    const h = db.hypotheses.get(req.params.hid);
    if (!h) return res.status(404).json({ detail: 'Hypothesis not found' });

    if (req.body.status !== undefined) h.status = req.body.status;
    if (req.body.superseded_by !== undefined) h.superseded_by = req.body.superseded_by;
    if (req.body.confidence !== undefined) h.confidence = req.body.confidence;

    res.json({ hypothesis_id: req.params.hid, status: 'updated' });
  });

  // ------------------------------------------------------------------
  // FINDINGS
  // ------------------------------------------------------------------
  app.post(['/queries/:qid/findings', '/api/queries/:qid/findings'], (req, res) => {
    const q = db.queries.get(req.params.qid);
    if (!q) return res.status(404).json({ detail: 'Query not found' });

    const fid = req.body.finding_id || `find-${Math.random().toString(36).substring(2, 9)}`;
    const finding = {
      finding_id: fid,
      query_id: req.params.qid,
      hypothesis_id: req.body.hypothesis_id,
      root_cause_time: req.body.root_cause_time,
      root_cause_component: req.body.root_cause_component,
      root_cause_reason: req.body.root_cause_reason,
      confirmed_at: new Date().toISOString(),
    };
    db.findings.set(fid, finding);
    q.status = 'done';
    res.json({ finding_id: fid, status: 'created' });
  });

  app.get(['/queries/:qid/findings', '/api/queries/:qid/findings'], (req, res) => {
    const list = Array.from(db.findings.values()).filter((f) => f.query_id === req.params.qid);
    res.json(list);
  });

  // ------------------------------------------------------------------
  // AGENT STEPS
  // ------------------------------------------------------------------
  app.post(['/queries/:qid/steps', '/api/queries/:qid/steps'], (req, res) => {
    const sid = req.body.step_id || `step-${Date.now()}`;
    const step = {
      step_id: sid,
      query_id: req.params.qid,
      phase: req.body.phase,
      tool_name: req.body.tool_name,
      args: req.body.args,
      result_summary: req.body.result_summary,
      ts: new Date().toISOString(),
    };
    db.agentSteps.set(sid, step);
    res.json({ step_id: sid, status: 'logged' });
  });

  app.get(['/queries/:qid/steps', '/api/queries/:qid/steps'], (req, res) => {
    const list = Array.from(db.agentSteps.values()).filter((s) => s.query_id === req.params.qid);
    list.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    res.json(list);
  });

  // ------------------------------------------------------------------
  // AGENT RCA EXECUTION ENGINE
  // ------------------------------------------------------------------
  app.post('/api/investigate/:qid', async (req, res) => {
    try {
      const result = await AgentRCAEngine.runInvestigation(req.params.qid);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ------------------------------------------------------------------
  // OPENRCA VERSION 1 BENCHMARK & EVALUATION ENGINE
  // ------------------------------------------------------------------
  app.post('/api/eval/run', async (req, res) => {
    try {
      const queryIds = req.body?.query_ids as string[] | undefined;
      const summary = await OpenRCAEvalEngine.runBenchmarkSuite(queryIds);
      latestEvalSummary = summary;
      res.json(summary);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/eval/summary', async (req, res) => {
    try {
      if (!latestEvalSummary) {
        latestEvalSummary = await OpenRCAEvalEngine.runBenchmarkSuite();
      }
      res.json(latestEvalSummary);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/eval/export', async (req, res) => {
    try {
      if (!latestEvalSummary) {
        latestEvalSummary = await OpenRCAEvalEngine.runBenchmarkSuite();
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="openrca_v1_eval_results.json"');
      res.send(JSON.stringify(latestEvalSummary, null, 2));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ------------------------------------------------------------------
  // MCP SERVER TOOLS
  // ------------------------------------------------------------------
  app.get('/api/mcp/tools', (req, res) => {
    res.json({ tools: SentinelMCPServer.getTools() });
  });

  app.post('/api/mcp/call', (req, res) => {
    const { name, arguments: args } = req.body;
    try {
      const result = SentinelMCPServer.handleTool(name, args || {});
      res.json({ result });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ------------------------------------------------------------------
  // VITE MIDDLEWARE (Development) vs STATIC (Production)
  // ------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sentinel RCA System Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
