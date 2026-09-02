import React, { useState, useEffect } from 'react';
import { Terminal, Play, Check, AlertCircle, Code, Server } from 'lucide-react';

export const McpPlayground: React.FC<{ activeQueryId: string }> = ({ activeQueryId }) => {
  const [tools, setTools] = useState<any[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>('process_query');
  const [argsJson, setArgsJson] = useState<string>(`{\n  "query_id": "${activeQueryId}",\n  "force": true\n}`);
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/mcp/tools')
      .then((r) => r.json())
      .then((d) => {
        setTools(d.tools || []);
      })
      .catch((e) => console.error(e));
  }, []);

  const handleSelectTool = (toolName: string) => {
    setSelectedTool(toolName);
    setError(null);
    setResult(null);

    // Provide default template args
    switch (toolName) {
      case 'process_query':
        setArgsJson(JSON.stringify({ query_id: activeQueryId, force: true }, null, 2));
        break;
      case 'summarize_metrics':
      case 'summarize_traces':
      case 'summarize_logs':
        setArgsJson(JSON.stringify({ query_id: activeQueryId }, null, 2));
        break;
      case 'fetch_metrics':
        setArgsJson(JSON.stringify({ query_id: activeQueryId, component: 'pod-07', metric: 'cpu_usage' }, null, 2));
        break;
      case 'fetch_traces':
        setArgsJson(JSON.stringify({ query_id: activeQueryId, component: 'pod-07' }, null, 2));
        break;
      case 'walk_upstream_trace':
        setArgsJson(JSON.stringify({ span_id: 'span-cache-08', max_hops: 10 }, null, 2));
        break;
      case 'fetch_logs':
        setArgsJson(JSON.stringify({ query_id: activeQueryId, component: 'pod-07', level: 'ERROR' }, null, 2));
        break;
      case 'run_sql':
        setArgsJson(JSON.stringify({ sql: 'SELECT * FROM metric_anomalies LIMIT 10' }, null, 2));
        break;
      case 'create_hypothesis':
        setArgsJson(JSON.stringify({
          query_id: activeQueryId,
          component_id: 'pod-07',
          phase_created: 'p2_hypothesis_gen',
          reason: 'Excessive CPU load',
          confidence: 0.9,
        }, null, 2));
        break;
      case 'get_hypotheses':
        setArgsJson(JSON.stringify({ query_id: activeQueryId }, null, 2));
        break;
      default:
        setArgsJson(JSON.stringify({ query_id: activeQueryId }, null, 2));
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const parsedArgs = JSON.parse(argsJson);
      const res = await fetch('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedTool, arguments: parsedArgs }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Execution failed');
      setResult(data.result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const curToolObj = tools.find((t) => t.name === selectedTool);

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Server className="w-4 h-4 text-cyan-400" />
            Model Context Protocol (MCP) Tools Interactive Console
          </h3>
          <p className="text-xs text-slate-400">
            Sentinel exposes 13 MCP tool endpoints used by the LangGraph multi-agent orchestrator.
          </p>
        </div>
        <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-2 py-1 rounded border border-cyan-800/40">
          {tools.length} Tools Discovered
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tool List */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2 max-h-96 overflow-y-auto space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
            Registered MCP Tools
          </div>
          {tools.map((t) => (
            <button
              key={t.name}
              onClick={() => handleSelectTool(t.name)}
              className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-mono transition flex items-center justify-between ${
                selectedTool === t.name
                  ? 'bg-cyan-600 text-white font-bold'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span>{t.name}</span>
            </button>
          ))}
        </div>

        {/* Arguments & Inspector */}
        <div className="md:col-span-2 space-y-3">
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-white font-mono">{selectedTool}</span>
              <button
                onClick={handleExecute}
                disabled={loading}
                className="flex items-center gap-1 px-3 py-1 rounded text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition disabled:opacity-50"
              >
                <Play className="w-3 h-3 fill-current" />
                {loading ? 'Executing...' : 'Call MCP Tool'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mb-2">
              {curToolObj?.description || 'Execute tool'}
            </p>

            <div className="text-[10px] text-slate-400 font-mono mb-1">Input Arguments (JSON):</div>
            <textarea
              value={argsJson}
              onChange={(e) => setArgsJson(e.target.value)}
              rows={5}
              className="w-full bg-slate-900 text-xs font-mono text-cyan-300 border border-slate-700 rounded p-2 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          {/* Results Output */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-3">
            <div className="text-[11px] font-bold text-slate-300 mb-1 flex items-center justify-between">
              <span>Tool Execution Response (JSON)</span>
              {result && <span className="text-[10px] text-emerald-400 font-mono">200 OK</span>}
            </div>

            {error && (
              <div className="p-2 text-xs text-red-400 bg-red-950/30 rounded border border-red-500/20 font-mono">
                {error}
              </div>
            )}

            {result !== null ? (
              <pre className="text-[11px] font-mono text-slate-300 max-h-48 overflow-y-auto bg-slate-900 p-2.5 rounded border border-slate-800 whitespace-pre-wrap">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : (
              !error && (
                <div className="text-center py-6 text-xs text-slate-500 font-mono">
                  Select a tool and click "Call MCP Tool" to view structured output.
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
