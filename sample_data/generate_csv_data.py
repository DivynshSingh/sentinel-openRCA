"""Zero-dependency synthetic OpenRCA Bank benchmark dataset generator.

Generates realistic metrics, traces, logs, and query.csv strictly conforming to the
OpenRCA v1 dataset schema with distinct incident time windows.
"""
import os
import csv
import json
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path

def generate_openrca_bank_data(output_dir: str = "./data/Bank"):
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    random.seed(42)

    components = [f"pod-{i:02d}" for i in range(1, 15)]

    # 5 distinct OpenRCA benchmark incident scenarios with separate time windows
    scenarios = [
        {
            "query_id": "1",
            "base_time": datetime(2021, 3, 4, 18, 0, 0),
            "comp": "pod-07",
            "time_offset_min": 12,
            "metric_fault": "cpu_usage",
            "fault_val_range": (88.0, 97.5),
            "metric_2": "memory_usage",
            "fault_val_2": (85.0, 94.0),
            "reason": "high cpu usage and memory exhaustion in pod-07 leading to database connection pool timeouts and cascading latency spikes",
            "log_tpl": "CRITICAL [WorkerPool] OutOfMemoryError / CPU throttling detected in pod-07: connection pool timeout to DB",
            "decoy_comp": "pod-05",
        },
        {
            "query_id": "2",
            "base_time": datetime(2021, 3, 5, 14, 0, 0),
            "comp": "pod-04",
            "time_offset_min": 8,
            "metric_fault": "network_latency",
            "fault_val_range": (350.0, 600.0),
            "metric_2": "error_rate",
            "fault_val_2": (22.0, 38.0),
            "reason": "network latency surge and packet loss in pod-04 gateway routing proxy causing RPC timeouts on downstream client requests",
            "log_tpl": "ERROR [GatewayProxy] High packet drop and network latency surge in pod-04: downstream RPC timed out after 5000ms",
            "decoy_comp": "pod-08",
        },
        {
            "query_id": "3",
            "base_time": datetime(2021, 3, 6, 9, 0, 0),
            "comp": "pod-11",
            "time_offset_min": 15,
            "metric_fault": "disk_io",
            "fault_val_range": (85.0, 99.0),
            "metric_2": "error_rate",
            "fault_val_2": (18.0, 30.0),
            "reason": "disk io bottleneck and storage queue saturation in pod-11 causing write buffer stalls and database flush delays across cluster",
            "log_tpl": "FATAL [StorageEngine] Disk I/O bottleneck and I/O queue saturation in pod-11: write buffer stall exceeded threshold",
            "decoy_comp": "pod-06",
        },
        {
            "query_id": "4",
            "base_time": datetime(2021, 3, 7, 16, 0, 0),
            "comp": "pod-02",
            "time_offset_min": 5,
            "metric_fault": "error_rate",
            "fault_val_range": (28.0, 45.0),
            "metric_2": "memory_usage",
            "fault_val_2": (86.0, 96.0),
            "reason": "thread pool exhaustion and memory leak in pod-02 auth worker resulting in token validation timeouts and 500 internal server errors",
            "log_tpl": "CRITICAL [AuthWorker] Thread pool exhaustion and memory leak in pod-02: rejected execution for client token verification",
            "decoy_comp": "pod-01",
        },
        {
            "query_id": "5",
            "base_time": datetime(2021, 3, 8, 21, 0, 0),
            "comp": "pod-09",
            "time_offset_min": 20,
            "metric_fault": "memory_usage",
            "fault_val_range": (94.0, 99.0),
            "metric_2": "error_rate",
            "fault_val_2": (20.0, 35.0),
            "reason": "prolonged jvm garbage collection pauses and heap memory thrashing in pod-09 causing thread blocking and node heartbeat loss",
            "log_tpl": "CRITICAL [JVMRuntime] Prolonged Stop-The-World GC pause (2450ms) in pod-09: thread blocking and heartbeat missed",
            "decoy_comp": "pod-10",
        },
    ]

    metric_rows = [["cmdb_id", "kpi_name", "timestamp", "value"]]
    trace_rows = [["span_id", "trace_id", "parent_span_id", "cmdb_id", "timestamp", "duration_ms", "status", "call_type"]]
    log_rows = [["cmdb_id", "timestamp", "level", "message"]]
    query_rows = [["index", "question", "ground_truth"]]

    metric_names = ["cpu_usage", "memory_usage", "disk_io", "network_latency", "error_rate"]
    record_rows = [["index", "system", "incident_date", "root_cause_component", "ground_truth_time", "reason"]]

    # Overall dataset accumulators
    for sc in scenarios:
        qid = sc["query_id"]
        base_time = sc["base_time"]
        date_folder_name = base_time.strftime("%Y-%m-%d")
        fault_comp = sc["comp"]
        fault_time = base_time + timedelta(minutes=sc["time_offset_min"])
        decoy_comp = sc["decoy_comp"]
        end_time = base_time + timedelta(minutes=30)

        # Record CSV row (OpenRCA record.csv format)
        record_rows.append([qid, "Bank", date_folder_name, sc["comp"], fault_time.strftime("%Y-%m-%d %H:%M:%S"), sc["reason"]])

        # Query CSV
        question = (
            f"On {base_time.strftime('%B %d, %Y')}, between {base_time.strftime('%H:%M')} and {end_time.strftime('%H:%M')}, "
            f"a critical degradation occurred in the Bank system. "
            f"Identify the root cause component, the root cause occurrence timestamp, and the detailed diagnostic reason."
        )
        gt_dict = {
            qid: {
                "root cause occurrence datetime": fault_time.strftime("%Y-%m-%d %H:%M:%S"),
                "root cause component": sc["comp"],
                "root cause reason": sc["reason"]
            }
        }
        query_rows.append([qid, question, json.dumps(gt_dict)])

        # Date-specific telemetry folder paths
        date_dir = out / "telemetry" / date_folder_name
        metric_dir = date_dir / "metric"
        trace_dir = date_dir / "trace"
        log_dir = date_dir / "log"
        metric_dir.mkdir(parents=True, exist_ok=True)
        trace_dir.mkdir(parents=True, exist_ok=True)
        log_dir.mkdir(parents=True, exist_ok=True)

        sc_metric_rows = [["cmdb_id", "kpi_name", "timestamp", "value"]]
        sc_trace_rows = [["span_id", "trace_id", "parent_span_id", "cmdb_id", "timestamp", "duration_ms", "status", "call_type"]]
        sc_log_rows = [["cmdb_id", "timestamp", "level", "message"]]

        # Metrics for this scenario's 30-minute window
        for comp in components:
            for m in metric_names:
                for minute in range(30):
                    ts = base_time + timedelta(minutes=minute)
                    if m == "cpu_usage":
                        val = random.uniform(10.0, 22.0)
                    elif m == "memory_usage":
                        val = random.uniform(15.0, 25.0)
                    elif m == "disk_io":
                        val = random.uniform(5.0, 15.0)
                    elif m == "network_latency":
                        val = random.uniform(5.0, 15.0)
                    else:
                        val = random.uniform(0.0, 0.5)

                    # Root cause spike
                    if comp == fault_comp and ts >= fault_time:
                        if m == sc["metric_fault"]:
                            val = random.uniform(*sc["fault_val_range"])
                        elif m == sc.get("metric_2"):
                            val = random.uniform(*sc["fault_val_2"])

                    # Downstream decoy symptom
                    if comp == decoy_comp and ts >= fault_time + timedelta(minutes=2):
                        if m == "network_latency":
                            val = random.uniform(80.0, 140.0)
                        elif m == "error_rate":
                            val = random.uniform(5.0, 10.0)

                    row_entry = [comp, m, ts.strftime("%Y-%m-%d %H:%M:%S"), round(val, 2)]
                    metric_rows.append(row_entry)
                    sc_metric_rows.append(row_entry)

        # Traces for this scenario's window
        for i in range(10):
            trace_id = f"trace-q{qid}-{uuid.uuid4().hex[:6]}"
            t_span = fault_time + timedelta(seconds=i*30)
            root_span = f"span-q{qid}-root-{i:02d}"
            r1 = [root_span, trace_id, "", "pod-01", t_span.strftime("%Y-%m-%d %H:%M:%S"), 35, "ok", "GET /api/v1/entry"]
            trace_rows.append(r1)
            sc_trace_rows.append(r1)
            
            span_decoy = f"span-q{qid}-decoy-{i:02d}"
            r2 = [span_decoy, trace_id, root_span, decoy_comp, (t_span + timedelta(seconds=1)).strftime("%Y-%m-%d %H:%M:%S"), 850 if i >= 3 else 45, "error" if i >= 4 else "ok", "POST /api/v1/dispatch"]
            trace_rows.append(r2)
            sc_trace_rows.append(r2)

            span_rc = f"span-q{qid}-rc-{i:02d}"
            r3 = [span_rc, trace_id, span_decoy, fault_comp, (t_span + timedelta(seconds=2)).strftime("%Y-%m-%d %H:%M:%S"), 1650 if i >= 3 else 60, "error" if i >= 3 else "ok", "POST /internal/process"]
            trace_rows.append(r3)
            sc_trace_rows.append(r3)

        # Logs for this scenario's window
        for c in components[:4]:
            l1 = [c, (base_time + timedelta(minutes=2)).strftime("%Y-%m-%d %H:%M:%S"), "INFO", f"Periodic healthcheck ok for {c}"]
            log_rows.append(l1)
            sc_log_rows.append(l1)

        for off in range(0, 5):
            l2 = [fault_comp, (fault_time + timedelta(minutes=off)).strftime("%Y-%m-%d %H:%M:%S"), "CRITICAL", sc["log_tpl"]]
            log_rows.append(l2)
            sc_log_rows.append(l2)

        l3 = [decoy_comp, (fault_time + timedelta(minutes=2)).strftime("%Y-%m-%d %H:%M:%S"), "ERROR", f"Upstream service {fault_comp} response timeout after 5000ms: cascading latency in {decoy_comp}"]
        log_rows.append(l3)
        sc_log_rows.append(l3)

        # Write date-specific OpenRCA partitioned files
        with open(metric_dir / "metric_pod.csv", "w", newline="") as f:
            csv.writer(f).writerows(sc_metric_rows)
        with open(trace_dir / "trace_pod.csv", "w", newline="") as f:
            csv.writer(f).writerows(sc_trace_rows)
        with open(log_dir / "log_pod.csv", "w", newline="") as f:
            csv.writer(f).writerows(sc_log_rows)

    # Write root files: query.csv, record.csv
    with open(out / "query.csv", "w", newline="") as f:
        csv.writer(f).writerows(query_rows)

    with open(out / "record.csv", "w", newline="") as f:
        csv.writer(f).writerows(record_rows)

    print(f"Generated complete OpenRCA Bank benchmark dataset with nested telemetry -> {out}")

if __name__ == "__main__":
    generate_openrca_bank_data()
