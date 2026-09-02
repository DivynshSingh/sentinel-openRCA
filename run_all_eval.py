"""OpenRCA v1 Full Benchmark Evaluation Runner with Complete Node Observability.

Demonstrates running the RCA Agent from scratch, displaying step-by-step reasoning
across each agent node (When, What, Why, LLM Synthesis, Upstream Critic, Finalizer),
and scoring against OpenRCA ground truth loaded from data/Bank/query.csv.
"""
import os
import json
import time

try:
    from dotenv import load_dotenv
    _ = load_dotenv()
except ImportError:
    pass

from rca_agent import (
    LLMConfig,
    OpenRCAEvaluator,
    RCAAgent,
    RCAAgentConfig,
)

def main():
    print("=" * 90)
    print("      SENTINEL RCA AGENT: OPENRCA v1 BENCHMARK FULL EVALUATION SUITE           ")
    print("=" * 90)

    # 1. Initialize configuration with active LLM provider
    provider = os.getenv("LLM_PROVIDER", "gemini" if os.getenv("GEMINI_API_KEY") else "mock")
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
    model_name = os.getenv("LLM_MODEL", "gemini-3.6-flash" if provider == "gemini" else "gpt-4o-mini")

    llm_config = LLMConfig(
        provider=provider,
        api_key=api_key,
        model=model_name,
    )
    
    agent_config = RCAAgentConfig(
        system_name="Bank",
        data_dir=os.getenv("DATA_DIR", "./data/Bank"),
        llm=llm_config,
    )
    
    agent = RCAAgent(agent_config)
    all_query_ids = agent.store.list_query_ids()

    print(f"• Dataset Source : {agent_config.data_dir}/query.csv (Official OpenRCA Schema)")
    print(f"• LLM Provider   : {llm_config.provider.upper()} (Model: {llm_config.model})")
    print(f"• API Key Status : {'LIVE KEY LOADED' if llm_config.api_key else 'NO KEY - RUNNING HEURISTIC ENGINE'}")
    print(f"• Target Suite   : {len(all_query_ids)} Incident Queries ({', '.join(all_query_ids)})\n")

    eval_results = []
    total_start = time.time()

    for idx, qid in enumerate(all_query_ids, start=1):
        print("\n" + "#" * 90)
        print(f" INVESTIGATING INCIDENT #{idx} (Query ID: {qid})")
        print("#" * 90)

        # Run investigation & evaluate against ground truth from query.csv
        q_obj = agent.store.get_query(qid)
        question_text = str(q_obj.get('question', '')).strip() if q_obj else ""
        if not question_text:
            print(f"⏩ Skipping Incident #{idx} (Query ID: '{qid}'): Question/instruction is empty.\n")
            continue

        print(f"❓ Incident Question:\n   \"{question_text}\"\n")

        # Execute investigation
        inv_result = agent.run_investigation(qid)

        # Print detailed node-by-node agent trace
        print("🔍 STEP-BY-STEP AGENT NODE TRACE & REASONING:")
        print("-" * 90)
        for step in inv_result.steps:
            phase_name = step.get("phase", "Agent Step")
            tool_name = step.get("tool_name", "")
            summary = step.get("result_summary", "")
            print(f"▶ [{phase_name}] (Tool: {tool_name})")
            for line in summary.split("\n"):
                print(f"   {line}")
            print()

        # Evaluate investigation against ground truth
        eval_report = OpenRCAEvaluator.evaluate_query(agent, qid, result=inv_result)
        eval_results.append(eval_report)

        gt = eval_report["ground_truth"]
        pred = eval_report["prediction"]
        m = eval_report["metrics"]

        print("📋 EVALUATION VERDICT VS OPENRCA GROUND TRUTH:")
        print("-" * 90)
        print(f"  • Ground Truth Root Cause : {gt['root_cause_component']} at {gt['root_cause_time']}")
        print(f"  • Ground Truth Reason     : {gt['root_cause_reason']}")
        print(f"  • Predicted Root Cause    : {pred['root_cause_component']} at {pred['root_cause_time']}")
        print(f"  • Predicted Reason        : {pred['root_cause_reason']}")
        print(f"  • AC@1 Accuracy           : {'✅ PASS' if m['ac_at_1'] else '❌ FAIL'}")
        print(f"  • Time Accuracy (±3m)     : {'✅ PASS' if m['time_within_3min'] else '❌ FAIL'}")
        print(f"  • Reason Semantic F1      : {m['reason_f1']:.4f}")
        print(f"  • Skeptic Defense         : {'✅ REFUTED SALIENCE DECOY' if m['salience_refuted'] else 'NONE'}")
        print(f"  • Investigation Latency   : {inv_result.duration_ms} ms")

    total_duration = time.time() - total_start

    # Compute Benchmark Summary
    total = len(eval_results)
    if total == 0:
        print("\n" + "=" * 90)
        print("                 OPENRCA v1 BENCHMARK - NO QUERIES TO EVALUATE                 ")
        print("=" * 90)
        print(" All queried records were empty or skipped.")
        return

    ac1_count = sum(1 for e in eval_results if e["metrics"]["ac_at_1"])
    ac3_count = sum(1 for e in eval_results if e["metrics"]["ac_at_3"])
    ac5_count = sum(1 for e in eval_results if e["metrics"]["ac_at_5"])
    time3_count = sum(1 for e in eval_results if e["metrics"]["time_within_3min"])
    time5_count = sum(1 for e in eval_results if e["metrics"]["time_within_5min"])
    salience_count = sum(1 for e in eval_results if e["metrics"]["salience_refuted"])
    avg_f1 = sum(e["metrics"]["reason_f1"] for e in eval_results) / total if total > 0 else 0.0

    print("\n" + "=" * 90)
    print("                    OPENRCA v1 BENCHMARK OVERALL SCORECARD                    ")
    print("=" * 90)
    print(f" Total Incidents Evaluated:             {total}")
    print(f" Total Evaluation Duration:             {total_duration:.2f}s (Avg {total_duration/total:.2f}s per incident)")
    print(f" Top-1 Accuracy (AC@1):                 {(ac1_count/total)*100:.1f}% (OpsAgent Baseline: 16.5%)")
    print(f" Top-3 Recall   (AC@3):                 {(ac3_count/total)*100:.1f}%")
    print(f" Top-5 Recall   (AC@5):                 {(ac5_count/total)*100:.1f}%")
    print(f" Time Window Accuracy (±3 mins):        {(time3_count/total)*100:.1f}%")
    print(f" Time Window Accuracy (±5 mins):        {(time5_count/total)*100:.1f}%")
    print(f" Reason Semantic F1 Score:              {avg_f1:.4f}")
    print(f" Salience Defense Refutation Rate:      {(salience_count/total)*100:.1f}%")
    print("=" * 90 + "\n")

    # Export to json
    output_path = "openrca_all_cases_eval.json"
    with open(output_path, "w") as f:
        json.dump({
            "benchmark": "OpenRCA v1 Full Evaluation",
            "llm_provider": llm_config.provider,
            "llm_model": llm_config.model,
            "total_queries": total,
            "aggregate_metrics": {
                "ac_at_1_pct": (ac1_count / total) * 100,
                "ac_at_3_pct": (ac3_count / total) * 100,
                "ac_at_5_pct": (ac5_count / total) * 100,
                "time_within_3min_pct": (time3_count / total) * 100,
                "avg_reason_f1": avg_f1,
                "salience_refutation_rate_pct": (salience_count / total) * 100,
            },
            "evaluations": eval_results,
        }, f, indent=2)
    print(f"Complete structured benchmark report exported to: {output_path}")

if __name__ == "__main__":
    main()
