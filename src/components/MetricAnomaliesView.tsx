import React, { useState, useMemo } from 'react';
import { Activity, AlertCircle, TrendingUp, Zap, BarChart2, Filter } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { MetricAnomaly, MetricPoint } from '../types.js';

interface MetricAnomaliesViewProps {
  anomalies: MetricAnomaly[];
  rawMetrics: MetricPoint[];
}

export const MetricAnomaliesView: React.FC<MetricAnomaliesViewProps> = ({
  anomalies,
  rawMetrics,
}) => {
  const [selectedComponent, setSelectedComponent] = useState<string>('pod-07');
  const [selectedMetric, setSelectedMetric] = useState<string>('cpu_usage');

  // Unique components and metrics in dataset
  const components = useMemo(() => {
    const set = new Set<string>();
    rawMetrics.forEach((m) => set.add(m.component_id));
    return Array.from(set).sort();
  }, [rawMetrics]);

  const metricsList = useMemo(() => {
    const set = new Set<string>();
    rawMetrics.forEach((m) => set.add(m.kpi_name));
    return Array.from(set).sort();
  }, [rawMetrics]);

  // Chart data for selected component & metric
  const chartData = useMemo(() => {
    const filtered = rawMetrics
      .filter((m) => m.component_id === selectedComponent && m.kpi_name === selectedMetric)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    return filtered.map((m) => ({
      time: new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: m.value,
      isAnomalous: anomalies.some(
        (a) => a.component_id === m.component_id && a.metric_name === m.kpi_name && a.ts === m.ts
      ),
    }));
  }, [rawMetrics, anomalies, selectedComponent, selectedMetric]);

  const getShapeBadge = (pattern: string) => {
    switch (pattern) {
      case 'steady_rise':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
            <TrendingUp className="w-3 h-3" /> Steady Rise
          </span>
        );
      case 'level_shift':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <BarChart2 className="w-3 h-3" /> Level Shift
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
            <Zap className="w-3 h-3" /> Spike
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Metric Anomaly Summary Table */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Detected Metric Anomalies (3-Sigma Rule &amp; Top-K Ranking)
            </h3>
            <p className="text-xs text-slate-400">
              Deterministic Phase 0 output: Classified anomaly patterns and calculated standard deviation z-scores.
            </p>
          </div>
          <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-2 py-1 rounded border border-cyan-800/40">
            {anomalies.length} Anomalies Flagged
          </span>
        </div>

        {anomalies.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400 bg-slate-950/40 rounded-lg border border-slate-800">
            No processed metric anomalies. Click <strong>"Process Phase 0"</strong> or <strong>"Run Full RCA Agent"</strong>.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] font-semibold text-slate-400 bg-slate-950/80 sticky top-0 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">Component</th>
                  <th className="py-2 px-3">Metric KPI</th>
                  <th className="py-2 px-3">Anomaly Pattern</th>
                  <th className="py-2 px-3">Deviation Score</th>
                  <th className="py-2 px-3">Onset Timestamp</th>
                  <th className="py-2 px-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {anomalies.map((anom) => (
                  <tr
                    key={anom.id}
                    className={`hover:bg-slate-800/40 transition cursor-pointer ${
                      anom.component_id === selectedComponent ? 'bg-cyan-950/20' : ''
                    }`}
                    onClick={() => {
                      setSelectedComponent(anom.component_id);
                      setSelectedMetric(anom.metric_name);
                    }}
                  >
                    <td className="py-2 px-3 font-semibold text-cyan-300">{anom.component_id}</td>
                    <td className="py-2 px-3 text-slate-300">{anom.metric_name}</td>
                    <td className="py-2 px-3">{getShapeBadge(anom.anomaly_pattern)}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 font-bold border border-red-500/20">
                        {anom.deviation_score}σ
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-400 text-[11px]">
                      {new Date(anom.ts).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3 text-slate-400">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedComponent(anom.component_id);
                          setSelectedMetric(anom.metric_name);
                        }}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 underline"
                      >
                        Plot Time-Series
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Interactive Time Series Chart */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-white">
              Time Series Inspector: <span className="text-cyan-400 font-mono">{selectedComponent}</span> &bull; <span className="text-slate-300 font-mono">{selectedMetric}</span>
            </h4>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedComponent}
              onChange={(e) => setSelectedComponent(e.target.value)}
              aria-label="Filter Component Pod"
              className="bg-slate-950 text-xs text-slate-200 border border-slate-700 rounded px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
            >
              {components.map((c) => (
                <option key={c} value={c}>
                  {c} {c === 'pod-07' ? '★ (Root Cause)' : ''}
                </option>
              ))}
            </select>

            <select
              value={selectedMetric}
              onChange={(e) => setSelectedMetric(e.target.value)}
              aria-label="Filter Metric KPI"
              className="bg-slate-950 text-xs text-slate-200 border border-slate-700 rounded px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
            >
              {metricsList.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-400">
            No telemetry points available for selected parameters.
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={`${selectedMetric} (${selectedComponent})`}
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    if (payload.isAnomalous) {
                      return (
                        <circle
                          key={`dot-${cx}-${cy}`}
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill="#ef4444"
                          stroke="#ffffff"
                          strokeWidth={1.5}
                        />
                      );
                    }
                    return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={2} fill="#06b6d4" />;
                  }}
                  activeDot={{ r: 6, fill: '#38bdf8' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
