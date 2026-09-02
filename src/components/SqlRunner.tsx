import React, { useState } from 'react';
import { Database, Play, Code, Check } from 'lucide-react';

export const SqlRunner: React.FC = () => {
  const [sql, setSql] = useState<string>('SELECT * FROM metric_anomalies LIMIT 10;');
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const presets = [
    { label: 'Metric Anomalies', query: 'SELECT * FROM metric_anomalies LIMIT 10;' },
    { label: 'High Latency Spans', query: 'SELECT * FROM spans WHERE duration_ms > 200 LIMIT 10;' },
    { label: 'Error Logs', query: 'SELECT * FROM log_entries WHERE level = "ERROR" LIMIT 10;' },
    { label: 'Hypotheses', query: 'SELECT * FROM hypotheses;' },
    { label: 'All Findings', query: 'SELECT * FROM findings;' },
  ];

  const handleRun = async (queryText?: string) => {
    const q = queryText || sql;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'SQL failed');
      setResults(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            DuckDB In-Memory Telemetry SQL Explorer
          </h3>
          <p className="text-xs text-slate-400">
            Query tables: components, metric_points, spans, log_entries, metric_anomalies, trace_summaries, hypotheses, findings.
          </p>
        </div>

        <button
          onClick={() => handleRun()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          {loading ? 'Executing...' : 'Run Query'}
        </button>
      </div>

      {/* Preset Queries */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-400 mr-1">Presets:</span>
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setSql(p.query);
              handleRun(p.query);
            }}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-cyan-300 border border-slate-700 transition"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* SQL Editor */}
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        rows={3}
        className="w-full bg-slate-950 text-xs font-mono text-emerald-300 border border-slate-700 rounded p-2.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />

      {error && (
        <div className="p-2 text-xs text-red-400 bg-red-950/30 rounded border border-red-500/20 font-mono">
          {error}
        </div>
      )}

      {/* Result Table */}
      {results && results.length > 0 ? (
        <div className="bg-slate-950 border border-slate-800 rounded-lg max-h-72 overflow-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 uppercase">
              <tr>
                {Object.keys(results[0]).map((col) => (
                  <th key={col} className="py-2 px-3 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300 text-[11px]">
              {results.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-800/30">
                  {Object.values(row).map((val: any, cIdx) => (
                    <td key={cIdx} className="py-1.5 px-3 whitespace-nowrap">
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        results && results.length === 0 && (
          <div className="text-center py-6 text-xs text-slate-400 bg-slate-950/40 rounded-lg border border-slate-800 font-mono">
            Query returned 0 rows.
          </div>
        )
      )}
    </div>
  );
};
