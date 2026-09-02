import React, { useState } from 'react';
import { FileText, Search, Tag, AlertTriangle, CheckCircle } from 'lucide-react';
import { LogSummary, LogEntry } from '../types.js';

interface LogIntelligenceViewProps {
  logSummaries: LogSummary[];
  rawLogs: LogEntry[];
}

export const LogIntelligenceView: React.FC<LogIntelligenceViewProps> = ({
  logSummaries,
  rawLogs,
}) => {
  const [filterComponent, setFilterComponent] = useState<string>('all');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  const components = Array.from(new Set(rawLogs.map((l) => l.component_id))).sort();

  const filteredLogs = rawLogs.filter((l) => {
    if (filterComponent !== 'all' && l.component_id !== filterComponent) return false;
    if (searchKeyword && !l.message.toLowerCase().includes(searchKeyword.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* TF-IDF Log Summaries */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-400" />
              Drain-Parsed Log Templates &amp; TF-IDF Priority Ranking
            </h3>
            <p className="text-xs text-slate-400">
              Keywords filtered (fatal, error, crash, fail, timeout) and scored by term-frequency inverse-document frequency.
            </p>
          </div>
          <span className="text-xs font-mono text-amber-400 bg-amber-950/60 px-2 py-1 rounded border border-amber-800/40">
            {logSummaries.length} Top Templates
          </span>
        </div>

        {logSummaries.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400 bg-slate-950/40 rounded-lg border border-slate-800">
            No log summaries processed.
          </div>
        ) : (
          <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
            {logSummaries.map((ls) => (
              <div
                key={ls.id}
                className="bg-slate-950/90 border border-slate-800 p-3 rounded-lg text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-cyan-300 font-mono">{ls.component_id}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                      {ls.template_id}
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        ls.level === 'ERROR' || ls.level === 'CRITICAL'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {ls.level}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-[11px]">
                    <span className="text-slate-400">
                      Score: <strong className="text-amber-400">{ls.tfidf_score}</strong>
                    </span>
                    <span className="text-slate-400">
                      Earliest: {new Date(ls.earliest_ts).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-900 p-2 rounded border border-slate-800/80 font-mono text-[11px] text-slate-200 leading-relaxed break-words">
                  {ls.template_text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Raw Log Explorer */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
          <h4 className="text-sm font-semibold text-white">Raw Incident Log Stream</h4>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="Search log messages..."
                className="bg-slate-950 text-xs text-slate-200 pl-8 pr-2.5 py-1.5 border border-slate-700 rounded font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500 w-full sm:w-48"
              />
            </div>

            <select
              value={filterComponent}
              onChange={(e) => setFilterComponent(e.target.value)}
              aria-label="Filter Component Pod Log"
              className="bg-slate-950 text-xs text-slate-200 px-2.5 py-1.5 border border-slate-700 rounded font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="all">All Pods</option>
              {components.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-lg max-h-60 overflow-y-auto p-2 divide-y divide-slate-800/50 font-mono text-xs">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-6 text-slate-500">No logs matching filter.</div>
          ) : (
            filteredLogs.map((l) => (
              <div key={l.id} className="py-1.5 flex items-start gap-2 text-[11px]">
                <span className="text-slate-500 whitespace-nowrap">
                  {new Date(l.ts).toLocaleTimeString()}
                </span>
                <span className="text-cyan-400 font-semibold w-16 whitespace-nowrap">
                  {l.component_id}
                </span>
                <span
                  className={`px-1 rounded text-[9px] font-bold ${
                    l.level === 'ERROR'
                      ? 'bg-red-500/20 text-red-400'
                      : l.level === 'WARN'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {l.level}
                </span>
                <span className="text-slate-300 flex-1">{l.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
