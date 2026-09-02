"""Sentinel REST Service — FastAPI layer over DuckDB.

All MCP tools call these endpoints. All data lives behind REST.
"""
import os
import json
import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any
from pathlib import Path

import duckdb
import pandas as pd
import yaml
from fastapi import FastAPI, HTTPException, Query as QueryParam
from fastapi.responses import JSONResponse

from .database import init_db, get_db, close_db
from .data_processor import DataProcessor
from . import models

app = FastAPI(title="Sentinel REST Service", version="2.0.0")

# ------------------------------------------------------------------
# LIFECYCLE
# ------------------------------------------------------------------

@app.on_event("startup")
def startup():
    """Initialize DB and load raw data from CSVs if present."""
    cfg = load_config()
    init_db(cfg["data_paths"]["db_path"])
    load_raw_data(cfg)

def load_config():
    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path) as f:
        return yaml.safe_load(f)["sentinel"]

def load_raw_data(cfg: dict):
    """Load OpenRCA CSVs into DuckDB if tables are empty."""
    conn = get_db()

    # Check if already loaded
    metric_count = conn.execute("SELECT COUNT(*) FROM metric_point").fetchone()[0]
    if metric_count > 0:
        return

    data_paths = cfg["data_paths"]

    # Load components from metrics (discover unique component_ids)
    # Metrics CSV
    metric_csv = data_paths.get("metrics_csv")
    if metric_csv and os.path.exists(metric_csv):
        # TODO: Adjust column names to match actual OpenRCA v1 Bank schema
        # Common schemas: cmdb_id, kpi_name, timestamp, value
        conn.execute(f"""
            CREATE OR REPLACE TEMP VIEW raw_metrics AS
            SELECT * FROM read_csv_auto('{metric_csv}')
        """)
        # Try to infer columns — this is heuristic
        conn.execute("""
            INSERT INTO metric_point (id, component_id, kpi_name, ts, value)
            SELECT 
                'mp-' || row_number() OVER () as id,
                COALESCE(cmdb_id, pod, service, component_id, 'unknown') as component_id,
                COALESCE(kpi_name, metric_name, name, 'unknown') as kpi_name,
                TRY_CAST(COALESCE(timestamp, ts, time, datetime) AS TIMESTAMP) as ts,
                TRY_CAST(COALESCE(value, val) AS DOUBLE) as value
            FROM raw_metrics
            WHERE TRY_CAST(COALESCE(value, val) AS DOUBLE) IS NOT NULL
        """)

        # Discover components
        conn.execute("""
            INSERT OR IGNORE INTO component (cmdb_id, name, type, system)
            SELECT DISTINCT component_id, component_id, 'pod', 'Bank'
            FROM metric_point
        """)

    # Traces CSV
    trace_csv = data_paths.get("traces_csv")
    if trace_csv and os.path.exists(trace_csv):
        conn.execute(f"""
            CREATE OR REPLACE TEMP VIEW raw_traces AS
            SELECT * FROM read_csv_auto('{trace_csv}')
        """)
        conn.execute("""
            INSERT INTO span (span_id, trace_id, parent_span_id, component_id, start_time, duration_ms, status, call_type)
            SELECT 
                COALESCE(span_id, spanID, id) as span_id,
                COALESCE(trace_id, traceID, parent_id) as trace_id,
                COALESCE(parent_span_id, parentSpanID, parent_id) as parent_span_id,
                COALESCE(cmdb_id, pod, service, component_id, 'unknown') as component_id,
                TRY_CAST(COALESCE(timestamp, ts, start_time, time) AS TIMESTAMP) as start_time,
                TRY_CAST(COALESCE(duration_ms, duration, latency, elapsed_time) AS INTEGER) as duration_ms,
                COALESCE(status, 'unknown') as status,
                COALESCE(call_type, operation, method, 'unknown') as call_type
            FROM raw_traces
        """)

    # Logs CSV
    log_csv = data_paths.get("logs_csv")
    if log_csv and os.path.exists(log_csv):
        conn.execute(f"""
            CREATE OR REPLACE TEMP VIEW raw_logs AS
            SELECT * FROM read_csv_auto('{log_csv}')
        """)
        conn.execute("""
            INSERT INTO log_entry (id, component_id, ts, level, message)
            SELECT 
                'le-' || row_number() OVER () as id,
                COALESCE(cmdb_id, pod, service, component_id, 'unknown') as component_id,
                TRY_CAST(COALESCE(timestamp, ts, time, datetime) AS TIMESTAMP) as ts,
                COALESCE(level, severity, log_level, 'INFO') as level,
                COALESCE(message, content, log, text, '') as message
            FROM raw_logs
        """)

    # Query CSV
    query_csv = data_paths.get("query_csv")
    if query_csv and os.path.exists(query_csv):
        conn.execute(f"""
            CREATE OR REPLACE TEMP VIEW raw_queries AS
            SELECT * FROM read_csv_auto('{query_csv}')
        """)
        # OpenRCA v1 query.csv has: index, question, ground_truth (JSON string)
        conn.execute("""
            INSERT OR IGNORE INTO query (query_id, question_text, window_start, window_end, system, status, ground_truth)
            SELECT 
                COALESCE(CAST(idx AS VARCHAR), CAST(index AS VARCHAR), 'q-' || row_number() OVER ()) as query_id,
                COALESCE(question, query, text, '') as question_text,
                TRY_CAST('2021-01-01 00:00:00' AS TIMESTAMP) as window_start,
                TRY_CAST('2021-01-01 23:59:59' AS TIMESTAMP) as window_end,
                'Bank' as system,
                'pending' as status,
                TRY_CAST(COALESCE(ground_truth, answer, prediction) AS JSON) as ground_truth
            FROM raw_queries
        """)

