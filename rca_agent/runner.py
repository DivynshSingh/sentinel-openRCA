#!/usr/bin/env python3
"""Sentinel RCA Agent & OpenRCA v1 Benchmark CLI Runner.

Usage:
    # 1. Run full OpenRCA v1 benchmark suite
    python -m rca_agent.runner --all

    # 2. Run single incident query (e.g. Query 1 or bank_001)
    python -m rca_agent.runner --query 1

    # 3. Run with Google Gemini LLM
    python -m rca_agent.runner --all --llm gemini --api-key $GEMINI_API_KEY

    # 4. Run with OpenAI LLM
    python -m rca_agent.runner --all --llm openai --api-key $OPENAI_API_KEY

    # 5. Export benchmark results
    python -m rca_agent.runner --all --export results.json
"""
import os
import sys
import argparse
import json
import time
from .config import RCAAgentConfig, LLMConfig
from .agent import RCAAgent
from .evaluator import OpenRCAEvaluator
from .llm_client import get_llm_client

def print_header():
    print("=" * 80)
    print("       SENTINEL RCA AGENT — OPENRCA v1 BENCHMARK RUNNER (PYTHON)       ")
    print("=" * 80)

def print_scorecard(summary: dict):
    m = summary["aggregate_metrics"]
    print("\n" + "=" * 80)
    print("                    OPENRCA v1 BENCHMARK SCORECARD                     ")
    print("=" * 80)
    print(f" Top-1 Accuracy (AC@1):                 {m['ac_at_1_pct']}% (OpsAgent Baseline: 16.5%)")
    print(f" Top-3 Recall   (AC@3):                 {m['ac_at_3_pct']}%")
    print(f" Top-5 Recall   (AC@5):                 {m['ac_at_5_pct']}%")
    print(f" Time Window Accuracy (±3 mins):        {m['time_within_3min_pct']}%")
    print(f" Time Window Accuracy (±5 mins):        {m['time_within_5min_pct']}%")
    print(f" Reason Semantic F1 Score:              {m['avg_reason_f1']}")
    print(f" Salience Defense Refutation Rate:      {m['salience_refutation_rate_pct']}%")
    print(f" Average Investigation Latency:         {m['avg_execution_time_ms']}ms")
    print(f" Average Agent Steps Per Query:         {m['avg_steps_per_query']}")
    print("=" * 80 + "\n")

def print_evaluation_table(evaluations: list):
    print("-" * 115)
    print(f"| {'Query':<7} | {'Ground Truth Comp':<18} | {'Predicted Comp':<15} | {'AC@1':<6} | {'AC@3':<6} | {'Time (±3m)':<10} | {'Reason F1':<9} | {'Defense':<9} | {'Latency':<7} |")
    print("-" * 115)
    for e in evaluations:
        qid = str(e["query_id"])
        gt_comp = e["ground_truth"]["root_cause_component"]
        pred_comp = e["prediction"]["root_cause_component"] or "N/A"
        ac1 = "PASS" if e["metrics"]["ac_at_1"] else "FAIL"
        ac3 = "PASS" if e["metrics"]["ac_at_3"] else "FAIL"
        t3 = "PASS" if e["metrics"]["time_within_3min"] else "FAIL"
        f1 = f"{e['metrics']['reason_f1']:.3f}"
        defense = "REFUTED" if e["metrics"]["salience_refuted"] else "NONE"
        lat = f"{e['metrics']['execution_time_ms']}ms"

        print(f"| {qid:<7} | {gt_comp:<18} | {pred_comp:<15} | {ac1:<6} | {ac3:<6} | {t3:<10} | {f1:<9} | {defense:<9} | {lat:<7} |")
    print("-" * 115)

def main():
    parser = argparse.ArgumentParser(description="Run Sentinel RCA Agent and OpenRCA v1 Evaluation.")
    parser.add_argument("--query", "-q", type=str, help="Specific query ID to evaluate (e.g. 1 or bank_001)")
    parser.add_argument("--all", "-a", action="store_true", help="Run full OpenRCA v1 benchmark suite")
    parser.add_argument("--llm", type=str, default="mock", choices=["mock", "gemini", "openai", "custom"], help="LLM Provider backend")
    parser.add_argument("--api-key", type=str, default=None, help="API Key for LLM provider")
    parser.add_argument("--model", type=str, default=None, help="LLM Model name")
    parser.add_argument("--data-dir", type=str, default=None, help="Path to OpenRCA dataset directory")
    parser.add_argument("--export", "-e", type=str, default="openrca_eval_results.json", help="Path to export JSON benchmark results")

    args = parser.parse_args()

    print_header()

    # Configure
    llm_cfg = LLMConfig(
        provider=args.llm,
        model=args.model or ("gemini-1.5-flash" if args.llm == "gemini" else "gpt-4o-mini"),
        api_key=args.api_key or os.getenv("LLM_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY"),
    )
    agent_cfg = RCAAgentConfig(
        data_dir=args.data_dir or "./data/Bank",
        llm=llm_cfg
    )

    print(f"• LLM Provider : {llm_cfg.provider.upper()} ({'Live API Key Active' if llm_cfg.api_key else 'Heuristic Engine / No Key'})")
    print(f"• System Target: {agent_cfg.system_name}")
    print(f"• Benchmark    : OpenRCA Version 1.0 (ICLR 2025 Standard)\n")

    agent = RCAAgent(agent_cfg)

    if args.query:
        print(f"Running investigation on Query ID: {args.query}...\n")
        ev = OpenRCAEvaluator.evaluate_query(agent, args.query)
        print_evaluation_table([ev])
        print("\n[Diagnostic Finding Summary]")
        print(f"  • Root Cause Component: {ev['prediction']['root_cause_component']}")
        print(f"  • Root Cause Time     : {ev['prediction']['root_cause_time']}")
        print(f"  • Diagnostic Reason   : {ev['prediction']['root_cause_reason']}")
        print(f"  • Ground Truth Match  : {'YES (AC@1 = 1.0)' if ev['metrics']['ac_at_1'] else 'NO'}\n")

        if args.export:
            with open(args.export, "w") as f:
                json.dump(ev, f, indent=2)
            print(f"Exported query evaluation -> {args.export}")

    else:
        # Default or --all
        print("Running full OpenRCA v1 benchmark suite against all queries...\n")
        start_t = time.time()
        summary = OpenRCAEvaluator.run_benchmark_suite(agent)
        total_sec = round(time.time() - start_t, 3)

        print_evaluation_table(summary["evaluations"])
        print_scorecard(summary)

        if args.export:
            with open(args.export, "w") as f:
                json.dump(summary, f, indent=2)
            print(f"Exported complete benchmark summary -> {args.export}\n")

if __name__ == "__main__":
    main()
