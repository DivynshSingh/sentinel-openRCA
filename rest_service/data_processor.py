"""OpsAgent-style training-free data processor.

Converts raw heterogeneous observability data into structured textual descriptions
that agents can reason over consistently.

Reference: Jiang et al., "OpsAgent: An Evolving Multi-agent System for Incident 
Management in Microservices", ASE 2026. arXiv:2510.24145
"""
import re
import uuid
import math
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from collections import Counter, defaultdict

import duckdb
import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from .database import get_db, db_cursor


class DataProcessor:
    """Deterministic preprocessing pipeline. No LLM calls."""

    def __init__(
        self,
        metric_sigma: float = 3.0,
        trace_latency_pct: float = 95.0,
        log_keywords: Optional[List[str]] = None,
        log_tfidf_pctile: float = 80.0,
        trace_window_seconds: int = 60,
        top_k_pods: int = 5,
        top_k_metrics: int = 5,
    ):
        self.metric_sigma = metric_sigma
        self.trace_latency_pct = trace_latency_pct
        self.log_keywords = log_keywords or ["fatal", "error", "crash", "fail", "timeout", "refused", "exception", "denied"]
        self.log_tfidf_pctile = log_tfidf_pctile
        self.trace_window_seconds = trace_window_seconds
        self.top_k_pods = top_k_pods
        self.top_k_metrics = top_k_metrics

    # ------------------------------------------------------------------
    # METRICS
    # ------------------------------------------------------------------

    def _detect_anomalies_3sigma(self, df: pd.DataFrame) -> pd.DataFrame:
        """Flag anomalies using 3-sigma rule within each (component, metric) group."""
        results = []
        for (comp, metric), group in df.groupby(["component_id", "kpi_name"]):
            group = group.sort_values("ts").reset_index(drop=True)
            if len(group) < 3:
                continue

            mu = group["value"].mean()
            sigma = group["value"].std()
            if sigma == 0 or pd.isna(sigma):
                continue

            group["deviation_score"] = (group["value"] - mu).abs() / sigma
            group["is_anomalous"] = group["deviation_score"] > self.metric_sigma
            results.append(group)

        if not results:
            return pd.DataFrame(columns=df.columns.tolist() + ["deviation_score", "is_anomalous"])
        return pd.concat(results, ignore_index=True)

    def _classify_shape(self, series: pd.Series, anomaly_mask: pd.Series) -> str:
        """Heuristic shape classification for a single anomaly point.

        Since we don't have the pre-trained CNN from OpsAgent, we use:
        - spike: anomaly point surrounded by non-anomalous points
        - steady_rise: 3+ consecutive anomalous points with increasing values
        - level_shift: 3+ consecutive anomalous points at sustained new level
        """
        anom_idx = anomaly_mask[anomaly_mask].index.tolist()
        if not anom_idx:
            return "unknown"

        # Check for spike (isolated anomaly)
        for idx in anom_idx:
            neighbors = []
            if idx - 1 >= 0:
                neighbors.append(anomaly_mask.iloc[idx - 1])
            if idx + 1 < len(series):
                neighbors.append(anomaly_mask.iloc[idx + 1])
            if neighbors and not any(neighbors):
                return "spike"

        # Check for consecutive anomalies
        consecutive = []
        current = [anom_idx[0]]
        for i in range(1, len(anom_idx)):
            if anom_idx[i] == anom_idx[i-1] + 1:
                current.append(anom_idx[i])
            else:
                consecutive.append(current)
                current = [anom_idx[i]]
        consecutive.append(current)

        for run in consecutive:
            if len(run) >= 3:
                vals = series.iloc[run].values
                # steady rise: monotonically increasing
                if all(vals[i] < vals[i+1] for i in range(len(vals)-1)):
                    return "steady_rise"
                # level shift: values stay at similar elevated level
                if np.std(vals) < np.std(series) * 0.3:
                    return "level_shift"

        return "spike"  # default

    def process_metrics(self, query_id: str, window_start: datetime, window_end: datetime) -> pd.DataFrame:
        """Process metrics for a query window. Returns METRIC_ANOMALY rows."""
        conn = get_db()

        # 1. Fetch raw metrics in window
        df = conn.execute("""
            SELECT id, component_id, kpi_name, ts, value
            FROM metric_point
            WHERE ts >= ? AND ts <= ?
            ORDER BY component_id, kpi_name, ts
        """, [window_start, window_end]).fetchdf()

        if df.empty:
            return pd.DataFrame()

        # 2. Anomaly detection
        df = self._detect_anomalies_3sigma(df)
        anomalies = df[df["is_anomalous"]].copy()
        if anomalies.empty:
            return pd.DataFrame()

        # 3. Shape classification (per anomaly point)
        shapes = []
        for _, row in anomalies.iterrows():
            comp_metric = df[(df["component_id"] == row["component_id"]) & (df["kpi_name"] == row["kpi_name"])]
            shape = self._classify_shape(comp_metric["value"], comp_metric["is_anomalous"])
            shapes.append(shape)
        anomalies["anomaly_pattern"] = shapes

        # 4. Top-K aggregation
        # Aggregate deviation scores per component
        comp_scores = anomalies.groupby("component_id")["deviation_score"].sum().sort_values(ascending=False)
        top_components = comp_scores.head(self.top_k_pods).index.tolist()

        # Aggregate per metric per top component
        metric_scores = anomalies[anomalies["component_id"].isin(top_components)]
        metric_scores = metric_scores.groupby(["component_id", "kpi_name"])["deviation_score"].sum().reset_index()
        metric_scores = metric_scores.sort_values(["component_id", "deviation_score"], ascending=[True, False])

        # Keep top metrics per component
        keep_metrics = set()
        for comp in top_components:
            comp_metrics = metric_scores[metric_scores["component_id"] == comp].head(self.top_k_metrics)
            keep_metrics.update(comp_metrics["kpi_name"].tolist())

        # Filter anomalies to top components + top metrics
        anomalies = anomalies[
            anomalies["component_id"].isin(top_components) &
            anomalies["kpi_name"].isin(keep_metrics)
        ].copy()

        # 5. Build output
        anomalies["query_id"] = query_id
        anomalies["id"] = [f"ma-{uuid.uuid4().hex[:8]}" for _ in range(len(anomalies))]

        output = anomalies[["id", "query_id", "component_id", "kpi_name", "anomaly_pattern", "ts", "deviation_score"]]
        output.columns = ["id", "query_id", "component_id", "metric_name", "anomaly_pattern", "ts", "deviation_score"]

        return output

    # ------------------------------------------------------------------
    # TRACES
    # ------------------------------------------------------------------

    def process_traces(self, query_id: str, window_start: datetime, window_end: datetime) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Process traces for a query window. Returns (TRACE_SUMMARY, TRACE_PATH) rows."""
        conn = get_db()

        # 1. Fetch raw spans in window
        df = conn.execute("""
            SELECT span_id, trace_id, parent_span_id, component_id, start_time, duration_ms, status, call_type
            FROM span
            WHERE start_time >= ? AND start_time <= ?
            ORDER BY start_time
        """, [window_start, window_end]).fetchdf()

        if df.empty:
            return pd.DataFrame(), pd.DataFrame()

        # 2. Per-call-type latency threshold (95th percentile)
        call_type_thresholds = df.groupby("call_type")["duration_ms"].quantile(self.trace_latency_pct / 100.0).to_dict()

        # Mark high-latency spans
        def is_high_latency(row):
            ct = row["call_type"]
            if pd.isna(ct) or ct not in call_type_thresholds:
                return False
            return row["duration_ms"] > call_type_thresholds[ct]

        df["is_high_latency"] = df.apply(is_high_latency, axis=1)
        high_latency = df[df["is_high_latency"]].copy()

        if high_latency.empty:
            return pd.DataFrame(), pd.DataFrame()

        # 3. Group by time window + callee
        high_latency["window_start"] = high_latency["start_time"].dt.floor(f"{self.trace_window_seconds}S")

        summaries = []
        for (window, callee), group in high_latency.groupby(["window_start", "component_id"]):
            callers = group["parent_span_id"].dropna().tolist()
            # Map parent_span_id to component_id
            caller_components = []
            for pid in callers:
                caller_row = df[df["span_id"] == pid]
                if not caller_row.empty:
                    caller_components.append(caller_row.iloc[0]["component_id"])

            caller_dist = dict(Counter(caller_components))
            summaries.append({
                "id": f"ts-{uuid.uuid4().hex[:8]}",
                "query_id": query_id,
                "callee_id": callee,
                "window_start": window,
                "window_end": window + timedelta(seconds=self.trace_window_seconds),
                "total_calls": len(group),
                "max_latency_ms": int(group["duration_ms"].max()),
                "caller_distribution": caller_dist,
            })

        summary_df = pd.DataFrame(summaries)

        # 4. Extract 3-hop call paths from high-latency spans
        # Build span lookup
        span_lookup = df.set_index("span_id").to_dict("index")

        paths = []
        path_counter = Counter()

        for _, span in high_latency.iterrows():
            span_id = span["span_id"]
            callee = span["component_id"]

            # Walk up to find caller
            caller_id = None
            grandparent_id = None

            parent_id = span.get("parent_span_id")
            if parent_id and parent_id in span_lookup:
                caller_id = span_lookup[parent_id]["component_id"]
                grandparent = span_lookup[parent_id].get("parent_span_id")
                if grandparent and grandparent in span_lookup:
                    grandparent_id = span_lookup[grandparent]["component_id"]

            path_key = (grandparent_id, caller_id, callee)
            path_counter[path_key] += 1

        for (gp, caller, callee), freq in path_counter.items():
            paths.append({
                "id": f"tp-{uuid.uuid4().hex[:8]}",
                "query_id": query_id,
                "grandparent_id": gp,
                "caller_id": caller or "root",
                "callee_id": callee,
                "frequency": freq,
                "is_high_latency": True,
            })

        path_df = pd.DataFrame(paths)
        return summary_df, path_df

    # ------------------------------------------------------------------
    # LOGS
    # ------------------------------------------------------------------

    def _extract_template(self, message: str) -> Tuple[str, str]:
        """Simple Drain-like template extraction.

        Replaces variable parts (numbers, IPs, UUIDs, paths) with placeholders.
        Returns (template_id, template_text).
        """
        # Replace common variable patterns
        text = message
        text = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "<UUID>", text, flags=re.I)
        text = re.sub(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "<IP>", text)
        text = re.sub(r"\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?\b", "<TIMESTAMP>", text)
        text = re.sub(r"\b0x[0-9a-f]+\b", "<HEX>", text, flags=re.I)
        text = re.sub(r"\b\d+\b", "<NUM>", text)
        text = re.sub(r"[/\][^\s]+[/\][^\s]*", "<PATH>", text)

        # Generate template ID from normalized text
        template_id = f"tpl-{hash(text) & 0xFFFFFFFF:08x}"
        return template_id, text

    def process_logs(self, query_id: str, window_start: datetime, window_end: datetime) -> pd.DataFrame:
        """Process logs for a query window. Returns LOG_SUMMARY rows."""
        conn = get_db()

        # 1. Fetch raw logs in window
        df = conn.execute("""
            SELECT id, component_id, ts, level, message
            FROM log_entry
            WHERE ts >= ? AND ts <= ?
            ORDER BY ts
        """, [window_start, window_end]).fetchdf()

        if df.empty:
            return pd.DataFrame()

        # 2. Keyword filtering
        pattern = re.compile(r"(?i)(" + "|".join(self.log_keywords) + r")")
        df["has_keyword"] = df["message"].str.contains(pattern, na=False)
        filtered = df[df["has_keyword"]].copy()

        if filtered.empty:
            return pd.DataFrame()

        # 3. Template parsing
        templates = filtered["message"].apply(self._extract_template)
        filtered["template_id"] = [t[0] for t in templates]
        filtered["template_text"] = [t[1] for t in templates]

        # 4. TF-IDF scoring per template
        # Group by component + template, get earliest occurrence
        template_groups = filtered.groupby(["component_id", "template_id", "template_text", "level"]).agg({
            "ts": "min",
            "id": "count"
        }).reset_index()
        template_groups.columns = ["component_id", "template_id", "template_text", "level", "earliest_ts", "count"]

        # Simple TF-IDF: treat each component as a "document" of template texts
        component_docs = filtered.groupby("component_id")["template_text"].apply(lambda x: " ".join(x)).to_dict()

        if len(component_docs) > 1:
            vectorizer = TfidfVectorizer(max_features=1000, stop_words="english")
            doc_names = list(component_docs.keys())
            doc_texts = [component_docs[n] for n in doc_names]
            tfidf_matrix = vectorizer.fit_transform(doc_texts)

            # For each template, compute max TF-IDF score across components
            feature_names = vectorizer.get_feature_names_out()
            template_scores = {}
            for template_id, template_text in zip(template_groups["template_id"], template_groups["template_text"]):
                words = template_text.lower().split()
                max_score = 0.0
                for word in words:
                    if word in vectorizer.vocabulary_:
                        idx = vectorizer.vocabulary_[word]
                        score = tfidf_matrix[:, idx].max()
                        max_score = max(max_score, score)
                template_scores[template_id] = max_score
        else:
            # Only one component — use raw frequency as proxy
            template_scores = {tid: 1.0 for tid in template_groups["template_id"]}

        template_groups["tfidf_score"] = template_groups["template_id"].map(template_scores)

        # 5. Priority sorting — keep top percentile
        threshold = np.percentile(template_groups["tfidf_score"], self.log_tfidf_pctile)
        template_groups = template_groups[template_groups["tfidf_score"] >= threshold].copy()

        # Rank within query window
        template_groups = template_groups.sort_values("tfidf_score", ascending=False)
        template_groups["rank_pct"] = (template_groups["tfidf_score"].rank(ascending=False) / len(template_groups) * 100).astype(int)

        # 6. Deduplicate: same template within 1-minute window → keep earliest
        # (simplified: just keep earliest per component+template)
        template_groups = template_groups.sort_values("earliest_ts")
        template_groups = template_groups.drop_duplicates(subset=["component_id", "template_id"], keep="first")

        # 7. Build output
        template_groups["query_id"] = query_id
        template_groups["id"] = [f"ls-{uuid.uuid4().hex[:8]}" for _ in range(len(template_groups))]

        output = template_groups[["id", "query_id", "component_id", "template_id", "template_text", 
                                   "tfidf_score", "rank_pct", "earliest_ts", "level"]]
        return output

    # ------------------------------------------------------------------
    # MAIN ENTRY
    # ------------------------------------------------------------------

    def process_query(self, query_id: str, force: bool = False) -> Dict[str, Any]:
        """Run full preprocessing pipeline for a query. Idempotent."""
        conn = get_db()

        # Check if already processed
        if not force:
            check = conn.execute(
                "SELECT COUNT(*) FROM metric_anomaly WHERE query_id = ?",
                [query_id]
            ).fetchone()[0]
            if check > 0:
                return {"status": "skipped", "reason": "already_processed", "query_id": query_id}

        # Get query window
        row = conn.execute(
            "SELECT window_start, window_end FROM query WHERE query_id = ?",
            [query_id]
        ).fetchone()
        if row is None:
            return {"status": "error", "reason": "query_not_found", "query_id": query_id}

        window_start, window_end = row

        # Clear old processed data if forcing
        if force:
            for tbl in ["metric_anomaly", "trace_summary", "trace_path", "log_summary"]:
                conn.execute(f"DELETE FROM {tbl} WHERE query_id = ?", [query_id])

        # Process metrics
        ma_df = self.process_metrics(query_id, window_start, window_end)
        if not ma_df.empty:
            conn.register("ma_df", ma_df)
            conn.execute("INSERT INTO metric_anomaly SELECT * FROM ma_df")

        # Process traces
        ts_df, tp_df = self.process_traces(query_id, window_start, window_end)
        if not ts_df.empty:
            conn.register("ts_df", ts_df)
            conn.execute("INSERT INTO trace_summary SELECT * FROM ts_df")
        if not tp_df.empty:
            conn.register("tp_df", tp_df)
            conn.execute("INSERT INTO trace_path SELECT * FROM tp_df")

        # Process logs
        ls_df = self.process_logs(query_id, window_start, window_end)
        if not ls_df.empty:
            conn.register("ls_df", ls_df)
            conn.execute("INSERT INTO log_summary SELECT * FROM ls_df")

        return {
            "status": "success",
            "query_id": query_id,
            "metric_anomalies": len(ma_df),
            "trace_summaries": len(ts_df),
            "trace_paths": len(tp_df),
            "log_summaries": len(ls_df),
        }
