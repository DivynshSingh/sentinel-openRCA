import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.js';
import { ArchitecturePipeline } from './components/ArchitecturePipeline.js';
import { MetricAnomaliesView } from './components/MetricAnomaliesView.js';
import { TraceExplorerView } from './components/TraceExplorerView.js';
import { LogIntelligenceView } from './components/LogIntelligenceView.js';
import { HypothesisCriticView } from './components/HypothesisCriticView.js';
import { McpPlayground } from './components/McpPlayground.js';
import { SqlRunner } from './components/SqlRunner.js';
import { OpenRcaEvalView } from './components/OpenRcaEvalView.js';
import {
  QueryRecord,
  SystemStats,
  MetricAnomaly,
  MetricPoint,
  TraceSummary,
  TracePath,
  LogSummary,
  LogEntry,
  Hypothesis,
  Finding,
  AgentStep,
} from './types.js';
import {
  Activity,
  GitBranch,
  Cpu,
  FileText,
  ShieldAlert,
  Server,
  Database,
  Info,
  Award,
} from 'lucide-react';

export function App() {
  const [queries, setQueries] = useState<QueryRecord[]>([]);
  const [activeQueryId, setActiveQueryId] = useState<string>('1');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [activeTab, setActiveTab] = useState<'eval' | 'pipeline' | 'metrics' | 'traces' | 'logs' | 'hypotheses' | 'mcp' | 'sql'>('eval');

  // Telemetry & Processed Data
  const [metricAnomalies, setMetricAnomalies] = useState<MetricAnomaly[]>([]);
  const [rawMetrics, setRawMetrics] = useState<MetricPoint[]>([]);
  const [traceSummaries, setTraceSummaries] = useState<TraceSummary[]>([]);
  const [tracePaths, setTracePaths] = useState<TracePath[]>([]);
  const [logSummaries, setLogSummaries] = useState<LogSummary[]>([]);
  const [rawLogs, setRawLogs] = useState<LogEntry[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);

  const [isRunningAgent, setIsRunningAgent] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  // 1. Initial Load: Queries & Stats
  const loadInitial = async () => {
    try {
      const [qRes, sRes] = await Promise.all([
        fetch('/api/queries'),
        fetch('/api/stats'),
      ]);
      const qData = await qRes.json();
      const sData = await sRes.json();
      setQueries(qData);
      setStats(sData);
      if (qData.length > 0 && !activeQueryId) {
        setActiveQueryId(qData[0].query_id);
      }
    } catch (e) {
      console.error('Failed to load initial metadata', e);
    }
  };

  useEffect(() => {
    loadInitial();
  }, []);

  // 2. Load Active Query Data
  const loadQueryData = async (qid: string) => {
    if (!qid) return;
    try {
      const [anomRes, rawMRes, trRes, logSumRes, rawLRes, hypoRes, findRes, stepRes] = await Promise.all([
        fetch(`/api/queries/${qid}/metrics/summary`),
        fetch(`/api/queries/${qid}/metrics`),
        fetch(`/api/queries/${qid}/traces/summary`),
        fetch(`/api/queries/${qid}/logs/summary`),
        fetch(`/api/queries/${qid}/logs`),
        fetch(`/api/queries/${qid}/hypotheses`),
        fetch(`/api/queries/${qid}/findings`),
        fetch(`/api/queries/${qid}/steps`),
      ]);

      const anomData = await anomRes.json();
      const rawMData = await rawMRes.json();
      const trData = await trRes.json();
      const logSumData = await logSumRes.json();
      const rawLData = await rawLRes.json();
      const hypoData = await hypoRes.json();
      const findData = await findRes.json();
      const stepData = await stepRes.json();

      setMetricAnomalies(Array.isArray(anomData) ? anomData : []);
      setRawMetrics(Array.isArray(rawMData) ? rawMData : []);
      setTraceSummaries(trData.summaries || []);
      setTracePaths(trData.paths || []);
      setLogSummaries(Array.isArray(logSumData) ? logSumData : []);
      setRawLogs(Array.isArray(rawLData) ? rawLData : []);
      setHypotheses(Array.isArray(hypoData) ? hypoData : []);
      setFinding(Array.isArray(findData) && findData.length > 0 ? findData[0] : null);
      setAgentSteps(Array.isArray(stepData) ? stepData : []);

      // Refresh global stats
      const sRes = await fetch('/api/stats');
      setStats(await sRes.json());
    } catch (e) {
      console.error('Failed to load query details', e);
    }
  };

  useEffect(() => {
    if (activeQueryId) {
      loadQueryData(activeQueryId);
    }
  }, [activeQueryId]);

  // Phase 0: Process Raw Data
  const handleProcessData = async () => {
    try {
      const res = await fetch(`/api/queries/${activeQueryId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      showNotification(`Phase 0 Data Preprocessing Complete: ${data.metric_anomalies} anomalies, ${data.trace_summaries} trace windows, ${data.log_summaries} log templates.`);
      loadQueryData(activeQueryId);
    } catch (e: any) {
      showNotification(`Preprocessing failed: ${e.message}`);
    }
  };

  // Full 5-Phase Agent Investigation
  const handleRunAgent = async () => {
    setIsRunningAgent(true);
    try {
      const res = await fetch(`/api/investigate/${activeQueryId}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent investigation failed');
      showNotification(`RCA Complete: Root cause identified as ${data.finding.root_cause_component}.`);
      loadQueryData(activeQueryId);
    } catch (e: any) {
      showNotification(`Investigation failed: ${e.message}`);
    } finally {
      setIsRunningAgent(false);
    }
  };

  const currentQuery = queries.find((q) => q.query_id === activeQueryId);

  const tabs = [
    { id: 'eval', label: 'OpenRCA v1 Benchmark & Eval', icon: Award, count: null },
    { id: 'pipeline', label: 'RCA Architecture & Steps', icon: GitBranch, count: agentSteps.length },
    { id: 'metrics', label: 'Metric Anomalies (3-Sigma)', icon: Activity, count: metricAnomalies.length },
    { id: 'traces', label: 'Traces & Call Graphs', icon: Cpu, count: traceSummaries.length },
    { id: 'logs', label: 'Log Intelligence (TF-IDF)', icon: FileText, count: logSummaries.length },
    { id: 'hypotheses', label: 'Hypotheses & Critic', icon: ShieldAlert, count: hypotheses.length },
    { id: 'mcp', label: 'MCP Tools Console', icon: Server, count: 13 },
    { id: 'sql', label: 'DuckDB SQL Runner', icon: Database, count: null },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white">
      {/* Header */}
      <Header
        queries={queries}
        activeQueryId={activeQueryId}
        onSelectQuery={(id) => setActiveQueryId(id)}
        stats={stats}
        isRunningAgent={isRunningAgent}
        onRunAgent={handleRunAgent}
        onProcessData={handleProcessData}
      />

      {/* Notification Toast */}
      {notification && (
        <div className="fixed bottom-4 right-4 z-50 bg-cyan-600 text-white px-4 py-2.5 rounded-lg shadow-xl border border-cyan-400/40 text-xs font-medium animate-bounce flex items-center gap-2">
          <Info className="w-4 h-4" />
          {notification}
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 space-y-5">
        {/* Active Incident Banner */}
        {currentQuery && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold text-xs border border-cyan-500/30">
                  {currentQuery.system} Banking Microservices
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Time Window: {new Date(currentQuery.window_start).toLocaleTimeString()} - {new Date(currentQuery.window_end).toLocaleTimeString()} UTC
                </span>
              </div>
              <h2 className="text-sm font-semibold text-white">
                {currentQuery.question_text}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Status:</span>
              <span
                className={`px-2.5 py-1 rounded text-xs font-bold font-mono uppercase ${
                  currentQuery.status === 'done'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : currentQuery.status === 'processing'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {currentQuery.status}
              </span>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-800 pb-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
                  isActive
                    ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/20'
                    : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 border border-slate-800/80'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
                {t.count !== null && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      isActive ? 'bg-cyan-700 text-cyan-100' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content Panels */}
        <div className="transition-all">
          {activeTab === 'eval' && (
            <OpenRcaEvalView
              onSelectQuery={(id) => {
                setActiveQueryId(id);
                setActiveTab('pipeline');
              }}
            />
          )}

          {activeTab === 'pipeline' && (
            <ArchitecturePipeline
              steps={agentSteps}
              finding={finding}
              groundTruth={currentQuery?.ground_truth}
            />
          )}

          {activeTab === 'metrics' && (
            <MetricAnomaliesView
              anomalies={metricAnomalies}
              rawMetrics={rawMetrics}
            />
          )}

          {activeTab === 'traces' && (
            <TraceExplorerView
              summaries={traceSummaries}
              paths={tracePaths}
            />
          )}

          {activeTab === 'logs' && (
            <LogIntelligenceView
              logSummaries={logSummaries}
              rawLogs={rawLogs}
            />
          )}

          {activeTab === 'hypotheses' && (
            <HypothesisCriticView
              hypotheses={hypotheses}
            />
          )}

          {activeTab === 'mcp' && (
            <McpPlayground activeQueryId={activeQueryId} />
          )}

          {activeTab === 'sql' && (
            <SqlRunner />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950/80 py-4 px-4 text-center text-xs text-slate-500 font-mono">
        Sentinel OpenRCA Benchmark Engine &bull; Locked Architecture: Phase 0 Deterministic Preprocessing + Phase 1-4 LangGraph Parallel Agents
      </footer>
    </div>
  );
}
