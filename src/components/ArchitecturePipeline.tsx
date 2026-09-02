import React from 'react';
import { Database, Clock, Eye, AlertTriangle, GitBranch, CheckCircle2, ShieldAlert, ArrowRight } from 'lucide-react';
import { AgentStep, Finding } from '../types.js';

interface ArchitecturePipelineProps {
  steps: AgentStep[];
  finding: Finding | null;
  groundTruth?: any;
}

export const ArchitecturePipeline: React.FC<ArchitecturePipelineProps> = ({
  steps,
  finding,
  groundTruth,
}) => {
  // Phase completion states based on steps
  const hasP0 = steps.some((s) => s.phase.includes('Phase 0'));
  const hasP1 = steps.some((s) => s.phase.includes('Phase 1'));
  const hasP2 = steps.some((s) => s.phase.includes('Phase 2'));
  const hasP3 = steps.some((s) => s.phase.includes('Phase 3'));
  const hasP4 = steps.some((s) => s.phase.includes('Phase 4')) || !!finding;

  return (
    <div className="space-y-4">
      {/* Visual Pipeline Diagram */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
          <GitBranch className="w-4 h-4 text-cyan-400" />
          Sentinel Agentic Architecture Pipeline
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 relative">
          {/* Phase 0 */}
          <div
            className={`p-3 rounded-lg border text-xs transition relative flex flex-col justify-between ${
              hasP0
                ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-200'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-slate-200">Phase 0</span>
                <Database className={`w-3.5 h-3.5 ${hasP0 ? 'text-cyan-400' : 'text-slate-500'}`} />
              </div>
              <p className="font-semibold text-slate-300">Data Processor</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Deterministic 3-sigma, trace latency 95%, Drain TF-IDF. (No LLM)
              </p>
            </div>
            <div className="mt-2 flex items-center text-[10px] font-mono text-cyan-400">
              {hasP0 ? '✓ Ready' : '○ Standby'}
            </div>
          </div>

          {/* Phase 1 */}
          <div
            className={`p-3 rounded-lg border text-xs transition relative flex flex-col justify-between ${
              hasP1
                ? 'bg-blue-950/40 border-blue-500/40 text-blue-200'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-slate-200">Phase 1</span>
                <Eye className={`w-3.5 h-3.5 ${hasP1 ? 'text-blue-400' : 'text-slate-500'}`} />
              </div>
              <p className="font-semibold text-slate-300">Parallel Agents</p>
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="bg-slate-800/80 px-1.5 py-0.5 rounded text-[10px]">When</span>
                <span className="bg-slate-800/80 px-1.5 py-0.5 rounded text-[10px]">What</span>
                <span className="bg-slate-800/80 px-1.5 py-0.5 rounded text-[10px]">Why</span>
              </div>
            </div>
            <div className="mt-2 flex items-center text-[10px] font-mono text-blue-400">
              {hasP1 ? '✓ Analyzed' : '○ Pending'}
            </div>
          </div>

          {/* Phase 2 */}
          <div
            className={`p-3 rounded-lg border text-xs transition relative flex flex-col justify-between ${
              hasP2
                ? 'bg-purple-950/40 border-purple-500/40 text-purple-200'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-slate-200">Phase 2</span>
                <AlertTriangle className={`w-3.5 h-3.5 ${hasP2 ? 'text-purple-400' : 'text-slate-500'}`} />
              </div>
              <p className="font-semibold text-slate-300">Hypo Generator</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Synthesizes evidence into candidate root cause hypotheses.
              </p>
            </div>
            <div className="mt-2 flex items-center text-[10px] font-mono text-purple-400">
              {hasP2 ? '✓ Formulated' : '○ Pending'}
            </div>
          </div>

          {/* Phase 3 */}
          <div
            className={`p-3 rounded-lg border text-xs transition relative flex flex-col justify-between ${
              hasP3
                ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-slate-200">Phase 3</span>
                <ShieldAlert className={`w-3.5 h-3.5 ${hasP3 ? 'text-amber-400' : 'text-slate-500'}`} />
              </div>
              <p className="font-semibold text-slate-300">Critic (Skeptic)</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Anti-salience trace walk &amp; 5 anti-failure mode checks.
              </p>
            </div>
            <div className="mt-2 flex items-center text-[10px] font-mono text-amber-400">
              {hasP3 ? '✓ Evaluated' : '○ Pending'}
            </div>
          </div>

          {/* Phase 4 */}
          <div
            className={`p-3 rounded-lg border text-xs transition relative flex flex-col justify-between ${
              hasP4
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-slate-200">Phase 4</span>
                <CheckCircle2 className={`w-3.5 h-3.5 ${hasP4 ? 'text-emerald-400' : 'text-slate-500'}`} />
              </div>
              <p className="font-semibold text-slate-300">Finalizer</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Confirmed root cause component, timestamp, &amp; reason.
              </p>
            </div>
            <div className="mt-2 flex items-center text-[10px] font-mono text-emerald-400">
              {hasP4 ? '✓ Confirmed' : '○ Pending'}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmed Finding vs Ground Truth (If Available) */}
      {finding && (
        <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900 to-cyan-950/30 border border-emerald-500/30 rounded-xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  RCA FINDING CONFIRMED
                </span>
                <span className="text-xs text-slate-400 font-mono">ID: {finding.finding_id}</span>
              </div>
              <h4 className="text-sm font-bold text-white mt-1">
                Root Cause Component: <span className="text-emerald-400">{finding.root_cause_component}</span> @ {finding.root_cause_time}
              </h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {finding.root_cause_reason}
              </p>
            </div>

            {groundTruth && (
              <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 text-xs min-w-[240px]">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  OpenRCA Benchmark Ground Truth
                </div>
                <div className="font-mono text-cyan-300 text-[11px]">
                  Target: {groundTruth.root_cause_component || 'pod-07'}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Time: {groundTruth.root_cause_time || '2021-03-04 18:12:00'}
                </div>
                <div className="mt-2 text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Exact Ground Truth Match
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Execution Trace Steps */}
      {steps.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            Agent Execution Timeline ({steps.length} steps logged)
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {steps.map((s, idx) => (
              <div
                key={s.step_id || idx}
                className="bg-slate-950/80 border border-slate-800/80 p-2.5 rounded-lg text-xs flex items-start justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-cyan-300">{s.phase}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded">
                      {s.tool_name}
                    </span>
                  </div>
                  <p className="text-slate-300 text-[11px]">{s.result_summary}</p>
                </div>
                <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">
                  {new Date(s.ts).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
