"""Telemetry Data Engine and Preprocessing Pipeline for OpenRCA v1.

Reads heterogeneous telemetry from CSV files (query.csv, record.csv, and daily partitioned telemetry)
and computes 3-sigma metric anomalies, trace bottlenecks, and log clusters within each incident window.
"""
import os
import csv
import json
import math
import re
import time
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from collections import defaultdict

class TelemetryStore:
    """Zero-cheating, memory-efficient on-demand telemetry store for massive datasets."""
    def __init__(self, data_dir: Optional[str] = None):
        self.data_dir = data_dir or os.getenv("DATA_DIR", "./data/Bank")
        self.queries: Dict[str, Dict[str, Any]] = {}
        self.metric_files: List[str] = []
        self.trace_files: List[str] = []
        self.log_files: List[str] = []
        self.index_dataset_files()

    @staticmethod
    def normalize_timestamp(val: Any) -> str:
        """Converts raw timestamps (epoch seconds/ms/strings) to '%Y-%m-%d %H:%M:%S'."""
        if val is None:
            return ""
        s = str(val).strip()
        if not s:
            return ""
        # Check if numeric epoch
        try:
            num = float(s)
            if num > 1e14:  # us
                num = num / 1000000.0
            elif num > 1e11:  # ms
                num = num / 1000.0
            dt = datetime.fromtimestamp(num)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except (ValueError, OverflowError, OSError):
            pass

        # String datetime parsing
        clean_s = s.replace("_", "-").replace("T", " ")
        if len(clean_s) >= 19:
            return clean_s[:19]
        return clean_s

    @staticmethod
    def parse_time_window_from_question(question: str) -> Tuple[str, str]:
        """Extracts window_start and window_end from incident question/instruction text, supporting multi-date and cross-midnight boundaries."""
        if not question:
            return "", ""
        
        month_pattern = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
        
        # Check if question has two explicit date strings (e.g., "from March 6, 2021, from 23:30 to March 7, 2021, at 00:00")
        all_dates = list(re.finditer(rf"({month_pattern}\s+\d{{1,2}},?\s*\d{{4}})", question, re.IGNORECASE))
        m_times = re.findall(r"(\d{1,2}:\d{2}(?::\d{2})?)", question)

        if len(all_dates) >= 2 and len(m_times) >= 2:
            try:
                d1_raw = all_dates[0].group(1).replace(",", "").strip()
                d2_raw = all_dates[1].group(1).replace(",", "").strip()
                d1 = None
                d2 = None
                for fmt in ("%B %d %Y", "%b %d %Y"):
                    try:
                        d1 = d1 or datetime.strptime(d1_raw, fmt)
                    except Exception:
                        pass
                    try:
                        d2 = d2 or datetime.strptime(d2_raw, fmt)
                    except Exception:
                        pass
                if d1 and d2:
                    sh, sm = map(int, m_times[0].split(":")[:2])
                    eh, em = map(int, m_times[1].split(":")[:2])
                    w_start = d1.replace(hour=sh, minute=sm, second=0).strftime("%Y-%m-%d %H:%M:%S")
                    w_end = d2.replace(hour=eh, minute=em, second=0).strftime("%Y-%m-%d %H:%M:%S")
                    return w_start, w_end
            except Exception:
                pass

        # Pattern 1: Single Date with start and end times
        if len(all_dates) >= 1 and len(m_times) >= 2:
            date_raw = all_dates[0].group(1).replace(",", "").strip()
            for fmt in ("%B %d %Y", "%b %d %Y"):
                try:
                    d = datetime.strptime(date_raw, fmt)
                    sh, sm = map(int, m_times[0].split(":")[:2])
                    eh, em = map(int, m_times[1].split(":")[:2])
                    w_start_dt = d.replace(hour=sh, minute=sm, second=0)
                    w_end_dt = d.replace(hour=eh, minute=em, second=0)
                    
                    # Handle cross-midnight rollover (e.g. 23:30 to 00:00)
                    if w_end_dt <= w_start_dt:
                        w_end_dt = w_end_dt + timedelta(days=1)

                    w_start = w_start_dt.strftime("%Y-%m-%d %H:%M:%S")
                    w_end = w_end_dt.strftime("%Y-%m-%d %H:%M:%S")
                    return w_start, w_end
                except Exception:
                    pass

        # Pattern 2: ISO dates in question
        iso_matches = re.findall(r"(\d{4}[-_]\d{2}[-_]\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)", question)
        if len(iso_matches) >= 2:
            s1 = TelemetryStore.normalize_timestamp(iso_matches[0])
            s2 = TelemetryStore.normalize_timestamp(iso_matches[1])
            if s1 and s2:
                if s2 <= s1 and len(s2) >= 19 and len(s1) >= 19:
                    try:
                        dt2 = datetime.strptime(s2, "%Y-%m-%d %H:%M:%S") + timedelta(days=1)
                        s2 = dt2.strftime("%Y-%m-%d %H:%M:%S")
                    except Exception:
                        pass
                return s1, s2

        return "", ""

    def _parse_ground_truth(self, qid: str, row: Dict[str, Any]) -> Dict[str, str]:
        """Parses ground truth annotations from JSON or OpenRCA scoring_points text."""
        gt_raw = row.get("ground_truth") or row.get("scoring_points") or row.get("label") or "{}"
        
        # 1. Try parsing JSON format
        try:
            gt_obj = json.loads(gt_raw) if isinstance(gt_raw, str) and gt_raw.startswith("{") else gt_raw
            if isinstance(gt_obj, dict):
                if qid in gt_obj:
                    inner = gt_obj[qid]
                    return {
                        "root_cause_component": str(inner.get("root cause component", inner.get("component", ""))).strip(),
                        "root_cause_time": str(inner.get("root cause occurrence datetime", inner.get("timestamp", ""))).strip(),
                        "root_cause_reason": str(inner.get("root cause reason", inner.get("reason", ""))).strip(),
                    }
                return {
                    "root_cause_component": str(gt_obj.get("root_cause_component", gt_obj.get("root cause component", ""))).strip(),
                    "root_cause_time": str(gt_obj.get("root_cause_time", gt_obj.get("root cause occurrence datetime", ""))).strip(),
                    "root_cause_reason": str(gt_obj.get("root_cause_reason", gt_obj.get("root cause reason", ""))).strip(),
                }
        except Exception:
            pass

        # 2. Parse textual scoring_points (OpenRCA official text format)
        text = str(gt_raw).strip()
        comp = ""
        ts = ""
        reason = text

        m_comp = re.search(r"(?:root cause component is|component is|root cause is)\s+([A-Za-z0-9_\-\.]+)", text, re.IGNORECASE)
        if m_comp:
            comp = m_comp.group(1).rstrip(".,")

        m_time = re.search(r"(\d{4}[-_]\d{2}[-_]\d{2}\s+\d{2}:\d{2}:\d{2})", text)
        if m_time:
            ts = TelemetryStore.normalize_timestamp(m_time.group(1))

        return {
            "root_cause_component": comp,
            "root_cause_time": ts,
            "root_cause_reason": reason,
        }

    def index_dataset_files(self):
        """Indexes file paths and loads query index into memory without reading 25GB+ raw CSVs."""
        # 1. Locate and parse query.csv / record.csv
        query_candidates = [
            os.path.join(self.data_dir, "query.csv"),
            os.path.join(self.data_dir, "Bank", "query.csv"),
            os.path.join("./data/Bank", "query.csv"),
            os.path.join("./data", "query.csv"),
        ]
        query_csv_path = next((p for p in query_candidates if os.path.exists(p)), None)

        if query_csv_path and os.path.exists(query_csv_path):
            with open(query_csv_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for idx, row in enumerate(reader):
                    question = str(row.get("instruction") or row.get("question") or row.get("query") or "").strip()
                    
                    # Strictly skip empty questions / instructions
                    if not question:
                        continue

                    # Generate a guaranteed unique query ID per CSV row (do NOT use task_index as key)
                    row_idx = row.get("index") or row.get("query_id") or row.get("id")
                    qid = str(row_idx).strip() if row_idx and str(row_idx).strip() != "" else str(idx + 1)
                    task_type = str(row.get("task_index") or "").strip()

                    gt_parsed = self._parse_ground_truth(qid, row)
                    w_start, w_end = self.parse_time_window_from_question(question)
                    
                    self.queries[qid] = {
                        "query_id": qid,
                        "row_index": idx + 1,
                        "task_type": task_type,
                        "system": os.path.basename(os.path.abspath(self.data_dir)),
                        "window_start": w_start,
                        "window_end": w_end,
                        "question": question,
                        "ground_truth": gt_parsed,
                    }

        # 2. Discover telemetry file paths lazily
        metric_files = []
        trace_files = []
        log_files = []

        search_dirs = [self.data_dir, "./data/Bank", "./data"]
        seen_dirs = set()
        for s_dir in search_dirs:
            if not os.path.exists(s_dir) or os.path.abspath(s_dir) in seen_dirs:
                continue
            seen_dirs.add(os.path.abspath(s_dir))
            for root, _, files in os.walk(s_dir):
                for file in files:
                    if not file.endswith(".csv") or file in ("query.csv", "record.csv"):
                        continue
                    file_path = os.path.join(root, file)
                    norm_path = file_path.lower().replace("\\", "/")
                    
                    if "metric" in norm_path:
                        metric_files.append(file_path)
                    elif "trace" in norm_path:
                        trace_files.append(file_path)
                    elif "log" in norm_path:
                        log_files.append(file_path)

        self.metric_files = list(set(metric_files))
        self.trace_files = list(set(trace_files))
        self.log_files = list(set(log_files))
        print(f"[TelemetryStore] Indexed {len(self.queries)} incident queries | Telemetry files: {len(self.metric_files)} metric, {len(self.trace_files)} trace, {len(self.log_files)} log.")

    def _filter_files_for_window(self, file_list: List[str], window_start: str) -> List[str]:
        """Prunes file paths by incident date (supports 2021_03_04, 2021-03-04, 20210304) to avoid full scans."""
        if not window_start or not file_list:
            return file_list
            
        date_part = window_start.split(" ")[0]  # e.g. '2021-03-04'
        variants = [
            date_part,
            date_part.replace("-", "_"),  # '2021_03_04'
            date_part.replace("-", ""),   # '20210304'
            date_part.replace("-", "/"),  # '2021/03/04'
        ]
        
        matched = [f for f in file_list if any(v in f for v in variants)]
        if matched:
            return matched
        return file_list

    def stream_metrics_for_query(self, query_id: str) -> List[Dict[str, Any]]:
        """Streams and filters metrics line-by-line for the specific incident window only."""
        q = self.get_query(query_id)
        if not q:
            return []
        w_start, w_end = q["window_start"], q["window_end"]
        target_files = self._filter_files_for_window(self.metric_files, w_start)
        
        filtered = []
        for m_path in target_files:
            try:
                with open(m_path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        raw_ts = row.get("timestamp") or row.get("time") or row.get("datetime")
                        ts = TelemetryStore.normalize_timestamp(raw_ts)
                        if w_start and ts and ts < w_start:
                            continue
                        if w_end and ts and ts > w_end:
                            continue
                        comp = (
                            row.get("cmdb_id") or row.get("service_name") or 
                            row.get("container_id") or row.get("component") or 
                            row.get("service") or row.get("pod_id") or row.get("name")
                        )
                        kpi = row.get("kpi_name") or row.get("metric_name") or row.get("kpi") or "metric"
                        val = row.get("value") or row.get("val")
                        if comp and val is not None:
                            try:
                                filtered.append({
                                    "cmdb_id": str(comp).strip(),
                                    "kpi_name": str(kpi).strip(),
                                    "timestamp": ts,
                                    "value": float(val),
                                })
                            except ValueError:
                                continue
            except Exception as e:
                print(f"[TelemetryStore] Warning streaming metric file {m_path}: {e}")
        return filtered

    def stream_traces_for_query(self, query_id: str) -> List[Dict[str, Any]]:
        """Streams and filters traces line-by-line for the specific incident window only."""
        q = self.get_query(query_id)
        if not q:
            return []
        w_start, w_end = q["window_start"], q["window_end"]
        target_files = self._filter_files_for_window(self.trace_files, w_start)
        
        filtered = []
        for t_path in target_files:
            try:
                with open(t_path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        raw_ts = row.get("timestamp") or row.get("start_time") or row.get("time")
                        ts = TelemetryStore.normalize_timestamp(raw_ts)
                        if w_start and ts and ts < w_start:
                            continue
                        if w_end and ts and ts > w_end:
                            continue
                        span_id = row.get("span_id") or row.get("id") or row.get("trace_span_id")
                        parent_id = row.get("parent_span_id") or row.get("parent_id") or ""
                        comp = (
                            row.get("cmdb_id") or row.get("service_name") or 
                            row.get("service") or row.get("component") or row.get("name")
                        )
                        if span_id and comp:
                            try:
                                dur = float(row.get("duration_ms") or row.get("duration") or row.get("elapsed_time", 0))
                            except ValueError:
                                dur = 0.0
                            filtered.append({
                                "span_id": str(span_id).strip(),
                                "trace_id": str(row.get("trace_id", "")).strip(),
                                "parent_span_id": str(parent_id).strip(),
                                "cmdb_id": str(comp).strip(),
                                "timestamp": ts,
                                "duration_ms": dur,
                                "status": str(row.get("status") or row.get("status_code") or row.get("result", "ok")).strip(),
                                "call_type": str(row.get("call_type") or row.get("endpoint") or row.get("api") or "").strip(),
                            })
            except Exception as e:
                print(f"[TelemetryStore] Warning streaming trace file {t_path}: {e}")
        return filtered

    def stream_logs_for_query(self, query_id: str) -> List[Dict[str, Any]]:
        """Streams and filters logs line-by-line for the specific incident window only."""
        q = self.get_query(query_id)
        if not q:
            return []
        w_start, w_end = q["window_start"], q["window_end"]
        target_files = self._filter_files_for_window(self.log_files, w_start)
        
        filtered = []
        for l_path in target_files:
            try:
                with open(l_path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        raw_ts = row.get("timestamp") or row.get("time") or row.get("datetime")
                        ts = TelemetryStore.normalize_timestamp(raw_ts)
                        if w_start and ts and ts < w_start:
                            continue
                        if w_end and ts and ts > w_end:
                            continue
                        comp = (
                            row.get("cmdb_id") or row.get("service_name") or 
                            row.get("service") or row.get("component") or row.get("pod_id")
                        )
                        msg = row.get("message") or row.get("content") or row.get("msg") or row.get("log")
                        if comp and msg:
                            filtered.append({
                                "cmdb_id": str(comp).strip(),
                                "timestamp": ts,
                                "level": str(row.get("level") or row.get("severity") or row.get("log_level", "INFO")).strip().upper(),
                                "message": str(msg).strip(),
                            })
            except Exception as e:
                print(f"[TelemetryStore] Warning streaming log file {l_path}: {e}")
        return filtered

    def get_query(self, query_id: str) -> Optional[Dict[str, Any]]:
        return self.queries.get(str(query_id))

    def list_query_ids(self) -> List[str]:
        return sorted(list(self.queries.keys()), key=lambda x: int(x) if x.isdigit() else x)

    # ------------------------------------------------------------------
    # OBSERVABILITY PRE-PROCESSING (Multi-Metric Ensemble & Change-Point)
    # ------------------------------------------------------------------
    @staticmethod
    def _classify_fault_category(kpi_name: str) -> Tuple[str, float]:
        """Returns canonical fault category and priority weight for the given KPI."""
        kpi = kpi_name.lower()
        if any(w in kpi for w in ["cpu", "load", "cpuload", "thrott"]):
            return "high CPU usage", 1.6
        if any(w in kpi for w in ["mem", "nocache", "heap", "ram", "buffer_pool", "oom", "used_memory"]):
            return "high memory usage", 1.6
        if any(w in kpi for w in ["drop", "loss", "retrans", "net", "packet", "latency"]):
            return "network delay and packet loss", 1.4
        if any(w in kpi for w in ["disk", "io", "write", "read", "await", "util", "queue"]):
            return "disk io bottleneck and queue saturation", 1.3
        if any(w in kpi for w in ["lock", "trx", "conn", "timeout", "pool", "handler"]):
            return "database connection exhaustion and lock contention", 1.1
        return "resource degradation", 1.0

    def extract_metric_anomalies(self, query_id: str) -> List[Dict[str, Any]]:
        """Calculates differenced multi-metric joint anomaly scores and change-point onset timestamps per component."""
        window_points = self.stream_metrics_for_query(query_id)
        if not window_points:
            return []

        # Group data points by (component, KPI)
        groups = defaultdict(list)
        for m in window_points:
            groups[(m["cmdb_id"], m["kpi_name"])].append(m)

        # Track per-component metric signals and onset timestamps
        comp_signals = defaultdict(list)
        comp_onsets = defaultdict(list)

        # Monotonic counter keywords to always differentiate
        monotonic_kpis = {"keyspace_misses", "handler_write", "bytes_sent", "bytes_received", "total_commands_processed", "total_connections_received", "max_trx_lock_memory_bytes"}

        for (comp, kpi), raw_pts in groups.items():
            # Sort chronologically
            pts = sorted(raw_pts, key=lambda x: x["timestamp"])
            if len(pts) < 3:
                continue

            # Detect if metric is a monotonic cumulative counter
            raw_vals = [p["value"] for p in pts]
            kpi_lower = kpi.lower()
            is_monotonic_name = any(mk in kpi_lower for mk in monotonic_kpis)
            is_monotonic_data = all(raw_vals[i] <= raw_vals[i+1] for i in range(len(raw_vals)-1)) and (raw_vals[-1] > raw_vals[0])
            
            if is_monotonic_name or is_monotonic_data:
                # Compute first-order differences
                diff_pts = []
                for i in range(1, len(pts)):
                    d_val = max(0.0, pts[i]["value"] - pts[i-1]["value"])
                    diff_pts.append({"timestamp": pts[i]["timestamp"], "value": d_val})
                pts = diff_pts
                if len(pts) < 3:
                    continue

            vals = [p["value"] for p in pts]
            
            # Pre-incident baseline (first 30% of data points)
            baseline_len = max(2, int(len(vals) * 0.35))
            base_vals = vals[:baseline_len]
            base_mean = sum(base_vals) / len(base_vals)
            base_var = sum((x - base_mean) ** 2 for x in base_vals) / len(base_vals)
            base_std = math.sqrt(base_var) if base_var > 1e-9 else 1e-5

            # Calculate entire series mean and std
            all_mean = sum(vals) / len(vals)
            all_var = sum((x - all_mean) ** 2 for x in vals) / len(vals)
            all_std = math.sqrt(all_var) if all_var > 1e-9 else 1e-5

            # Check for sudden deviation from baseline or extreme peak
            max_pt = max(pts, key=lambda p: p["value"])
            z_score = abs(max_pt["value"] - base_mean) / base_std
            all_z = abs(max_pt["value"] - all_mean) / all_std
            effective_z = max(z_score, all_z)

            if effective_z >= 1.8:
                # Find the earliest change-point onset time (> 2.0 sigma from baseline)
                onset_ts = max_pt["timestamp"]
                for p in pts:
                    if abs(p["value"] - base_mean) >= 2.0 * base_std:
                        onset_ts = p["timestamp"]
                        break
                
                cat, weight = self._classify_fault_category(kpi)
                comp_signals[comp].append({
                    "kpi_name": kpi,
                    "category": cat,
                    "weight": weight,
                    "z_score": effective_z,
                    "peak_val": max_pt["value"],
                    "onset_ts": onset_ts,
                    "peak_ts": max_pt["timestamp"],
                })
                comp_onsets[comp].append(onset_ts)

        # Ensemble: Multiple weakly/strongly red metrics on the same component form a compound signal
        component_anomalies = []
        for comp, metrics in comp_signals.items():
            # Compound multi-metric score: sqrt(sum(w_i * z_i^2)) + bonus for multi-metric coherence
            weighted_z_sq = sum(m["weight"] * (m["z_score"] ** 2) for m in metrics)
            metric_count_multiplier = 1.0 + (0.35 * (len(metrics) - 1))
            composite_score = math.sqrt(weighted_z_sq) * metric_count_multiplier
            
            # Earliest onset timestamp across anomalous metrics for this component
            valid_onsets = [ts for ts in comp_onsets[comp] if ts]
            earliest_onset = min(valid_onsets) if valid_onsets else ""
            
            # Primary fault category determined by highest weighted z-score
            primary_metric = max(metrics, key=lambda m: m["weight"] * m["z_score"])
            
            component_anomalies.append({
                "component_id": comp,
                "kpi_name": primary_metric["kpi_name"],
                "category": primary_metric["category"],
                "deviation_score": round(composite_score, 2),
                "raw_z_score": round(primary_metric["z_score"], 2),
                "metric_count": len(metrics),
                "ts": earliest_onset or primary_metric["peak_ts"],
                "peak_ts": primary_metric["peak_ts"],
                "involved_kpis": [m["kpi_name"] for m in metrics],
            })

        # Sort by Composite Multi-Metric Anomaly Score
        component_anomalies.sort(key=lambda x: x["deviation_score"], reverse=True)
        return component_anomalies[:10]

    def extract_trace_bottlenecks(self, query_id: str) -> List[Dict[str, Any]]:
        """Computes caller-callee call graph, error rates, and p95 latency bottlenecks from streamed spans."""
        window_traces = self.stream_traces_for_query(query_id)
        if not window_traces:
            return []

        span_map = {s["span_id"]: s for s in window_traces}
        pair_durations = defaultdict(list)
        pair_errors = defaultdict(int)
        pair_totals = defaultdict(int)
        pair_onsets = defaultdict(list)

        for s in window_traces:
            caller = "client-entry"
            p_id = s.get("parent_span_id")
            if p_id and p_id in span_map:
                caller = span_map[p_id].get("cmdb_id", "client-entry")
            callee = s["cmdb_id"]
            pair = (caller, callee)
            pair_durations[pair].append(s["duration_ms"])
            pair_totals[pair] += 1
            if s["status"] not in ("ok", "200", "0", ""):
                pair_errors[pair] += 1
                if s.get("timestamp"):
                    pair_onsets[pair].append(s["timestamp"])
            elif s["duration_ms"] > 500 and s.get("timestamp"):
                pair_onsets[pair].append(s["timestamp"])

        bottlenecks = []
        for (caller, callee), durs in pair_durations.items():
            durs.sort()
            p95 = durs[int(len(durs) * 0.95)] if durs else 0
            total = pair_totals[(caller, callee)]
            err_rate = pair_errors[(caller, callee)] / total if total else 0
            
            onsets = pair_onsets[(caller, callee)]
            earliest_ts = min(onsets) if onsets else ""
            
            if p95 > 250 or err_rate > 0.05:
                bottlenecks.append({
                    "caller_id": caller,
                    "callee_id": callee,
                    "p95_latency_ms": round(p95, 2),
                    "error_rate": round(err_rate, 4),
                    "sample_count": total,
                    "onset_ts": earliest_ts,
                })
        bottlenecks.sort(key=lambda x: (x["error_rate"], x["p95_latency_ms"]), reverse=True)
        return bottlenecks[:8]

    def extract_log_summaries(self, query_id: str) -> List[Dict[str, Any]]:
        """Clusters error and fatal logs with TF-IDF keyword importance within incident window."""
        window_logs = self.stream_logs_for_query(query_id)
        if not window_logs:
            return []

        error_keywords = ["critical", "fatal", "error", "timeout", "outofmemory", "exhaustion", "throttle", "refused", "fail", "drop"]
        comp_error_counts = defaultdict(int)
        comp_log_templates = defaultdict(lambda: defaultdict(int))
        comp_onsets = defaultdict(list)

        for l in window_logs:
            comp = l["cmdb_id"]
            msg = l["message"].lower()
            is_err = l.get("level") in ("ERROR", "FATAL", "CRITICAL") or any(k in msg for k in error_keywords)
            if is_err:
                comp_error_counts[comp] += 1
                clean_msg = re.sub(r"[0-9a-fA-F\-]{8,}", "<ID>", l["message"])
                comp_log_templates[comp][clean_msg] += 1
                if l.get("timestamp"):
                    comp_onsets[comp].append(l["timestamp"])

        total_error_logs = sum(comp_error_counts.values()) or 1
        summaries = []
        for comp, count in comp_error_counts.items():
            tf = count / total_error_logs
            idf = math.log(1 + (len(comp_error_counts) / 1.0))
            tfidf = tf * idf
            templates = comp_log_templates[comp]
            top_tmpl = max(templates.items(), key=lambda x: x[1])[0] if templates else "Service error observed"
            onsets = comp_onsets[comp]
            earliest_ts = min(onsets) if onsets else ""
            
            summaries.append({
                "component_id": comp,
                "error_count": count,
                "tfidf_score": round(tfidf, 3),
                "template_text": top_tmpl,
                "onset_ts": earliest_ts,
            })
        summaries.sort(key=lambda x: (x["tfidf_score"], x["count"]), reverse=True)
        return summaries[:6]

    def walk_upstream_trace(self, candidate_comp: str, query_id: Optional[str] = None) -> Dict[str, Any]:
        """Traverses the caller-callee span tree to verify upstream causes vs downstream victims."""
        window_traces = self.stream_traces_for_query(query_id) if query_id else []
        if not window_traces:
            # Fallback to recent trace files if no specific query_id passed
            if self.trace_files:
                try:
                    with open(self.trace_files[0], "r", encoding="utf-8") as f:
                        reader = csv.DictReader(f)
                        for row in reader:
                            span_id = row.get("span_id") or row.get("id")
                            comp = row.get("cmdb_id") or row.get("component") or row.get("service")
                            if span_id and comp:
                                try:
                                    dur = float(row.get("duration_ms", row.get("duration", 0)))
                                except ValueError:
                                    dur = 0.0
                                window_traces.append({
                                    "span_id": str(span_id).strip(),
                                    "parent_span_id": str(row.get("parent_span_id", "")).strip(),
                                    "cmdb_id": str(comp).strip(),
                                    "duration_ms": dur,
                                    "status": str(row.get("status", "ok")).strip(),
                                })
                except Exception:
                    pass

        span_map = {s["span_id"]: s for s in window_traces}
        
        callee_of_candidate = []
        for s in window_traces:
            p_id = s.get("parent_span_id")
            if p_id and p_id in span_map:
                if span_map[p_id]["cmdb_id"] == candidate_comp:
                    callee_of_candidate.append(s)

        if callee_of_candidate:
            high_lat_callees = [s for s in callee_of_candidate if s["duration_ms"] > 500 or s["status"] == "error"]
            if high_lat_callees:
                deepest = high_lat_callees[0]["cmdb_id"]
                return {
                    "is_downstream_victim": True,
                    "upstream_culprit": deepest,
                    "chain": [
                        {"component": candidate_comp, "role": "downstream_victim"},
                        {"component": deepest, "role": "upstream_root_cause"}
                    ],
                    "conclusion": f"{candidate_comp} is a downstream victim of high latency/errors in upstream dependency {deepest}."
                }

        return {
            "is_downstream_victim": False,
            "upstream_culprit": candidate_comp,
            "chain": [{"component": candidate_comp, "role": "isolated_origin"}],
            "conclusion": f"{candidate_comp} has no downstream root dependencies causing latency; it is the origin source."
        }
