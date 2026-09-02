import React, { useState } from 'react';
import { GitCommit, ArrowRight, ShieldCheck, Cpu, Play, Search, AlertCircle } from 'lucide-react';
import { TraceSummary, TracePath } from '../types.js';

interface TraceExplorerViewProps {
  summaries: TraceSummary[];
  paths: TracePath[];
}

export const TraceExplorerView: React.FC<TraceExplorerViewProps> = ({
  summaries,
  paths,
}) => {
  const [targetSpanId, setTargetSpanId] = useState<string>('span-cache-08');
  const [upstreamChain, setUpstreamChain] = useState<any[] | null>(null);
  const [isWalking, setIsWalking] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleWalkTrace = async (spanId: string) => {
    setIsWalking(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/traces/spans/${spanId}/upstream?max_hops=10`);
      if (!res.ok) throw new Error(`Walk failed: ${res.statusText}`);
      const data = await res.json();
      setUpstreamChain(data.chain || []);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setIsWalking(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Trace Summaries & 3-Hop Paths */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trace Summaries */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-purple-400" />
            High Latency Trace Summaries (95th Pctile)
          </h3>
          <p className="text-xs text-slate-400 mb-3">
            Callee pods aggregated in 60s windows with caller distributions.
          </p>

          {summaries.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-400 bg-slate-950/40 rounded-lg border border-slate-800">
              No trace summaries processed.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {summaries.map((s) => (
                <div
                  key={s.id}
                  className="bg-slate-950/80 border border-slate-800 p-3 rounded-lg text-xs"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-cyan-300 font-mono">Callee: {s.callee_id}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 font-mono">
                      Max Latency: {s.max_latency_ms}ms
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mb-2 font-mono">
                    Window: {new Date(s.window_start).toLocaleTimeString()} - {new Date(s.window_end).toLocaleTimeString()} ({s.total_calls} calls)
                  </div>
                  <div className="text-[10px] text-slate-400">
                    <span className="font-semibold text-slate-300">Callers: </span>
                    {Object.entries(s.caller_distribution).map(([caller, count]) => (
                      <span
                        key={caller}
                        className="inline-block bg-slate-800 px-1.5 py-0.5 rounded mr-1 font-mono text-slate-200"
                      >
                        {caller} ({count}x)
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3-Hop Paths */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <GitCommit className="w-4 h-4 text-cyan-400" />
            Extracted 3-Hop Call Paths
          </h3>
          <p className="text-xs text-slate-400 mb-3">
            Ancestry chains extracted from high latency spans (Grandparent → Caller → Callee).
          </p>

          {paths.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-400 bg-slate-950/40 rounded-lg border border-slate-800">
              No 3-hop paths extracted.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {paths.map((p) => (
                <div
                  key={p.id}
                  className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg text-xs flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-slate-400">{p.grandparent_id || 'root'}</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <span className="text-cyan-300">{p.caller_id}</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <span className="text-red-400 font-bold">{p.callee_id}</span>
                  </div>
                  <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] font-mono">
                    freq: {p.frequency}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Upstream Trace Walker (Anti-Salience) */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Deterministic Upstream Trace Walker (Anti-Salience Defense)
            </h3>
            <p className="text-xs text-slate-400">
              Walks parent_span_id links upstream to pinpoint genuine root causes vs downstream symptom pods.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              value={targetSpanId}
              onChange={(e) => setTargetSpanId(e.target.value)}
              placeholder="e.g. span-cache-08"
              className="bg-slate-950 text-xs text-slate-200 border border-slate-700 rounded px-2.5 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500 w-full sm:w-44"
            />
            <button
              onClick={() => handleWalkTrace(targetSpanId)}
              disabled={isWalking || !targetSpanId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white transition disabled:opacity-50"
            >
              <Play className="w-3 h-3 fill-current" />
              {isWalking ? 'Walking...' : 'Walk Upstream'}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded bg-red-950/40 border border-red-500/30 text-red-300 text-xs mb-3">
            {errorMsg}
          </div>
        )}

        {upstreamChain && (
          <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center justify-between">
              <span>Ancestor Chain Output ({upstreamChain.length} Hops)</span>
              <span className="text-[10px] text-slate-500 font-mono">
                Order: Leaf Span &rarr; Ancestor Root
              </span>
            </div>

            <div className="space-y-2">
              {upstreamChain.map((node, index) => (
                <div
                  key={node.span_id}
                  className={`p-2.5 rounded border text-xs font-mono flex items-center justify-between gap-3 ${
                    node.component_id === 'pod-07'
                      ? 'bg-red-950/30 border-red-500/40 text-red-200'
                      : 'bg-slate-900/80 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300">
                      {index + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-[12px]">{node.component_id}</span>
                        <span className="text-[10px] text-slate-400">({node.call_type || 'rpc'})</span>
                        {node.component_id === 'pod-07' && (
                          <span className="px-1.5 py-0.2 rounded bg-red-500 text-white text-[9px] font-bold uppercase">
                            Root Cause Node
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Span: {node.span_id} &bull; Parent: {node.parent_span_id || 'null (Root)'}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-semibold text-slate-200">{node.duration_ms}ms</div>
                    <div className="text-[10px]">
                      {node.is_anomalous ? (
                        <span className="text-red-400 font-semibold">Anomalous Telemetry</span>
                      ) : (
                        <span className="text-slate-500">Normal</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
