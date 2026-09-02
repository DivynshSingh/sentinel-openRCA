import { db } from './db.js';
import { MetricAnomaly, TraceSummary, TracePath, LogSummary, MetricPoint, Span, LogEntry } from './types.js';

export interface DataProcessorConfig {
  metricSigma: number;
  traceLatencyPct: number;
  logKeywords: string[];
  logTfidfPctile: number;
  traceWindowSeconds: number;
  topKPods: number;
  topKMetrics: number;
}

export const defaultConfig: DataProcessorConfig = {
  metricSigma: 3.0,
  traceLatencyPct: 95.0,
  logKeywords: ['fatal', 'error', 'crash', 'fail', 'timeout', 'refused', 'exception', 'denied', 'critical', 'throttled', 'outofmemory'],
  logTfidfPctile: 80.0,
  traceWindowSeconds: 60,
  topKPods: 5,
  topKMetrics: 5,
};

export class DataProcessor {
  config: DataProcessorConfig;

  constructor(config: Partial<DataProcessorConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  // ------------------------------------------------------------------
  // 1. METRICS: 3-Sigma Anomaly Detection & Shape Classification
  // ------------------------------------------------------------------
  processMetrics(queryId: string, windowStart: string, windowEnd: string): MetricAnomaly[] {
    const startMs = new Date(windowStart).getTime();
    const endMs = new Date(windowEnd).getTime();

    // 1. Filter metrics in window
    const inWindow: MetricPoint[] = [];
    db.metricPoints.forEach((mp) => {
      const tsMs = new Date(mp.ts).getTime();
      if (tsMs >= startMs && tsMs <= endMs) {
        inWindow.push(mp);
      }
    });

    if (inWindow.length === 0) return [];

    // 2. Group by (component_id, kpi_name)
    const groups: Map<string, MetricPoint[]> = new Map();
    inWindow.forEach((pt) => {
      const key = `${pt.component_id}::${pt.kpi_name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(pt);
    });

    const detectedAnomalies: {
      point: MetricPoint;
      deviationScore: number;
      pattern: 'spike' | 'steady_rise' | 'level_shift' | 'unknown';
    }[] = [];

    groups.forEach((points) => {
      if (points.length < 3) return;

      // Sort by timestamp
      points.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      // Mean & Std Dev
      const values = points.map((p) => p.value);
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
      const sigma = Math.sqrt(variance);

      if (sigma <= 0.00001 || isNaN(sigma)) return;

      const isAnomArray = points.map((p) => {
        const dev = Math.abs(p.value - mean) / sigma;
        return dev > this.config.metricSigma;
      });

      points.forEach((p, idx) => {
        const dev = Math.abs(p.value - mean) / sigma;
        if (dev > this.config.metricSigma) {
          // Shape classification
          let pattern: 'spike' | 'steady_rise' | 'level_shift' = 'spike';

          // Check consecutive anomalies
          let runLength = 1;
          let isMonotonic = true;
          for (let r = idx + 1; r < points.length && isAnomArray[r]; r++) {
            runLength++;
            if (points[r].value <= points[r - 1].value) {
              isMonotonic = false;
            }
          }
          for (let r = idx - 1; r >= 0 && isAnomArray[r]; r--) {
            runLength++;
            if (points[r].value >= points[r + 1].value) {
              isMonotonic = false;
            }
          }

          if (runLength >= 3) {
            pattern = isMonotonic ? 'steady_rise' : 'level_shift';
          } else {
            pattern = 'spike';
          }

          detectedAnomalies.push({
            point: p,
            deviationScore: parseFloat(dev.toFixed(2)),
            pattern,
          });
        }
      });
    });

    if (detectedAnomalies.length === 0) return [];

    // 3. Top-K Pods aggregation
    const podScores: Map<string, number> = new Map();
    detectedAnomalies.forEach(({ point, deviationScore }) => {
      podScores.set(point.component_id, (podScores.get(point.component_id) || 0) + deviationScore);
    });

    const sortedPods = Array.from(podScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.topKPods)
      .map(([pod]) => pod);

    // Top-K metrics per top pod
    const podMetricScores: Map<string, Map<string, number>> = new Map();
    detectedAnomalies.forEach(({ point, deviationScore }) => {
      if (!sortedPods.includes(point.component_id)) return;
      if (!podMetricScores.has(point.component_id)) {
        podMetricScores.set(point.component_id, new Map());
      }
      const mScores = podMetricScores.get(point.component_id)!;
      mScores.set(point.kpi_name, (mScores.get(point.kpi_name) || 0) + deviationScore);
    });

    const allowedPodMetrics: Set<string> = new Set();
    sortedPods.forEach((pod) => {
      const mScores = podMetricScores.get(pod);
      if (mScores) {
        const topMetrics = Array.from(mScores.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, this.config.topKMetrics)
          .map(([metric]) => metric);
        topMetrics.forEach((m) => allowedPodMetrics.add(`${pod}::${m}`));
      }
    });

    // 4. Build output
    const output: MetricAnomaly[] = [];
    detectedAnomalies.forEach(({ point, deviationScore, pattern }, i) => {
      if (allowedPodMetrics.has(`${point.component_id}::${point.kpi_name}`)) {
        output.push({
          id: `ma-${Math.random().toString(36).substring(2, 9)}`,
          query_id: queryId,
          component_id: point.component_id,
          metric_name: point.kpi_name,
          anomaly_pattern: pattern,
          ts: point.ts,
          deviation_score: deviationScore,
        });
      }
    });

    return output;
  }

  // ------------------------------------------------------------------
  // 2. TRACES: Latency Thresholding, Window Summaries & 3-Hop Paths
  // ------------------------------------------------------------------
  processTraces(
    queryId: string,
    windowStart: string,
    windowEnd: string
  ): { summaries: TraceSummary[]; paths: TracePath[] } {
    const startMs = new Date(windowStart).getTime();
    const endMs = new Date(windowEnd).getTime();

    const inWindow: Span[] = [];
    db.spans.forEach((span) => {
      const sMs = new Date(span.start_time).getTime();
      if (sMs >= startMs && sMs <= endMs) {
        inWindow.push(span);
      }
    });

    if (inWindow.length === 0) return { summaries: [], paths: [] };

    // 1. Calculate per-call-type 95th percentile latency threshold
    const callTypeDurations: Map<string, number[]> = new Map();
    inWindow.forEach((s) => {
      const ct = s.call_type || 'default';
      if (!callTypeDurations.has(ct)) callTypeDurations.set(ct, []);
      callTypeDurations.get(ct)!.push(s.duration_ms);
    });

    const callTypeThresholds: Map<string, number> = new Map();
    callTypeDurations.forEach((durations, ct) => {
      durations.sort((a, b) => a - b);
      const idx = Math.min(
        durations.length - 1,
        Math.floor((durations.length * this.config.traceLatencyPct) / 100)
      );
      callTypeThresholds.set(ct, durations[idx]);
    });

    // Mark high-latency spans
    const highLatencySpans = inWindow.filter((s) => {
      const ct = s.call_type || 'default';
      const threshold = callTypeThresholds.get(ct) ?? 200;
      return s.duration_ms >= threshold || s.status === 'error';
    });

    if (highLatencySpans.length === 0) return { summaries: [], paths: [] };

    // 2. Window Aggregation (60s buckets by callee_id)
    const windowBucketMs = this.config.traceWindowSeconds * 1000;
    const bucketMap: Map<string, Span[]> = new Map();

    highLatencySpans.forEach((span) => {
      const sMs = new Date(span.start_time).getTime();
      const bucketStartMs = Math.floor(sMs / windowBucketMs) * windowBucketMs;
      const key = `${bucketStartMs}::${span.component_id}`;
      if (!bucketMap.has(key)) bucketMap.set(key, []);
      bucketMap.get(key)!.push(span);
    });

    const spanMap = new Map<string, Span>();
    inWindow.forEach((s) => spanMap.set(s.span_id, s));

    const summaries: TraceSummary[] = [];
    bucketMap.forEach((spansInBucket, key) => {
      const [bucketStartMsStr, calleeId] = key.split('::');
      const bStartMs = parseInt(bucketStartMsStr, 10);
      const bEndMs = bStartMs + windowBucketMs;

      const callerDist: Record<string, number> = {};
      let maxLatency = 0;

      spansInBucket.forEach((s) => {
        if (s.duration_ms > maxLatency) maxLatency = s.duration_ms;
        if (s.parent_span_id && spanMap.has(s.parent_span_id)) {
          const callerComp = spanMap.get(s.parent_span_id)!.component_id;
          callerDist[callerComp] = (callerDist[callerComp] || 0) + 1;
        } else {
          callerDist['client/ingress'] = (callerDist['client/ingress'] || 0) + 1;
        }
      });

      summaries.push({
        id: `ts-${Math.random().toString(36).substring(2, 9)}`,
        query_id: queryId,
        callee_id: calleeId,
        window_start: new Date(bStartMs).toISOString(),
        window_end: new Date(bEndMs).toISOString(),
        total_calls: spansInBucket.length,
        max_latency_ms: maxLatency,
        caller_distribution: callerDist,
      });
    });

    // 3. Extract 3-Hop Paths: (grandparent -> caller -> callee)
    const pathCounters: Map<string, { gp: string | null; caller: string; callee: string; count: number }> = new Map();

    highLatencySpans.forEach((span) => {
      const callee = span.component_id;
      let caller = 'root';
      let grandparent: string | null = null;

      if (span.parent_span_id && spanMap.has(span.parent_span_id)) {
        const parentSpan = spanMap.get(span.parent_span_id)!;
        caller = parentSpan.component_id;
        if (parentSpan.parent_span_id && spanMap.has(parentSpan.parent_span_id)) {
          grandparent = spanMap.get(parentSpan.parent_span_id)!.component_id;
        }
      }

      const pKey = `${grandparent ?? 'none'}->${caller}->${callee}`;
      if (!pathCounters.has(pKey)) {
        pathCounters.set(pKey, { gp: grandparent, caller, callee, count: 0 });
      }
      pathCounters.get(pKey)!.count++;
    });

    const paths: TracePath[] = Array.from(pathCounters.values()).map((p) => ({
      id: `tp-${Math.random().toString(36).substring(2, 9)}`,
      query_id: queryId,
      grandparent_id: p.gp,
      caller_id: p.caller,
      callee_id: p.callee,
      frequency: p.count,
      is_high_latency: true,
    }));

    return { summaries, paths };
  }

  // ------------------------------------------------------------------
  // 3. LOGS: Drain Template Extraction & TF-IDF Ranking
  // ------------------------------------------------------------------
  private extractTemplate(message: string): { template_id: string; template_text: string } {
    let text = message || '';
    text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>');
    text = text.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<IP>');
    text = text.replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<TIMESTAMP>');
    text = text.replace(/\b0x[0-9a-f]+\b/gi, '<HEX>');
    text = text.replace(/\b\d+\b/g, '<NUM>');
    text = text.replace(/[/\][^\s]+[/\][^\s]*/g, '<PATH>');

    // Generate simple hash ID
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    const template_id = `tpl-${Math.abs(hash).toString(16).padStart(8, '0')}`;
    return { template_id, template_text: text };
  }

  processLogs(queryId: string, windowStart: string, windowEnd: string): LogSummary[] {
    const startMs = new Date(windowStart).getTime();
    const endMs = new Date(windowEnd).getTime();

    const inWindow: LogEntry[] = [];
    db.logEntries.forEach((entry) => {
      const eMs = new Date(entry.ts).getTime();
      if (eMs >= startMs && eMs <= endMs) {
        inWindow.push(entry);
      }
    });

    if (inWindow.length === 0) return [];

    // 1. Keyword Filtering
    const keywordRegex = new RegExp(`(${this.config.logKeywords.join('|')})`, 'i');
    const filtered = inWindow.filter((l) => keywordRegex.test(l.message) || l.level === 'ERROR' || l.level === 'CRITICAL');

    if (filtered.length === 0) return [];

    // 2. Template Extraction
    const parsedLogs = filtered.map((l) => {
      const tpl = this.extractTemplate(l.message);
      return { ...l, ...tpl };
    });

    // 3. Group by Component & Template
    const templateGroups: Map<
      string,
      {
        component_id: string;
        template_id: string;
        template_text: string;
        level: string;
        earliest_ts: string;
        count: number;
      }
    > = new Map();

    parsedLogs.forEach((pl) => {
      const gKey = `${pl.component_id}::${pl.template_id}`;
      if (!templateGroups.has(gKey)) {
        templateGroups.set(gKey, {
          component_id: pl.component_id,
          template_id: pl.template_id,
          template_text: pl.template_text,
          level: pl.level,
          earliest_ts: pl.ts,
          count: 1,
        });
      } else {
        const cur = templateGroups.get(gKey)!;
        cur.count++;
        if (new Date(pl.ts).getTime() < new Date(cur.earliest_ts).getTime()) {
          cur.earliest_ts = pl.ts;
        }
      }
    });

    const groupsList = Array.from(templateGroups.values());

    // 4. TF-IDF Calculation (treating each component as a document)
    const componentDocs: Map<string, string[]> = new Map();
    parsedLogs.forEach((l) => {
      if (!componentDocs.has(l.component_id)) componentDocs.set(l.component_id, []);
      const text = (l.template_text || l.message || '');
      const words = text.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
      componentDocs.get(l.component_id)!.push(...words);
    });

    const totalDocs = componentDocs.size || 1;
    const wordDocCounts: Map<string, number> = new Map();

    componentDocs.forEach((words) => {
      const uniqueWordsInDoc = new Set(words);
      uniqueWordsInDoc.forEach((w) => {
        wordDocCounts.set(w, (wordDocCounts.get(w) || 0) + 1);
      });
    });

    // Calculate score for each template
    const scoredList = groupsList.map((g) => {
      const text = (g.template_text || '');
      const words = text.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
      let maxScore = 0.5;

      words.forEach((w) => {
        const docCount = wordDocCounts.get(w) || 1;
        const idf = Math.log((totalDocs + 1) / docCount);
        const tf = g.count;
        const score = tf * idf;
        if (score > maxScore) maxScore = score;
      });

      return {
        ...g,
        tfidf_score: parseFloat(maxScore.toFixed(3)),
      };
    });

    // 5. Rank and filter top percentiles
    scoredList.sort((a, b) => b.tfidf_score - a.tfidf_score);

    const summaries: LogSummary[] = scoredList.map((s, idx) => {
      const rankPct = Math.round(((idx + 1) / scoredList.length) * 100);
      return {
        id: `ls-${Math.random().toString(36).substring(2, 9)}`,
        query_id: queryId,
        component_id: s.component_id,
        template_id: s.template_id,
        template_text: s.template_text,
        tfidf_score: s.tfidf_score,
        rank_pct: rankPct,
        earliest_ts: s.earliest_ts,
        level: s.level,
      };
    });

    return summaries;
  }

  // ------------------------------------------------------------------
  // Full Query Preprocessing Pipeline (Idempotent)
  // ------------------------------------------------------------------
  processQuery(queryId: string, force = false): {
    status: 'success' | 'skipped' | 'error';
    query_id: string;
    reason?: string;
    metric_anomalies: number;
    trace_summaries: number;
    trace_paths: number;
    log_summaries: number;
  } {
    const q = db.queries.get(queryId);
    if (!q) {
      return {
        status: 'error',
        query_id: queryId,
        reason: 'query_not_found',
        metric_anomalies: 0,
        trace_summaries: 0,
        trace_paths: 0,
        log_summaries: 0,
      };
    }

    if (!force) {
      // Check if anomalies already computed
      let existingCount = 0;
      db.metricAnomalies.forEach((ma) => {
        if (ma.query_id === queryId) existingCount++;
      });
      if (existingCount > 0) {
        return {
          status: 'skipped',
          query_id: queryId,
          reason: 'already_processed',
          metric_anomalies: existingCount,
          trace_summaries: 0,
          trace_paths: 0,
          log_summaries: 0,
        };
      }
    }

    // Clear old processed data
    const toDeleteMA: string[] = [];
    db.metricAnomalies.forEach((v, k) => { if (v.query_id === queryId) toDeleteMA.push(k); });
    toDeleteMA.forEach((k) => db.metricAnomalies.delete(k));

    const toDeleteTS: string[] = [];
    db.traceSummaries.forEach((v, k) => { if (v.query_id === queryId) toDeleteTS.push(k); });
    toDeleteTS.forEach((k) => db.traceSummaries.delete(k));

    const toDeleteTP: string[] = [];
    db.tracePaths.forEach((v, k) => { if (v.query_id === queryId) toDeleteTP.push(k); });
    toDeleteTP.forEach((k) => db.tracePaths.delete(k));

    const toDeleteLS: string[] = [];
    db.logSummaries.forEach((v, k) => { if (v.query_id === queryId) toDeleteLS.push(k); });
    toDeleteLS.forEach((k) => db.logSummaries.delete(k));

    // Run Preprocessing
    const maList = this.processMetrics(queryId, q.window_start, q.window_end);
    maList.forEach((ma) => db.metricAnomalies.set(ma.id, ma));

    const { summaries: tsList, paths: tpList } = this.processTraces(queryId, q.window_start, q.window_end);
    tsList.forEach((ts) => db.traceSummaries.set(ts.id, ts));
    tpList.forEach((tp) => db.tracePaths.set(tp.id, tp));

    const lsList = this.processLogs(queryId, q.window_start, q.window_end);
    lsList.forEach((ls) => db.logSummaries.set(ls.id, ls));

    q.status = 'processing';

    return {
      status: 'success',
      query_id: queryId,
      metric_anomalies: maList.length,
      trace_summaries: tsList.length,
      trace_paths: tpList.length,
      log_summaries: lsList.length,
    };
  }
}

export const defaultProcessor = new DataProcessor();
