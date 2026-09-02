import React, { useState, useEffect } from 'react';
import {
  OpenRCABenchmarkSummary,
  OpenRCAQueryEvaluation,
} from '../types.js';
import {
  Award,
  Play,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  ShieldCheck,
  Zap,
  RotateCw,
  FileCode,
  Copy,
  Check,
  Search,
  Sliders,
  Database,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface OpenRcaEvalViewProps {
  onSelectQuery?: (qid: string) => void;
}

export function OpenRcaEvalView({ onSelectQuery }: OpenRcaEvalViewProps) {
  const [evalSummary, setEvalSummary] = useState<OpenRCABenchmarkSummary | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEval, setSelectedEval] = useState<OpenRCAQueryEvaluation | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState<string>('');

  // Load summary on mount
  const fetchSummary = async () => {
    try {
      setError(null);
      const res = await fetch('/api/eval/summary');
      if (!res.ok) throw new Error('Failed to fetch benchmark evaluation summary');
      const data = await res.json();
      setEvalSummary(data);
      if (data.evaluations && data.evaluations.length > 0) {
        setSelectedEval(data.evaluations[0]);
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  // Run full benchmark suite
  const handleRunBenchmark = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to execute OpenRCA v1 benchmark suite');
      const data = await res.json();
      setEvalSummary(data);
      if (data.evaluations && data.evaluations.length > 0) {
        setSelectedEval(data.evaluations[0]);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  const handleExportJSON = () => {
    if (!evalSummary) return;
    const blob = new Blob([JSON.stringify(evalSummary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openrca_v1_eval_results_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredEvaluations = evalSummary?.evaluations.filter((e) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      e.query_id.toLowerCase().includes(q) ||
      e.ground_truth.root_cause_component.toLowerCase().includes(q) ||
      (e.prediction.root_cause_component || '').toLowerCase().includes(q)
    );
  }) || [];

  const runCommands = [
    {
      id: 'cli-eval',
      title: 'Run OpenRCA v1 Benchmark in Terminal (CLI)',
      description: 'Executes the complete OpenRCA version 1 evaluation suite and outputs formatted scoreboard + openrca_eval_results.json',
      command: 'npm run eval',
    },
    {
      id: 'dev-server',
      title: 'Start Full Application (Express + Vite + REST + MCP)',
      description: 'Launches backend server and frontend preview on port 3000',
      command: 'npm run dev',
    },
    {
      id: 'prod-build',
      title: 'Build for Production',
      description: 'Compiles frontend assets and bundles server to dist/server.cjs',
      command: 'npm run build && npm start',
    },
    {
      id: 'rest-eval',
      title: 'Trigger Benchmark via REST API',
      description: 'Call the OpenRCA evaluation API endpoint directly via curl',
      command: 'curl -X POST http://localhost:3000/api/eval/run',
    },
    {
      id: 'mcp-tools',
      title: 'Query MCP Tools Catalog',
      description: 'Fetch the 13 agentic MCP investigation tools over REST/SSE',
      command: 'curl http://localhost:3000/api/mcp/tools',
    },
    {
      id: 'sample-gen',
      title: 'Generate Synthetic OpenRCA Bank Dataset',
      description: 'Generates synthetic metrics, traces, and logs for Bank microservices testing',
      command: 'python sample_data/generate_sample.py --output ./data/Bank',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner & Action Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg">
              <Award className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                OpenRCA Version 1 Benchmark Evaluation Suite
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  v1.0 (ICLR 2025 Standard)
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Official metric validation: Top-1 Accuracy (AC@1), Top-k Candidate Recall, Temporal Precision (±3m), Reason Semantic F1, and Anti-Failure Critic Refutation.
              </p>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          <button
            onClick={handleRunBenchmark}
            disabled={isRunning}
            className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition disabled:opacity-50 cursor-pointer"
          >
            {isRunning ? (
              <>
                <RotateCw className="w-4 h-4 animate-spin" />
                <span>Running Benchmark...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>Run OpenRCA v1 Benchmark</span>
              </>
            )}
          </button>

          <button
            onClick={handleExportJSON}
            disabled={!evalSummary}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition disabled:opacity-40 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Benchmark Scorecard Cards */}
      {evalSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Card 1: AC@1 */}
          <div className="bg-slate-900/80 border border-emerald-500/30 rounded-xl p-3.5 space-y-1 shadow-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-semibold">Top-1 Accuracy</span>
              <Award className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              {evalSummary.aggregate_metrics.ac_at_1_pct}%
            </div>
            <div className="text-[10px] text-slate-400">
              AC@1 vs OpsAgent (16.5%)
            </div>
          </div>

          {/* Card 2: AC@3 Recall */}
          <div className="bg-slate-900/80 border border-cyan-500/30 rounded-xl p-3.5 space-y-1 shadow-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-semibold">Top-3 Recall</span>
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="text-2xl font-black text-cyan-400 font-mono">
              {evalSummary.aggregate_metrics.ac_at_3_pct}%
            </div>
            <div className="text-[10px] text-slate-400">
              AC@3 candidate presence
            </div>
          </div>

          {/* Card 3: Time Accuracy (±3m) */}
          <div className="bg-slate-900/80 border border-indigo-500/30 rounded-xl p-3.5 space-y-1 shadow-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-semibold">Time Precision</span>
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-indigo-400 font-mono">
              {evalSummary.aggregate_metrics.time_within_3min_pct}%
            </div>
            <div className="text-[10px] text-slate-400">
              Onset accuracy (±3 mins)
            </div>
          </div>

          {/* Card 4: Reason Semantic F1 */}
          <div className="bg-slate-900/80 border border-amber-500/30 rounded-xl p-3.5 space-y-1 shadow-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-semibold">Reason F1 Score</span>
              <FileCode className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-400 font-mono">
              {evalSummary.aggregate_metrics.avg_reason_f1}
            </div>
            <div className="text-[10px] text-slate-400">
              Token overlap / semantic F1
            </div>
          </div>

          {/* Card 5: Anti-Salience Defense */}
          <div className="bg-slate-900/80 border border-purple-500/30 rounded-xl p-3.5 space-y-1 shadow-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-semibold">Skeptic Defense</span>
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div className="text-2xl font-black text-purple-400 font-mono">
              {evalSummary.aggregate_metrics.salience_refutation_rate_pct}%
            </div>
            <div className="text-[10px] text-slate-400">
              Salience decoy refutation
            </div>
          </div>

          {/* Card 6: Average Latency */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-1 shadow-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-semibold">Avg Latency</span>
              <Zap className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-2xl font-black text-white font-mono">
              {evalSummary.aggregate_metrics.avg_execution_time_ms}ms
            </div>
            <div className="text-[10px] text-slate-400">
              {evalSummary.aggregate_metrics.avg_steps_per_query} steps / query
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Query Evaluations & Deep Comparison Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Evaluations List Table (7 Cols) */}
        <div className="lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="p-3.5 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-950/40">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider">Benchmark Test Queries</span>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300">
                {filteredEvaluations.length} / {evalSummary?.total_queries || 0}
              </span>
            </div>

            <div className="relative w-48">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Filter queries / pods..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-800/80 overflow-y-auto max-h-[460px]">
            {filteredEvaluations.map((ev) => {
              const isSelected = selectedEval?.query_id === ev.query_id;
              return (
                <div
                  key={ev.query_id}
                  onClick={() => {
                    setSelectedEval(ev);
                    if (onSelectQuery) onSelectQuery(ev.query_id);
                  }}
                  className={`p-3.5 transition cursor-pointer flex flex-col gap-2 ${
                    isSelected
                      ? 'bg-cyan-950/30 border-l-4 border-l-cyan-500'
                      : 'hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-white">
                        Query #{ev.query_id}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                        {ev.system}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {ev.metrics.ac_at_1 ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold font-mono border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" /> AC@1 MATCH
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold font-mono border border-rose-500/30">
                          <XCircle className="w-3 h-3" /> AC@1 MISMATCH
                        </span>
                      )}

                      {ev.metrics.salience_refuted && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-mono border border-purple-500/30" title="Anti-Failure Critic Refuted False Leads">
                          DEFENDED
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Prediction Comparison Snippet */}
                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-mono">Ground Truth</div>
                      <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <span className="text-cyan-400 font-mono">{ev.ground_truth.root_cause_component}</span>
                        <span className="text-[10px] text-slate-400 font-mono">@{ev.ground_truth.root_cause_time.split(' ')[1]}</span>
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-mono">Predicted Cause</div>
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <span className={`font-mono ${ev.metrics.ac_at_1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {ev.prediction.root_cause_component || 'None'}
                        </span>
                        {ev.prediction.root_cause_time && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            @{ev.prediction.root_cause_time.split(' ')[1] || ev.prediction.root_cause_time}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span className="flex items-center gap-1">
                      Reason F1: <strong className="text-amber-300">{ev.metrics.reason_f1}</strong>
                    </span>
                    <span>
                      Latency: <strong className="text-slate-200">{ev.metrics.execution_time_ms}ms</strong> ({ev.metrics.steps_count} steps)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Query Deep Inspection (5 Cols) */}
        <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col space-y-4">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Incident Evaluation Breakdown
            </h3>
            {selectedEval && (
              <span className="text-xs font-mono text-cyan-400 font-bold">
                Query {selectedEval.query_id}
              </span>
            )}
          </div>

          {selectedEval ? (
            <div className="space-y-4 text-xs">
              {/* Component Metric Validation */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-400 uppercase">Root Cause Component Accuracy</div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Ground Truth Component:</span>
                    <span className="font-mono font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
                      {selectedEval.ground_truth.root_cause_component}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Predicted Component:</span>
                    <span className={`font-mono font-bold px-2 py-0.5 rounded ${
                      selectedEval.metrics.ac_at_1
                        ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                        : 'text-rose-400 bg-rose-500/10 border border-rose-500/20'
                    }`}>
                      {selectedEval.prediction.root_cause_component || 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
                    <span className="text-slate-500 font-mono">AC@1 Status:</span>
                    <span className="font-bold text-emerald-400 font-mono">
                      {selectedEval.metrics.ac_at_1 ? 'CORRECT (1.0)' : 'INCORRECT (0.0)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Temporal Onset Alignment */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-400 uppercase">Incident Timestamp Precision</div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Ground Truth Time:</span>
                    <span className="font-mono text-slate-200">{selectedEval.ground_truth.root_cause_time} UTC</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Predicted Time:</span>
                    <span className="font-mono text-slate-200">{selectedEval.prediction.root_cause_time} UTC</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
                    <span className="text-slate-500 font-mono">Temporal Delta:</span>
                    <span className="font-bold text-indigo-300 font-mono">
                      {selectedEval.metrics.time_delta_seconds !== null ? `Δ ${selectedEval.metrics.time_delta_seconds}s` : 'N/A'}
                      {selectedEval.metrics.time_within_3min ? ' (Within ±3m Window)' : ' (Outside Window)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Reason Comparison & F1 */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-400 uppercase flex items-center justify-between">
                  <span>Root Cause Reason Evaluation</span>
                  <span className="text-amber-400 font-mono">F1: {selectedEval.metrics.reason_f1}</span>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                  <div>
                    <div className="text-[10px] text-slate-500 font-mono uppercase mb-0.5">Ground Truth Mechanism:</div>
                    <p className="text-slate-300 text-[11px] leading-relaxed italic bg-slate-900/60 p-2 rounded border border-slate-800">
                      "{selectedEval.ground_truth.root_cause_reason}"
                    </p>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-mono uppercase mb-0.5">Agent Diagnostic Output:</div>
                    <p className="text-slate-200 text-[11px] leading-relaxed bg-slate-900/60 p-2 rounded border border-slate-800">
                      "{selectedEval.prediction.root_cause_reason}"
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-800/80 text-center font-mono text-[10px]">
                    <div className="bg-slate-900 p-1.5 rounded">
                      <div className="text-slate-500">Precision</div>
                      <div className="text-white font-bold">{selectedEval.metrics.reason_precision}</div>
                    </div>
                    <div className="bg-slate-900 p-1.5 rounded">
                      <div className="text-slate-500">Recall</div>
                      <div className="text-white font-bold">{selectedEval.metrics.reason_recall}</div>
                    </div>
                    <div className="bg-slate-900 p-1.5 rounded">
                      <div className="text-slate-500">F1 Score</div>
                      <div className="text-amber-400 font-bold">{selectedEval.metrics.reason_f1}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500 text-xs">
              Select an evaluation row on the left to inspect detailed metrics.
            </div>
          )}
        </div>
      </div>

      {/* Command Center & Execution Guide */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            OpenRCA Benchmark Commands & CLI Runner
          </h3>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Use the commands below to run the agent, benchmark OpenRCA v1 in your terminal, generate sample datasets, or test MCP tool APIs:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {runCommands.map((cmd) => (
            <div
              key={cmd.id}
              className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2 flex flex-col justify-between"
            >
              <div className="space-y-1">
                <div className="text-xs font-semibold text-white flex items-center justify-between">
                  <span>{cmd.title}</span>
                  <button
                    onClick={() => handleCopy(cmd.command, cmd.id)}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-cyan-300 transition cursor-pointer"
                    title="Copy command"
                  >
                    {copiedCmd === cmd.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {cmd.description}
                </p>
              </div>

              <div className="bg-slate-900 rounded p-2 font-mono text-[11px] text-cyan-300 overflow-x-auto border border-slate-800/80 flex items-center justify-between">
                <code>{cmd.command}</code>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
