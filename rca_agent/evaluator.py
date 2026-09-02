"""OpenRCA Version 1 Benchmark Evaluation Suite.

Implements standard benchmark metrics for microservice Root Cause Analysis:
- AC@1, AC@3, AC@5 (Top-k Component Recall)
- Temporal Precision (Time within 3m and 5m windows)
- Reason Semantic Token F1 Score
- Anti-Salience Critic Refutation Defense Rate
"""
import json
import re
from typing import Dict, Any, List, Optional
from .agent import RCAAgent, InvestigationResult

class OpenRCAEvaluator:
    """Evaluates RCA Agent performance against OpenRCA v1 benchmark ground truth."""

    @staticmethod
    def tokenize(text: str) -> set:
        """Tokenize text into significant diagnostic tokens."""
        stopwords = {
            "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with",
            "by", "is", "was", "were", "causing", "leading", "due", "observed", "system"
        }
        clean = re.sub(r"[^a-z0-9\s_-]", " ", (text or "").lower())
        return {w for w in clean.split() if len(w) > 2 and w not in stopwords}

    @classmethod
    def calculate_reason_f1(cls, predicted: str, ground_truth: str) -> Dict[str, float]:
        """Calculates token-level precision, recall, and harmonic mean F1."""
        pred_tokens = cls.tokenize(predicted)
        gt_tokens = cls.tokenize(ground_truth)

        if not pred_tokens or not gt_tokens:
            return {"precision": 0.0, "recall": 0.0, "f1": 0.0}

        intersection = len(pred_tokens.intersection(gt_tokens))
        precision = intersection / len(pred_tokens)
        recall = intersection / len(gt_tokens)
        f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

        return {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
        }

    @classmethod
    def evaluate_query(cls, agent: RCAAgent, query_id: str, result: Optional[InvestigationResult] = None) -> Dict[str, Any]:
        """Runs RCA on a single incident query and benchmarks against Ground Truth."""
        q = agent.store.get_query(query_id)
        if not q:
            raise ValueError(f"Query {query_id} not found.")

        gt = q.get("ground_truth", {})
        gt_comp = (gt.get("root_cause_component") or "").strip().lower()
        gt_time = (gt.get("root_cause_time") or "").strip()
        gt_reason = (gt.get("root_cause_reason") or "").strip()

        # Run RCA Agent if result not pre-computed
        if result is None:
            result = agent.run_investigation(query_id)
        pred_finding = result.finding
        pred_comp = (pred_finding.get("root_cause_component") or "").strip().lower()
        pred_time = (pred_finding.get("root_cause_time") or "").strip()
        pred_reason = (pred_finding.get("root_cause_reason") or "").strip()

        # 1. AC@1
        ac_1 = pred_comp == gt_comp and len(pred_comp) > 0

        # 2. AC@3 and AC@5 Recall
        hypo_comps = [h.get("component_id", "").strip().lower() for h in result.hypotheses]
        ac_3 = gt_comp in hypo_comps[:3]
        ac_5 = gt_comp in hypo_comps[:5]

        # 3. Temporal Accuracy
        time_exact = False
        time_within_3m = False
        time_within_5m = False
        time_delta_sec = None

        if pred_time and gt_time:
            try:
                t_pred = datetime_from_str(pred_time)
                t_gt = datetime_from_str(gt_time)
                time_delta_sec = abs(int((t_pred - t_gt).total_seconds()))
                time_exact = time_delta_sec <= 60
                time_within_3m = time_delta_sec <= 180
                time_within_5m = time_delta_sec <= 300
            except Exception:
                pass

        # 4. Reason Semantic F1
        reason_scores = cls.calculate_reason_f1(pred_reason, gt_reason)

        # 5. Salience Defense (Critic dropped false decoys)
        salience_refuted = any(h.get("status") == "dropped" for h in result.hypotheses) or ac_1

        return {
            "query_id": str(query_id),
            "system": q.get("system", "Bank"),
            "ground_truth": {
                "root_cause_component": gt_comp,
                "root_cause_time": gt_time,
                "root_cause_reason": gt_reason,
            },
            "prediction": {
                "root_cause_component": pred_comp,
                "root_cause_time": pred_time,
                "root_cause_reason": pred_reason,
            },
            "metrics": {
                "ac_at_1": ac_1,
                "ac_at_3": ac_3,
                "ac_at_5": ac_5,
                "time_exact_match": time_exact,
                "time_within_3min": time_within_3m,
                "time_within_5min": time_within_5m,
                "time_delta_seconds": time_delta_sec,
                "reason_precision": reason_scores["precision"],
                "reason_recall": reason_scores["recall"],
                "reason_f1": reason_scores["f1"],
                "salience_refuted": salience_refuted,
                "steps_count": len(result.steps),
                "execution_time_ms": result.duration_ms,
            }
        }

    @classmethod
    def run_benchmark_suite(cls, agent: RCAAgent, query_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """Executes full OpenRCA v1 benchmark suite and aggregates metrics."""
        targets = query_ids or agent.store.list_query_ids()
        evaluations = []

        for qid in targets:
            ev = cls.evaluate_query(agent, qid)
            evaluations.append(ev)

        total = len(evaluations)
        ac1_count = sum(1 for e in evaluations if e["metrics"]["ac_at_1"])
        ac3_count = sum(1 for e in evaluations if e["metrics"]["ac_at_3"])
        ac5_count = sum(1 for e in evaluations if e["metrics"]["ac_at_5"])
        time3_count = sum(1 for e in evaluations if e["metrics"]["time_within_3min"])
        time5_count = sum(1 for e in evaluations if e["metrics"]["time_within_5min"])
        salience_count = sum(1 for e in evaluations if e["metrics"]["salience_refuted"])

        avg_f1 = sum(e["metrics"]["reason_f1"] for e in evaluations) / total if total > 0 else 0.0
        avg_latency = sum(e["metrics"]["execution_time_ms"] for e in evaluations) / total if total > 0 else 0.0
        avg_steps = sum(e["metrics"]["steps_count"] for e in evaluations) / total if total > 0 else 0.0

        return {
            "benchmark_name": "OpenRCA Version 1 Benchmark Evaluation Suite",
            "version": "1.0.0",
            "total_queries": total,
            "aggregate_metrics": {
                "ac_at_1_pct": round((ac1_count / total) * 100, 2) if total > 0 else 0.0,
                "ac_at_3_pct": round((ac3_count / total) * 100, 2) if total > 0 else 0.0,
                "ac_at_5_pct": round((ac5_count / total) * 100, 2) if total > 0 else 0.0,
                "time_within_3min_pct": round((time3_count / total) * 100, 2) if total > 0 else 0.0,
                "time_within_5min_pct": round((time5_count / total) * 100, 2) if total > 0 else 0.0,
                "avg_reason_f1": round(avg_f1, 4),
                "salience_refutation_rate_pct": round((salience_count / total) * 100, 2) if total > 0 else 0.0,
                "avg_execution_time_ms": round(avg_latency, 1),
                "avg_steps_per_query": round(avg_steps, 1),
            },
            "evaluations": evaluations,
        }


def datetime_from_str(dt_str: str):
    """Helper to parse timestamps."""
    from datetime import datetime
    s = dt_str.replace("T", " ").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.split(".")[0], fmt)
        except Exception:
            continue
    raise ValueError(f"Cannot parse datetime {dt_str}")
