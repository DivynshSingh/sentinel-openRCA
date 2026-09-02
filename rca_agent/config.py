"""Configuration settings for Sentinel RCA Agent & OpenRCA v1 Benchmark."""
import os
from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class LLMConfig:
    provider: str = os.getenv("LLM_PROVIDER", "mock")  # "gemini", "openai", "anthropic", "mock"
    model: str = os.getenv("LLM_MODEL", "gemini-3.6-flash")
    api_key: Optional[str] = os.getenv("LLM_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("OPENAI_API_KEY")
    temperature: float = 0.1
    max_tokens: int = 1500

@dataclass
class DataProcessorConfig:
    metric_sigma: float = 3.0
    trace_latency_pct: float = 95.0
    log_keywords: List[str] = field(default_factory=lambda: [
        "fatal", "error", "crash", "fail", "timeout", "refused", "exception", "denied", "throttled"
    ])
    log_tfidf_pctile: float = 80.0
    top_k_pods: int = 5
    top_k_metrics: int = 5

@dataclass
class RCAAgentConfig:
    system_name: str = "Bank"
    data_dir: str = os.getenv("DATA_DIR", "./data/Bank")
    db_path: str = os.getenv("DB_PATH", "./data/sentinel.duckdb")
    llm: LLMConfig = field(default_factory=LLMConfig)
    data_processor: DataProcessorConfig = field(default_factory=DataProcessorConfig)
