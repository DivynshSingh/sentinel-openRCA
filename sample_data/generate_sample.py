"""Synthetic OpenRCA-shaped dataset generator for Sentinel testing.

Creates a small, self-contained dataset with an injected fault so the entire
pipeline can be tested without the real 68GB OpenRCA dataset.

Usage:
    python sample_data/generate_sample.py --output ./data/Bank
"""
import os
import argparse
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import numpy as np


def generate_sample_data(output_dir: str, num_components: int = 14, num_queries: int = 5):
    """Generate synthetic Bank-like dataset with injected fault."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    random.seed(42)
    np.random.seed(42)

    # Components (pods)
    components = [f"pod-{i:02d}" for i in range(1, num_components + 1)]

    # Time window
    base_time = datetime(2021, 3, 4, 18, 0, 0)
    window_duration = timedelta(minutes=30)

    # --- METRICS ---
    # Pick one component as root cause
    root_cause_component = "pod-07"
    root_cause_time = base_time + timedelta(minutes=12)

    metrics_records = []
    metric_names = ["cpu_usage", "memory_usage", "disk_io", "network_latency", "error_rate"]

    for comp in components:
        for metric in metric_names:
            # Generate 30 data points (1 per minute)
            for i in range(30):
                ts = base_time + timedelta(minutes=i)

                # Normal baseline
                if metric == "cpu_usage":
                    base_val = random.uniform(30, 60)
                elif metric == "memory_usage":
                    base_val = random.uniform(40, 70)
                elif metric == "disk_io":
                    base_val = random.uniform(10, 30)
                elif metric == "network_latency":
                    base_val = random.uniform(20, 50)
                else:  # error_rate
                    base_val = random.uniform(0, 2)

                # Inject fault for root cause component
                if comp == root_cause_component and ts >= root_cause_time:
                    if metric == "cpu_usage":
                        base_val = random.uniform(85, 98)
                    elif metric == "error_rate":
                        base_val = random.uniform(15, 30)
                    elif metric == "memory_usage":
                        base_val = random.uniform(80, 95)

                # Downstream amplification (pods that call the root cause)
                if comp in ["pod-05", "pod-06", "pod-08"] and ts >= root_cause_time + timedelta(minutes=3):
                    if metric == "network_latency":
                        base_val = random.uniform(200, 500)
                    elif metric == "error_rate":
                        base_val = random.uniform(5, 12)

                metrics_records.append({
                    "cmdb_id": comp,
                    "kpi_name": metric,
                    "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                    "value": round(base_val, 2),
                })

    metrics_df = pd.DataFrame(metrics_records)
    metrics_df.to_csv(output_dir / "metric_pod.csv", index=False)
    print(f"Generated {len(metrics_df)} metric points -> {output_dir}/metric_pod.csv")

    # --- TRACES ---
    # Create call topology: root cause is called by pod-05 and pod-06
    # pod-07 calls pod-08
    # Inject high latency on root cause and downstream

    trace_records = []
    trace_id = f"trace-{uuid.uuid4().hex[:8]}"

    # Root span
    root_span = f"span-{uuid.uuid4().hex[:8]}"
    trace_records.append({
        "span_id": root_span,
        "trace_id": trace_id,
        "parent_span_id": "",
        "cmdb_id": "pod-01",
        "timestamp": (base_time + timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S"),
        "duration_ms": 45,
        "status": "ok",
        "call_type": "GET /api/v1/users",
    })

    # Chain to pod-05
    span_05 = f"span-{uuid.uuid4().hex[:8]}"
    trace_records.append({
        "span_id": span_05,
        "trace_id": trace_id,
        "parent_span_id": root_span,
        "cmdb_id": "pod-05",
        "timestamp": (base_time + timedelta(minutes=10, seconds=1)).strftime("%Y-%m-%d %H:%M:%S"),
        "duration_ms": 120,
        "status": "ok",
        "call_type": "GET /api/v1/orders",
    })

    # Chain to root cause pod-07 (high latency after fault)
    for i, minute_offset in enumerate([12, 13, 14, 15]):
        span_07 = f"span-{uuid.uuid4().hex[:8]}"
        trace_records.append({
            "span_id": span_07,
            "trace_id": trace_id,
            "parent_span_id": span_05 if i == 0 else f"span-{trace_records[-1]['span_id']}",
            "cmdb_id": root_cause_component,
            "timestamp": (base_time + timedelta(minutes=minute_offset)).strftime("%Y-%m-%d %H:%M:%S"),
            "duration_ms": random.randint(800, 1500) if minute_offset >= 12 else 60,
            "status": "error" if minute_offset >= 13 else "ok",
            "call_type": "POST /db/query",
        })

    # Downstream from pod-07 to pod-08 (amplified latency)
    span_08 = f"span-{uuid.uuid4().hex[:8]}"
    trace_records.append({
        "span_id": span_08,
        "trace_id": trace_id,
        "parent_span_id": trace_records[-1]["span_id"],
        "cmdb_id": "pod-08",
        "timestamp": (base_time + timedelta(minutes=15, seconds=1)).strftime("%Y-%m-%d %H:%M:%S"),
        "duration_ms": 600,
        "status": "error",
        "call_type": "GET /cache/refresh",
    })

    traces_df = pd.DataFrame(trace_records)
    traces_df.to_csv(output_dir / "trace_pod.csv", index=False)
    print(f"Generated {len(traces_df)} spans -> {output_dir}/trace_pod.csv")

    # --- LOGS ---
    log_records = []

    # Normal operational logs
    for comp in components:
        for i in range(5):
            ts = base_time + timedelta(minutes=i * 5)
            log_records.append({
                "cmdb_id": comp,
                "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                "level": "INFO",
                "message": f"Service {comp} health check passed at {ts}",
            })

    # Error logs on root cause component
    error_templates = [
        "Connection timeout to database 192.168.1.{num}: {err}",
        "Failed to process request {req_id}: OutOfMemoryError in {comp}",
        "CRITICAL: {comp} CPU throttled at {pct}% — performance degraded",
        "Error: unable to allocate {size}MB heap memory in {comp}",
    ]

    for i, minute_offset in enumerate([12, 13, 14, 15, 16]):
        ts = base_time + timedelta(minutes=minute_offset)
        template = error_templates[i % len(error_templates)]
        msg = template.format(
            num=random.randint(10, 50),
            err=random.choice(["Connection refused", "Read timed out", "Broken pipe"]),
            req_id=uuid.uuid4().hex[:8],
            comp=root_cause_component,
            pct=random.randint(90, 99),
            size=random.randint(512, 1024),
        )
        log_records.append({
            "cmdb_id": root_cause_component,
            "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
            "level": "ERROR",
            "message": msg,
        })

    # Downstream error logs
    for comp in ["pod-05", "pod-08"]:
        ts = base_time + timedelta(minutes=15)
        log_records.append({
            "cmdb_id": comp,
            "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
            "level": "ERROR",
            "message": f"Upstream dependency {root_cause_component} unavailable: cascading failure in {comp}",
        })

    logs_df = pd.DataFrame(log_records)
    logs_df.to_csv(output_dir / "log_pod.csv", index=False)
    print(f"Generated {len(logs_df)} log entries -> {output_dir}/log_pod.csv")

    # --- QUERIES ---
    queries = []
    for qid in range(1, num_queries + 1):
        queries.append({
            "index": qid,
            "question": f"On March 4, 2021, between 18:00 and 18:30, there was a single failure observed in the system. The exact component that caused this failure is unknown, and the reason behind the failure is also undetermined. Your task is to identify the root cause component and the root cause reason for this failure.",
            "ground_truth": json.dumps({
                "1": {
                    "root cause occurrence datetime": root_cause_time.strftime("%Y-%m-%d %H:%M:%S"),
                    "root cause component": root_cause_component,
                    "root cause reason": "high cpu usage and memory exhaustion leading to database connection timeouts",
                }
            }),
        })

    queries_df = pd.DataFrame(queries)
    queries_df.to_csv(output_dir / "query.csv", index=False)
    print(f"Generated {len(queries_df)} queries -> {output_dir}/query.csv")

    # --- RECORD (historical issues, not used by agent) ---
    record_df = pd.DataFrame({
        "index": [1],
        "issue": [f"{root_cause_component} experienced high CPU and memory issues on 2021-03-04"],
    })
    record_df.to_csv(output_dir / "record.csv", index=False)
    print(f"Generated record.csv")

    print(f"\n✅ Sample dataset ready in {output_dir}")
    print(f"   Root cause: {root_cause_component} at {root_cause_time}")
    print(f"   Use this to test: POST /queries/1/process → GET /queries/1/metrics/summary")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="./data/Bank", help="Output directory")
    parser.add_argument("--components", type=int, default=14, help="Number of components")
    parser.add_argument("--queries", type=int, default=5, help="Number of queries")
    args = parser.parse_args()

    generate_sample_data(args.output, args.components, args.queries)
