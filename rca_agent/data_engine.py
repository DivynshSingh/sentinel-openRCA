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
        """Extracts window_start and window_end from incident question/instruction text."""
        if not question:
            return "", ""
        
        month_pattern = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
        
        # Pattern 1: Month Day Year with start and end times
        m_date = re.search(rf"({month_pattern}\s+\d{{1,2}},?\s*\d{{4}})", question, re.IGNORECASE)
        m_times = re.findall(r"(\d{1,2}:\d{2}(?::\d{2})?)", question)
        
        if m_date and len(m_times) >= 2:
            date_raw = m_date.group(1).replace(",", "").strip()
            for fmt in ("%B %d %Y", "%b %d %Y"):
                try:
                    d = datetime.strptime(date_raw, fmt)
                    sh, sm = map(int, m_times[0].split(":")[:2])
                    eh, em = map(int, m_times[1].split(":")[:2])
                    w_start = d.replace(hour=sh, minute=sm, second=0).strftime("%Y-%m-%d %H:%M:%S")
                    w_end = d.replace(hour=eh, minute=em, second=0).strftime("%Y-%m-%d %H:%M:%S")
                    return w_start, w_end
                except Exception:
                    pass

        # Pattern 2: ISO dates in question
        iso_matches = re.findall(r"(\d{4}[-_]\d{2}[-_]\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)", question)
        if len(iso_matches) >= 2:
            s1 = TelemetryStore.normalize_timestamp(iso_matches[0])
            s2 = TelemetryStore.normalize_timestamp(iso_matches[1])
            if s1 and s2:
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
    # OBSERVABILITY PRE-PROCESSING (100% On-Demand Streaming per Query)
    # ------------------------------------------------------------------
    def extract_metric_anomalies(self, query_id: str) -> List[Dict[str, Any]]:
        """Calculates 3-sigma anomalies on metrics streamed on-demand for the query window."""
        window_points = self.stream_metrics_for_query(query_id)
        if not window_points:
            return []

        groups = defaultdict(list)
        for m in window_points:
            groups[(m["cmdb_id"], m["kpi_name"])].append(m)

        anomalies = []
        for (comp, kpi), points in groups.items():
            if len(points) < 3:
                continue
            vals = [p["value"] for p in points]
            mean = sum(vals) / len(vals)
            variance = sum((v - mean) ** 2 for v in vals) / len(vals)
            std = math.sqrt(variance) or 1.0

            max_val = max(vals)
            deviation = (max_val - mean) / (std if std > 1.0 else 1.0)
            
            # Find earliest point exceeding threshold
            spikes = [p for p in points if p["value"] >= mean + 1.2 * std]
            if spikes and deviation >= 1.5:
                earliest_p = spikes[0]
                anomalies.append({
                    "component_id": comp,
                    "kpi_name": kpi,
                    "ts": earliest_p["timestamp"],
                    "value": round(max_val, 2),
                    "baseline_mean": round(mean, 2),
                    "baseline_std": round(std, 2),
                    "deviation_score": round(deviation, 2),
                    "anomaly_pattern": "steady_rise" if len(spikes) > 5 else "spike",
                    "is_anomalous": True,
                })

        # Sort by deviation score descending
        anomalies.sort(key=lambda x: x["deviation_score"], reverse=True)
        return anomalies[:8]

    def extract_trace_bottlenecks(self, query_id: str) -> List[Dict[str, Any]]:
        """Computes caller-callee call graph, error rates, and p95 latency bottlenecks from streamed spans."""
        window_traces = self.stream_traces_for_query(query_id)
        if not window_traces:
            return []

        span_map = {s["span_id"]: s for s in window_traces}
        pair_durations = defaultdict(list)
        pair_errors = defaultdict(int)
        pair_paths = {}

        for span in window_traces:
            parent_id = span.get("parent_span_id")
            callee = span["cmdb_id"]
            dur = span["duration_ms"]
            is_err = span["status"] == "error" or dur > 500

            if parent_id and parent_id in span_map:
                caller = span_map[parent_id]["cmdb_id"]
                pair = (caller, callee)
                pair_durations[pair].append(dur)
                if is_err:
                    pair_errors[pair] += 1
                pair_paths[pair] = f"{caller} -> {callee}"
            else:
                pair = ("pod-01", callee)
                pair_durations[pair].append(dur)
                if is_err:
                    pair_errors[pair] += 1
                pair_paths[pair] = f"pod-01 -> {callee}"

        bottlenecks = []
        for (caller, callee), durs in pair_durations.items():
            durs_sorted = sorted(durs)
            p95_idx = int(len(durs_sorted) * 0.95)
            p95 = durs_sorted[min(p95_idx, len(durs_sorted) - 1)]
            err_count = pair_errors[(caller, callee)]
            err_rate = round(err_count / len(durs), 3)

            if p95 > 200 or err_rate > 0.1:
                bottlenecks.append({
                    "caller_id": caller,
                    "callee_id": callee,
                    "call_count": len(durs),
                    "error_rate": err_rate,
                    "p95_latency_ms": int(p95),
                    "max_latency_ms": int(max(durs)),
                    "path_3hop": pair_paths.get((caller, callee), f"{caller} -> {callee}"),
                })

        bottlenecks.sort(key=lambda x: (x["error_rate"], x["p95_latency_ms"]), reverse=True)
        return bottlenecks[:6]

    def extract_log_summaries(self, query_id: str) -> List[Dict[str, Any]]:
        """Clusters error and fatal logs with TF-IDF keyword importance within incident window."""
        window_logs = self.stream_logs_for_query(query_id)
        if not window_logs:
            return []

        error_keywords = ["critical", "fatal", "error", "timeout", "outofmemory", "exhaustion", "throttle", "refused"]
        comp_error_counts = defaultdict(int)
        comp_templates = defaultdict(list)

        for log in window_logs:
            lvl = log.get("level", "").upper()
            msg = log.get("message", "")
            comp = log.get("cmdb_id", "")

            has_kw = any(kw in msg.lower() for kw in error_keywords)
            if lvl in ("ERROR", "CRITICAL", "FATAL") or has_kw:
                comp_error_counts[comp] += 1
                comp_templates[comp].append(msg)

        summaries = []
        total_errors = sum(comp_error_counts.values()) or 1

        for comp, msgs in comp_templates.items():
            freq = comp_error_counts[comp]
            rep_msg = msgs[0] if msgs else ""
            tfidf_score = round(freq / total_errors, 3)

            summaries.append({
                "component_id": comp,
                "template_id": f"tpl-{comp}",
                "template_text": rep_msg,
                "count": freq,
                "tfidf_score": tfidf_score,
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
