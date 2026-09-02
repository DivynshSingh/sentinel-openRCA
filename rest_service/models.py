"""Pydantic models for Sentinel REST API."""
from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

# === Raw Telemetry Models ===

class MetricPoint(BaseModel):
    id: str
    component_id: str
    kpi_name: str
    ts: datetime
    value: float
    is_anomalous: bool = False

class Span(BaseModel):
    span_id: str
    trace_id: str
    parent_span_id: Optional[str] = None
    component_id: str
    start_time: datetime
    duration_ms: int
    status: str
    call_type: Optional[str] = None

class LogEntry(BaseModel):
    id: str
    component_id: str
    ts: datetime
    level: str
    message: str
    template_id: Optional[str] = None

# === Processed Evidence Models ===

class MetricAnomaly(BaseModel):
    id: str
    query_id: str
    component_id: str
    metric_name: str
    anomaly_pattern: str  # spike|steady_rise|level_shift
    ts: datetime
    deviation_score: float

class TraceSummary(BaseModel):
    id: str
    query_id: str
    callee_id: str
    window_start: datetime
    window_end: datetime
    total_calls: int
    max_latency_ms: int
    caller_distribution: Dict[str, int]

class TracePath(BaseModel):
    id: str
    query_id: str
    grandparent_id: Optional[str]
    caller_id: str
    callee_id: str
    frequency: int
    is_high_latency: bool

class LogSummary(BaseModel):
    id: str
    query_id: str
    component_id: str
    template_id: str
    template_text: str
    tfidf_score: float
    rank_pct: int
    earliest_ts: datetime
    level: str

# === Query & Reasoning Models ===

class Query(BaseModel):
    query_id: str
    question_text: str
    window_start: datetime
    window_end: datetime
    system: str
    status: str = "pending"
    ground_truth: Optional[Dict[str, Any]] = None

class Hypothesis(BaseModel):
    hypothesis_id: str
    query_id: str
    component_id: str
    phase_created: str
    reason: str
    confidence: Optional[float] = None
    status: str = "active"
    superseded_by: Optional[str] = None
    created_at: Optional[datetime] = None

class HypothesisEvidence(BaseModel):
    evidence_id: str
    hypothesis_id: str
    evidence_type: str
    evidence_table: str
    evidence_pk: str
    citation_text: Optional[str] = None

class Finding(BaseModel):
    finding_id: str
    query_id: str
    hypothesis_id: Optional[str] = None
    root_cause_time: Optional[datetime] = None
    root_cause_component: Optional[str] = None
    root_cause_reason: Optional[str] = None
    confirmed_at: Optional[datetime] = None

class AgentStep(BaseModel):
    step_id: str
    query_id: str
    phase: str
    tool_name: str
    args: Optional[Dict[str, Any]] = None
    result_summary: Optional[str] = None
    ts: Optional[datetime] = None

# === Request Models ===

class CreateHypothesisRequest(BaseModel):
    hypothesis_id: str = Field(default_factory=lambda: __import__("uuid").uuid4().hex[:12])
    component_id: str
    phase_created: str
    reason: str
    confidence: Optional[float] = None
    evidence: List[Dict[str, Any]] = Field(default_factory=list)

class UpdateHypothesisRequest(BaseModel):
    status: Optional[str] = None
    superseded_by: Optional[str] = None
    confidence: Optional[float] = None

class CreateFindingRequest(BaseModel):
    finding_id: str = Field(default_factory=lambda: __import__("uuid").uuid4().hex[:12])
    hypothesis_id: Optional[str] = None
    root_cause_time: Optional[datetime] = None
    root_cause_component: Optional[str] = None
    root_cause_reason: Optional[str] = None

class LogAgentStepRequest(BaseModel):
    step_id: str = Field(default_factory=lambda: __import__("uuid").uuid4().hex[:12])
    phase: str
    tool_name: str
    args: Optional[Dict[str, Any]] = None
    result_summary: Optional[str] = None

class RunSQLRequest(BaseModel):
    sql: str

class ProcessQueryRequest(BaseModel):
    force: bool = False  # re-process even if already done