@app.on_event("shutdown")
def shutdown():
    close_db()

# ------------------------------------------------------------------
# QUERY ENDPOINTS
# ------------------------------------------------------------------

@app.get("/queries", response_model=List[models.Query])
def list_queries(status: Optional[str] = QueryParam(None)):
    conn = get_db()
    sql = "SELECT * FROM query"
    params = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY query_id"
    df = conn.execute(sql, params).fetchdf()
    return df.to_dict("records")

@app.get("/queries/{qid}", response_model=models.Query)
def get_query(qid: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM query WHERE query_id = ?", [qid]).fetchdf()
    if row.empty:
        raise HTTPException(status_code=404, detail="Query not found")
    return row.to_dict("records")[0]

# ------------------------------------------------------------------
# DATA PROCESSOR
# ------------------------------------------------------------------

@app.post("/queries/{qid}/process")
def process_query(qid: str, req: Optional[models.ProcessQueryRequest] = None):
    cfg = load_config()
    dp_cfg = cfg["data_processor"]
    processor = DataProcessor(
        metric_sigma=dp_cfg["metric_sigma"],
        trace_latency_pct=dp_cfg["trace_latency_pct"],
        log_keywords=dp_cfg["log_keywords"],
        log_tfidf_pctile=dp_cfg["log_tfidf_pctile"],
        trace_window_seconds=dp_cfg["trace_window_seconds"],
        top_k_pods=dp_cfg["top_k_pods"],
        top_k_metrics=dp_cfg["top_k_metrics"],
    )
    force = req.force if req else False
    result = processor.process_query(qid, force=force)

    if result["status"] == "error":
        raise HTTPException(status_code=404, detail=result["reason"])

    # Update query status
    conn = get_db()
    conn.execute("UPDATE query SET status = 'processing' WHERE query_id = ?", [qid])

    return result

# ------------------------------------------------------------------
# METRICS ENDPOINTS
# ------------------------------------------------------------------

@app.get("/queries/{qid}/metrics/summary", response_model=List[models.MetricAnomaly])
def summarize_metrics(qid: str):
    conn = get_db()
    df = conn.execute(
        "SELECT * FROM metric_anomaly WHERE query_id = ? ORDER BY deviation_score DESC",
        [qid]
    ).fetchdf()
    return df.to_dict("records")

@app.get("/queries/{qid}/metrics", response_model=List[models.MetricPoint])
def fetch_metrics(
    qid: str,
    component: Optional[str] = QueryParam(None),
    metric: Optional[str] = QueryParam(None),
):
    conn = get_db()
    # Get query window
    row = conn.execute(
        "SELECT window_start, window_end FROM query WHERE query_id = ?", [qid]
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Query not found")
    ws, we = row

    sql = """
        SELECT * FROM metric_point
        WHERE ts >= ? AND ts <= ?
    """
    params = [ws, we]
    if component:
        sql += " AND component_id = ?"
        params.append(component)
    if metric:
        sql += " AND kpi_name = ?"
        params.append(metric)
    sql += " ORDER BY ts"

    df = conn.execute(sql, params).fetchdf()
    return df.to_dict("records")

# ------------------------------------------------------------------
# TRACES ENDPOINTS
# ------------------------------------------------------------------

@app.get("/queries/{qid}/traces/summary")
def summarize_traces(qid: str):
    conn = get_db()
    ts_df = conn.execute(
        "SELECT * FROM trace_summary WHERE query_id = ? ORDER BY max_latency_ms DESC",
        [qid]
    ).fetchdf()
    tp_df = conn.execute(
        "SELECT * FROM trace_path WHERE query_id = ? ORDER BY frequency DESC",
        [qid]
    ).fetchdf()
    return {
        "summaries": ts_df.to_dict("records"),
        "paths": tp_df.to_dict("records"),
    }

@app.get("/queries/{qid}/traces", response_model=List[models.Span])
def fetch_traces(
    qid: str,
    trace_id: Optional[str] = QueryParam(None),
    component: Optional[str] = QueryParam(None),
):
    conn = get_db()
    row = conn.execute(
        "SELECT window_start, window_end FROM query WHERE query_id = ?", [qid]
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Query not found")
    ws, we = row

    sql = "SELECT * FROM span WHERE start_time >= ? AND start_time <= ?"
    params = [ws, we]
    if trace_id:
        sql += " AND trace_id = ?"
        params.append(trace_id)
    if component:
        sql += " AND component_id = ?"
        params.append(component)
    sql += " ORDER BY start_time"

    df = conn.execute(sql, params).fetchdf()
    return df.to_dict("records")

@app.get("/traces/spans/{sid}/upstream")
def walk_upstream_trace(sid: str, max_hops: int = 10):
    """Deterministic upstream walk from a span via parent_span_id.

    Returns the ordered ancestor chain with anomaly flags.
    """
    conn = get_db()
    chain = []
    current_id = sid
    visited = set()

    for _ in range(max_hops):
        if current_id in visited:
            break
        visited.add(current_id)

        row = conn.execute(
            """
            SELECT s.span_id, s.trace_id, s.parent_span_id, s.component_id, 
                   s.start_time, s.duration_ms, s.status, s.call_type,
                   m.is_anomalous
            FROM span s
            LEFT JOIN metric_point m ON s.component_id = m.component_id
                AND s.start_time >= m.ts AND s.start_time < m.ts + INTERVAL '1 minute'
            WHERE s.span_id = ?
            LIMIT 1
            """,
            [current_id]
        ).fetchdf()

        if row.empty:
            break

        record = row.to_dict("records")[0]
        chain.append(record)

        parent = record.get("parent_span_id")
        if not parent:
            break
        current_id = parent

    return {
        "start_span_id": sid,
        "chain_length": len(chain),
        "chain": chain,
    }

# ------------------------------------------------------------------
# LOGS ENDPOINTS
# ------------------------------------------------------------------

@app.get("/queries/{qid}/logs/summary", response_model=List[models.LogSummary])
def summarize_logs(qid: str):
    conn = get_db()
    df = conn.execute(
        "SELECT * FROM log_summary WHERE query_id = ? ORDER BY tfidf_score DESC",
        [qid]
    ).fetchdf()
    return df.to_dict("records")

@app.get("/queries/{qid}/logs", response_model=List[models.LogEntry])
def fetch_logs(
    qid: str,
    component: Optional[str] = QueryParam(None),
    level: Optional[str] = QueryParam(None),
):
    conn = get_db()
    row = conn.execute(
        "SELECT window_start, window_end FROM query WHERE query_id = ?", [qid]
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Query not found")
    ws, we = row

    sql = "SELECT * FROM log_entry WHERE ts >= ? AND ts <= ?"
    params = [ws, we]
    if component:
        sql += " AND component_id = ?"
        params.append(component)
    if level:
        sql += " AND level = ?"
        params.append(level)
    sql += " ORDER BY ts"

    df = conn.execute(sql, params).fetchdf()
    return df.to_dict("records")

# ------------------------------------------------------------------
# SQL QUERY
# ------------------------------------------------------------------

@app.post("/query")
def run_sql(req: models.RunSQLRequest):
    """Execute arbitrary SQL against DuckDB. Read-only by default."""
    conn = get_db()
    try:
        df = conn.execute(req.sql).fetchdf()
        return {
            "columns": df.columns.tolist(),
            "rows": df.to_dict("records"),
            "row_count": len(df),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ------------------------------------------------------------------
# HYPOTHESIS ENDPOINTS
# ------------------------------------------------------------------

@app.post("/queries/{qid}/hypotheses")
def create_hypothesis(qid: str, req: models.CreateHypothesisRequest):
    conn = get_db()
    # Verify query exists
    check = conn.execute("SELECT 1 FROM query WHERE query_id = ?", [qid]).fetchone()
    if check is None:
        raise HTTPException(status_code=404, detail="Query not found")

    conn.execute("""
        INSERT INTO hypothesis (hypothesis_id, query_id, component_id, phase_created, reason, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
    """, [req.hypothesis_id, qid, req.component_id, req.phase_created, req.reason, req.confidence])

    # Insert evidence citations
    for ev in req.evidence:
        conn.execute("""
            INSERT INTO hypothesis_evidence (evidence_id, hypothesis_id, evidence_type, evidence_table, evidence_pk, citation_text)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            f"he-{uuid.uuid4().hex[:8]}",
            req.hypothesis_id,
            ev.get("evidence_type", "unknown"),
            ev.get("evidence_table", "unknown"),
            ev.get("evidence_pk", ""),
            ev.get("citation_text", ""),
        ])

    return {"hypothesis_id": req.hypothesis_id, "status": "created"}

@app.get("/queries/{qid}/hypotheses", response_model=List[models.Hypothesis])
def get_hypotheses(qid: str, status: Optional[str] = QueryParam(None)):
    conn = get_db()
    sql = "SELECT * FROM hypothesis WHERE query_id = ?"
    params = [qid]
    if status:
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    df = conn.execute(sql, params).fetchdf()
    return df.to_dict("records")

@app.patch("/hypotheses/{hid}")
def update_hypothesis(hid: str, req: models.UpdateHypothesisRequest):
    conn = get_db()
    updates = []
    params = []
    if req.status is not None:
        updates.append("status = ?")
        params.append(req.status)
    if req.superseded_by is not None:
        updates.append("superseded_by = ?")
        params.append(req.superseded_by)
    if req.confidence is not None:
        updates.append("confidence = ?")
        params.append(req.confidence)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    params.append(hid)
    sql = f"UPDATE hypothesis SET {', '.join(updates)} WHERE hypothesis_id = ?"
    conn.execute(sql, params)

    return {"hypothesis_id": hid, "status": "updated"}

# ------------------------------------------------------------------
# FINDING ENDPOINTS
# ------------------------------------------------------------------

@app.post("/queries/{qid}/findings")
def create_finding(qid: str, req: models.CreateFindingRequest):
    conn = get_db()
    check = conn.execute("SELECT 1 FROM query WHERE query_id = ?", [qid]).fetchone()
    if check is None:
        raise HTTPException(status_code=404, detail="Query not found")

    conn.execute("""
        INSERT INTO finding (finding_id, query_id, hypothesis_id, root_cause_time, root_cause_component, root_cause_reason, confirmed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, [
        req.finding_id, qid, req.hypothesis_id, req.root_cause_time,
        req.root_cause_component, req.root_cause_reason, datetime.now()
    ])

    # Update query status
    conn.execute("UPDATE query SET status = 'done' WHERE query_id = ?", [qid])

    return {"finding_id": req.finding_id, "status": "created"}

@app.get("/queries/{qid}/findings", response_model=List[models.Finding])
def get_findings(qid: str):
    conn = get_db()
    df = conn.execute("SELECT * FROM finding WHERE query_id = ?", [qid]).fetchdf()
    return df.to_dict("records")

# ------------------------------------------------------------------
# AGENT STEP LOGGING
# ------------------------------------------------------------------

@app.post("/queries/{qid}/steps")
def log_agent_step(qid: str, req: models.LogAgentStepRequest):
    conn = get_db()
    conn.execute("""
        INSERT INTO agent_step (step_id, query_id, phase, tool_name, args, result_summary, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, [
        req.step_id, qid, req.phase, req.tool_name,
        json.dumps(req.args) if req.args else None,
        req.result_summary, datetime.now()
    ])
    return {"step_id": req.step_id, "status": "logged"}

@app.get("/queries/{qid}/steps", response_model=List[models.AgentStep])
def get_agent_steps(qid: str):
    conn = get_db()
    df = conn.execute(
        "SELECT * FROM agent_step WHERE query_id = ? ORDER BY ts",
        [qid]
    ).fetchdf()
    return df.to_dict("records")

# ------------------------------------------------------------------
# HEALTH
# ------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "service": "sentinel-rest"}
