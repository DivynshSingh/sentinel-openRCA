import React from 'react';
import { Shield, Activity, Cpu, Server, Play, RefreshCw, Layers } from 'lucide-react';
import { QueryRecord, SystemStats } from '../types.js';

interface HeaderProps {
  queries: QueryRecord[];
  activeQueryId: string;
  onSelectQuery: (id: string) => void;
  stats: SystemStats | null;
  isRunningAgent: boolean;
  onRunAgent: () => void;
  onProcessData: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  queries,
  activeQueryId,
  onSelectQuery,
  stats,
  isRunningAgent,
  onRunAgent,
  onProcessData,
}) => {
  return (
    <header id="main-header" className="bg-slate-900/90 backdrop-blur border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Brand & System */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400/30">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Sentinel
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-medium">
                  OpenRCA Benchmark
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400">
              Deterministic Data Processor &amp; Parallel Agentic Root Cause Analysis
            </p>
          </div>
        </div>

        {/* Query selector & Actions */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center bg-slate-800/80 rounded-lg p-1 border border-slate-700">
            <span className="text-xs font-semibold text-slate-400 px-2 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" /> Incident:
            </span>
            <select
              id="query-select-dropdown"
              value={activeQueryId}
              onChange={(e) => onSelectQuery(e.target.value)}
              aria-label="Select Incident Query"
              className="bg-slate-900 text-xs text-slate-200 rounded px-2.5 py-1.5 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
            >
              {queries.map((q) => (
                <option key={q.query_id} value={q.query_id}>
                  Query #{q.query_id} ({q.system}) - [{q.status.toUpperCase()}]
                </option>
              ))}
            </select>
          </div>

          <button
            id="btn-process-raw"
            onClick={onProcessData}
            title="Run 3-Sigma, Trace Latency 95th-pct & Log TF-IDF Data Processor"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            Process Phase 0
          </button>

          <button
            id="btn-run-rca"
            onClick={onRunAgent}
            disabled={isRunningAgent}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white shadow-md transition ${
              isRunningAgent
                ? 'bg-slate-700 cursor-not-allowed text-slate-400'
                : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-cyan-500/20'
            }`}
          >
            {isRunningAgent ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Investigating...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Run Full RCA Agent
              </>
            )}
          </button>
        </div>
      </div>

      {/* Mini Stats Bar */}
      {stats && (
        <div className="bg-slate-950/60 border-t border-slate-800/80 px-4 py-1.5 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2 max-w-7xl mx-auto">
          <div className="flex items-center space-x-4">
            <span className="flex items-center gap-1">
              <Server className="w-3 h-3 text-cyan-400" /> {stats.componentsCount} Microservice Pods
            </span>
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-emerald-400" /> {stats.metricPointsCount} Metric Points
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-purple-400" /> {stats.spansCount} Spans &amp; {stats.logEntriesCount} Logs
            </span>
          </div>
          <div className="flex items-center space-x-3 text-slate-400 font-mono">
            <span>REST API: <span className="text-emerald-400 font-semibold">ONLINE (:3000)</span></span>
            <span>MCP Tools: <span className="text-cyan-400 font-semibold">13 Active</span></span>
          </div>
        </div>
      )}
    </header>
  );
};
