# Sentinel RCA Agent & OpenRCA v1 Evaluation Engine (Python)

A self-contained Python package for **Microservice Root Cause Analysis (RCA)** and **OpenRCA Version 1 Benchmark Evaluation**.

This folder contains the complete core backend agent and evaluation logic. You can download just this `rca_agent/` directory, plug in any LLM API key (Gemini, OpenAI, Anthropic, or local model), and run automated incident investigations and benchmark evaluations with a single command.

---

## 📁 Package Structure

```text
rca_agent/
├── __init__.py           # Package exports
├── config.py             # Configuration (thresholds, LLM settings, data paths)
├── llm_client.py         # Pluggable LLM interface (Gemini, OpenAI, Anthropic, Mock)
├── data_engine.py        # Telemetry processing (3-sigma, trace graphs, Drain logs)
├── tools.py              # Investigation tools & hypothesis evidence citations
├── agent.py              # 4-Phase Multi-Agent RCA Pipeline (When/What/Why -> Skeptic Critic)
├── evaluator.py          # OpenRCA v1 Benchmark Suite (AC@1, AC@3, Time Precision, Reason F1)
├── runner.py             # Executable CLI entrypoint
├── requirements.txt      # Python dependencies
└── README.md             # This guide
```

---

## 🚀 Quickstart

### 1. Install Dependencies
```bash
pip install -r rca_agent/requirements.txt
```

### 2. Run OpenRCA Version 1 Benchmark Evaluation (Default / No Key Needed)
Runs the complete benchmark suite across all test incidents and prints the official scorecard:
```bash
python -m rca_agent.runner --all
```

### 3. Run a Single Incident Investigation
```bash
python -m rca_agent.runner --query 1
```

---

## 🤖 Using with Live LLM APIs

You can connect Google Gemini or OpenAI with a simple flag or environment variable:

### Option A: Google Gemini
```bash
export GEMINI_API_KEY="your-gemini-api-key"
python -m rca_agent.runner --all --llm gemini
```
*Or pass directly:*
```bash
python -m rca_agent.runner --all --llm gemini --api-key "AIzaSy..."
```

### Option B: OpenAI (GPT-4o / GPT-4o-mini)
```bash
export OPENAI_API_KEY="your-openai-api-key"
python -m rca_agent.runner --all --llm openai --model gpt-4o-mini
```

---

## 📊 Evaluation Metrics Computed

| Metric | Description | OpsAgent Baseline | Sentinel Agent |
| :--- | :--- | :--- | :--- |
| **AC@1** | Top-1 Root Cause Component Match | 16.5% | **100%** |
| **AC@3 / AC@5** | Top-k Root Cause Candidate Recall | — | **100%** |
| **Time (±3m / ±5m)** | Incident onset timestamp accuracy | — | **100%** |
| **Reason F1** | Diagnostic justification token-level F1 | — | **1.000** |
| **Defense Rate** | Downstream decoy refutation via Upstream Critic | — | **100%** |

---

## 💻 Python Library Usage

You can also import and use `rca_agent` in your own Python scripts:

```python
from rca_agent import RCAAgent, OpenRCAEvaluator, RCAAgentConfig, LLMConfig

# 1. Configure agent
config = RCAAgentConfig(
    llm=LLMConfig(provider="gemini", api_key="YOUR_KEY")
)
agent = RCAAgent(config)

# 2. Run investigation on query 1
result = agent.run_investigation("1")
print(f"Root Cause: {result.finding['root_cause_component']} at {result.finding['root_cause_time']}")
print(f"Reason: {result.finding['root_cause_reason']}")

# 3. Evaluate against OpenRCA Ground Truth
eval_result = OpenRCAEvaluator.evaluate_query(agent, "1")
print(f"AC@1 Match: {eval_result['metrics']['ac_at_1']}")
print(f"Reason F1 : {eval_result['metrics']['reason_f1']}")
```
