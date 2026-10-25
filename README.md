# Sentinel - Agentic RCA System

An agent for root cause analysis on the [OpenRCA benchmark](https://github.com/microsoft/OpenRCA) (ICLR 2025). Built with FastAPI, DuckDB, MCP, and LangGraph.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Phase 0          Phase 1 (Parallel)         Phase 2      Phase 3   Phase 4 │
│  ┌────────┐      ┌─────────┬─────────┬─────────┐      ┌────────┐  ┌──────┐ │
│  │ Data   │      │ When    │ What    │ Why     │      │ Hypo   │  │ Final│ │
│  │ Proc.  │ ──►  │ Agent   │ Agent   │ Agent   │ ──►  │ Gen    │  │ izer │ │
│  │(no LLM)│      │(metrics)│(traces) │(causal) │      │        │  │      │ │
│  └────────┘      └─────────┴─────────┴─────────┘      └───┬────┘  └──────┘ │
│                                                            │               │
│                                                            ▼               │
│                                                      ┌──────────┐          │
│                                                      │  Critic  │          │
│                                                      │(skeptic) │          │
│                                                      └────┬─────┘          │
│                                                           │                │
│                                                           └──── loop ──────┘
│                                                                  (max 3x)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

1. **Data Processor runs before any LLM** - 3-sigma anomaly detection, shape classification, trace latency thresholding, log TF-IDF ranking. This is the single biggest accuracy lever (removing it drops Correctness from 16.5% → 2.3%).
2. **3 parallel agents by task** (When/What/Why) Each reasons over the same pre-processed evidence.
3. **Hypothesis Generator ↔ Critic loop** — the critic is a separate node with destructive persona, checking 5 anti-failure-modes (salience capture, premature commitment, presence bias, timeline consistency, causal validity).
4. **Topology inferred from traces** — for Bank data in OpenRCA benchmark, no explicit dependency graph exists. `walk_upstream_trace` walks `parent_span_id` chains deterministically.

## Quick Start

### 1. Install dependencies

```bash
cd sentinel
pip install -r requirements.txt
```

### 2. Generate sample data

```bash
python sample_data/generate_sample.py --output ./data/Bank
```

This creates synthetic OpenRCA-shaped data with an injected fault (`pod-07` at 18:12).

### 3. Start the REST service

```bash
python -m rest_service.main
# → http://localhost:8000
```

The service will:
- Initialize DuckDB schema (`./data/sentinel.duckdb`)
- Auto-load CSVs from `./data/Bank/` on startup
- Expose all REST endpoints

### 4. Test the data processor

```bash
curl -X POST http://localhost:8000/queries/1/process
```

Then inspect processed evidence:

```bash
curl http://localhost:8000/queries/1/metrics/summary
curl http://localhost:8000/queries/1/traces/summary
curl http://localhost:8000/queries/1/logs/summary
```

### 5. Test upstream walk (anti-salience)

```bash
# Get a span ID from the trace summary, then:
curl "http://localhost:8000/traces/spans/<span_id>/upstream?max_hops=5"
```

### 6. Start the MCP server

```bash
# Terminal 2
python -m mcp_tools.server
```

Or with SSE transport:
```bash
python -m mcp_tools.server --sse
```

## REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/queries` | GET | List all queries |
| `/queries/{qid}` | GET | Get query details |
| `/queries/{qid}/process` | POST | Run data processor (idempotent) |
| `/queries/{qid}/metrics/summary` | GET | Processed metric anomalies |
| `/queries/{qid}/metrics` | GET | Raw metric points |
| `/queries/{qid}/traces/summary` | GET | Trace summaries + 3-hop paths |
| `/queries/{qid}/traces` | GET | Raw spans |
| `/traces/spans/{sid}/upstream` | GET | Deterministic upstream walk |
| `/queries/{qid}/logs/summary` | GET | Processed log summaries |
| `/queries/{qid}/logs` | GET | Raw log entries |
| `/query` | POST | Run arbitrary SQL |
| `/queries/{qid}/hypotheses` | POST/GET | Create/get hypotheses |
| `/hypotheses/{hid}` | PATCH | Update hypothesis status |
| `/queries/{qid}/findings` | POST/GET | Create/get final findings |
| `/queries/{qid}/steps` | POST/GET | Log/get agent steps |

## MCP Tools

All tools proxy to REST endpoints:

- `process_query` — trigger data preprocessing
- `summarize_metrics` / `fetch_metrics`
- `summarize_traces` / `fetch_traces`
- `walk_upstream_trace` — deterministic ancestor chain
- `summarize_logs` / `fetch_logs`
- `run_sql` — DuckDB SQL for verification
- `create_hypothesis` / `get_hypotheses` / `update_hypothesis`
- `create_finding`
- `log_agent_step`

## Data Processor Details

### Metrics
1. **Anomaly detection**: 3-sigma rule per (component, metric) group
2. **Shape classification**: heuristic (spike | steady_rise | level_shift)
3. **Aggregation**: top-5 pods by total deviation, top-5 metrics per pod

### Traces
1. **Latency threshold**: per-`call_type` 95th percentile
2. **Window aggregation**: 60s buckets by callee, with caller distribution
3. **3-hop paths**: grandparent → caller → callee from high-latency spans

### Logs
1. **Keyword filter**: fatal, error, crash, fail, timeout, refused, exception, denied
2. **Template parsing**: simple Drain-like regex substitution
3. **TF-IDF ranking**: per-component document model, keep 80th percentile+
4. **Deduplication**: same template within 1-min window → keep earliest

## Next Steps

The surrounding system (REST + MCP + Data Processor) is complete. Next:

1. **LangGraph agent loop** — implement the 6-node graph (Data Processor → When/What/Why → Hypothesis Generator ↔ Critic → Finalizer)
2. **Free LLM integration** — Groq (llama-3.3-70b) or Gemini free tier
3. **Batch runner** — sequential loop over `query.csv`, per-query try/except, append-as-you-go
4. **Evaluation** — run `main.evaluate` against OpenRCA v1 ground truth

## Schema Notes

- `query.csv` is the **ground-truth file** (contains both question and answer)
- `record.csv` is raw historical issues (not touched by agent)
- Bank has **no explicit topology file** — dependency graph is inferred from `parent_span_id` chains

## References

- **OpsAgent**: Jiang et al., "An Evolving Multi-agent System for Incident Management in Microservices", ASE 2026. [arXiv:2510.24145](https://arxiv.org/abs/2510.24145)
- **OpenRCA v1**: Xu et al., ICLR 2025. [GitHub](https://github.com/microsoft/OpenRCA)
- **OpenRCA v2 (PAVE)**: arXiv:2606.27154 — failure-mode research borrowed for design, not the target benchmark

## License

MIT — built for portfolio demonstration.
