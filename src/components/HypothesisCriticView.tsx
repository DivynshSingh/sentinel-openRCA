import React from 'react';
import { ShieldAlert, CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Repeat } from 'lucide-react';
import { Hypothesis } from '../types.js';

interface HypothesisCriticViewProps {
  hypotheses: Hypothesis[];
}

export const HypothesisCriticView: React.FC<HypothesisCriticViewProps> = ({
  hypotheses,
}) => {
  return (
    <div className="space-y-4">
      {/* Critic Anti-Failure Mode Framework Overview */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          Critic Destructive Skeptic Evaluation (Anti-Failure Modes)
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          The Critic loop checks candidate hypotheses against 5 key failure modes identified in OpenRCA &amp; OpsAgent research.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[11px] font-bold text-cyan-300 flex items-center gap-1 mb-1">
              <ShieldCheck className="w-3 h-3 text-cyan-400" /> 1. Salience Capture
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Refutes downstream components with high volume noise using deterministic trace walks.
            </p>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[11px] font-bold text-cyan-300 flex items-center gap-1 mb-1">
              <ShieldCheck className="w-3 h-3 text-cyan-400" /> 2. Premature Commit
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Requires multi-modal evidence across metrics, spans, and error logs before confirmation.
            </p>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[11px] font-bold text-cyan-300 flex items-center gap-1 mb-1">
              <ShieldCheck className="w-3 h-3 text-cyan-400" /> 3. Presence Bias
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Accounts for silent failures where a pod crashes without explicit exception logs.
            </p>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[11px] font-bold text-cyan-300 flex items-center gap-1 mb-1">
              <ShieldCheck className="w-3 h-3 text-cyan-400" /> 4. Timeline Check
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Validates that the accused component anomaly preceded downstream cascades.
            </p>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
            <div className="text-[11px] font-bold text-cyan-300 flex items-center gap-1 mb-1">
              <ShieldCheck className="w-3 h-3 text-cyan-400" /> 5. Causal Validity
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Confirms the call graph path connects root cause to observed system failure.
            </p>
          </div>
        </div>
      </div>

      {/* Hypotheses List */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Repeat className="w-4 h-4 text-purple-400" />
            Hypothesis State Machine &amp; Critic Decisions
          </h4>
          <span className="text-xs text-slate-400 font-mono">
            {hypotheses.length} Candidate Hypotheses Formulated
          </span>
        </div>

        {hypotheses.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400 bg-slate-950/40 rounded-lg border border-slate-800">
            No hypotheses formulated yet. Click <strong>"Run Full RCA Agent"</strong> to execute Phase 2 &amp; Phase 3.
          </div>
        ) : (
          <div className="space-y-3">
            {hypotheses.map((h) => {
              const isConfirmed = h.status === 'confirmed';
              const isDropped = h.status === 'dropped';

              return (
                <div
                  key={h.hypothesis_id}
                  className={`p-4 rounded-xl border transition ${
                    isConfirmed
                      ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-100'
                      : isDropped
                      ? 'bg-slate-950/60 border-slate-800/80 text-slate-400 opacity-75'
                      : 'bg-slate-950 border-slate-800 text-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm font-mono">{h.component_id}</span>
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                        {h.hypothesis_id}
                      </span>
                      <span className="text-[11px] text-slate-400">({h.phase_created})</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {h.confidence !== undefined && (
                        <span className="text-xs font-mono text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/40">
                          Confidence: {(h.confidence * 100).toFixed(0)}%
                        </span>
                      )}

                      {isConfirmed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Confirmed Winning Cause
                        </span>
                      )}

                      {isDropped && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/30">
                          <XCircle className="w-3.5 h-3.5" /> Dropped by Critic (Salience Symptom)
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed font-sans mt-1">
                    {h.reason}
                  </p>

                  {h.superseded_by && (
                    <div className="mt-2 text-[11px] text-slate-400 font-mono">
                      Superseded by upstream root cause: <span className="text-cyan-300">{h.superseded_by}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
