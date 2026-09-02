"""Investigation Tools for RCA Agent Execution."""
from typing import Dict, Any, List, Optional
from .data_engine import TelemetryStore

class AgentToolRegistry:
    """Tool execution registry for the multi-phase RCA agent."""
    def __init__(self, store: TelemetryStore):
        self.store = store
        self.hypotheses: Dict[str, Dict[str, Any]] = {}
        self.findings: Dict[str, Dict[str, Any]] = {}
        self.agent_steps: List[Dict[str, Any]] = []

    def summarize_metrics(self, query_id: str) -> Dict[str, Any]:
        """Tool: Retrieve pre-processed 3-sigma metric anomalies for a query."""
        anomalies = self.store.extract_metric_anomalies(query_id)
        return {
            "status": "success",
            "count": len(anomalies),
            "anomalies": anomalies,
        }

    def summarize_traces(self, query_id: str) -> Dict[str, Any]:
        """Tool: Retrieve trace summaries, latency bottlenecks, and 3-hop call paths."""
        bottlenecks = self.store.extract_trace_bottlenecks(query_id)
        return {
            "status": "success",
            "bottlenecks": bottlenecks,
        }

    def summarize_logs(self, query_id: str) -> Dict[str, Any]:
        """Tool: Retrieve TF-IDF ranked Drain log templates for a query."""
        logs = self.store.extract_log_summaries(query_id)
        return {
            "status": "success",
            "log_summaries": logs,
        }

    def walk_upstream_trace(self, candidate_comp_or_span: str, max_hops: int = 10) -> Dict[str, Any]:
        """Tool: Walk upstream trace to defend against salience capture and presence bias."""
        result = self.store.walk_upstream_trace(candidate_comp_or_span)
        return {
            "status": "success",
            "upstream_analysis": result,
            **result
        }

    def create_hypothesis(
        self,
        query_id: str,
        component_id: str,
        phase_created: str,
        reason: str,
        confidence: float,
        evidence: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """Tool: Formulate a candidate hypothesis with cited evidence."""
        hypo_id = f"hypo-{len(self.hypotheses) + 1:03d}"
        self.hypotheses[hypo_id] = {
            "hypothesis_id": hypo_id,
            "query_id": query_id,
            "component_id": component_id,
            "phase_created": phase_created,
            "reason": reason,
            "confidence": confidence,
            "status": "active",
            "evidence": evidence or [],
        }
        return hypo_id

    def update_hypothesis(
        self,
        hypothesis_id: str,
        status: str,
        superseded_by: Optional[str] = None,
        confidence: Optional[float] = None,
    ) -> bool:
        """Tool: Update hypothesis lifecycle state (e.g. drop false leads, confirm true cause)."""
        if hypothesis_id in self.hypotheses:
            self.hypotheses[hypothesis_id]["status"] = status
            if superseded_by:
                self.hypotheses[hypothesis_id]["superseded_by"] = superseded_by
            if confidence is not None:
                self.hypotheses[hypothesis_id]["confidence"] = confidence
            return True
        return False

    def create_finding(
        self,
        query_id: str,
        hypothesis_id: str,
        root_cause_time: str,
        root_cause_component: str,
        root_cause_reason: str,
    ) -> str:
        """Tool: Finalize the diagnosed root cause report."""
        finding_id = f"finding-{query_id}"
        self.findings[finding_id] = {
            "finding_id": finding_id,
            "query_id": query_id,
            "hypothesis_id": hypothesis_id,
            "root_cause_time": root_cause_time,
            "root_cause_component": root_cause_component,
            "root_cause_reason": root_cause_reason,
        }
        return finding_id

    def log_agent_step(
        self,
        query_id: str,
        phase: str,
        tool_name: str,
        args: Dict[str, Any],
        result_summary: str,
    ):
        """Tool: Record an observable agent investigation step."""
        step = {
            "step_id": f"step-{len(self.agent_steps) + 1}",
            "query_id": query_id,
            "phase": phase,
            "tool_name": tool_name,
            "args": args,
            "result_summary": result_summary,
        }
        self.agent_steps.append(step)
