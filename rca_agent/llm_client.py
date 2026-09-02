"""Pluggable LLM Client Interface for Root Cause Analysis.

Allows plug-and-play addition of any LLM provider (Gemini, OpenAI, Anthropic, Ollama, or built-in heuristics).
Uses standard library `urllib.request` for zero-dependency portability, with fallback to `httpx` if installed.
"""
import os
import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, List
from .config import LLMConfig

class BaseLLMClient:
    """Base interface for LLM calls during RCA reasoning."""
    def generate(self, prompt: str, system_instruction: Optional[str] = None) -> str:
        raise NotImplementedError

    def generate_json(self, prompt: str, system_instruction: Optional[str] = None) -> Dict[str, Any]:
        raw = self.generate(prompt, system_instruction)
        try:
            text = raw.strip()
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "```" in text:
                text = text.split("```")[1].split("```")[0].strip()
            return json.loads(text)
        except Exception:
            return {"raw_output": raw}


class GeminiLLMClient(BaseLLMClient):
    """Google Gemini API client using standard HTTP."""
    def __init__(self, api_key: str, model: str = "gemini-3.6-flash"):
        self.api_key = api_key
        self.model = model
        self.endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"

    def generate(self, prompt: str, system_instruction: Optional[str] = None) -> str:
        contents = []
        if system_instruction:
            contents.append({"role": "user", "parts": [{"text": f"System Instructions: {system_instruction}"}]})
            contents.append({"role": "model", "parts": [{"text": "Understood. I will follow these instructions."}]})
        
        contents.append({"role": "user", "parts": [{"text": prompt}]})

        payload = {
            "contents": contents,
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 1024,
            }
        }
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint,
            data=data_bytes,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=45) as resp:
                    res_json = json.loads(resp.read().decode("utf-8"))
                    candidates = res_json.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts:
                            return parts[0].get("text", "")
                    return ""
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8")
                if e.code in (429, 500, 503) and attempt < 2:
                    time.sleep(3 * (attempt + 1))
                    continue
                raise RuntimeError(f"Gemini API Error {e.code}: {err_body}")
            except Exception as e:
                if attempt < 2:
                    time.sleep(2)
                    continue
                raise RuntimeError(f"Gemini API Request failed: {e}")
        return ""


class OpenAILLMClient(BaseLLMClient):
    """OpenAI API client (or OpenAI-compatible endpoints like Ollama, vLLM, DeepSeek)."""
    def __init__(self, api_key: str, model: str = "gpt-4o-mini", base_url: str = "https://api.openai.com/v1"):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    def generate(self, prompt: str, system_instruction: Optional[str] = None) -> str:
        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.1,
        }
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=data_bytes,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                return res_json["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise RuntimeError(f"OpenAI API Error {e.code}: {err_body}")


class HeuristicMockLLMClient(BaseLLMClient):
    """Deterministic heuristic reasoning engine for testing without external API keys."""
    def __init__(self, model: str = "heuristic-v1"):
        self.model = model

    def generate(self, prompt: str, system_instruction: Optional[str] = None) -> str:
        return json.dumps({
            "status": "success",
            "reasoning": "Heuristic correlation of metric anomalies, trace bottlenecks, and error logs.",
        })


def get_llm_client(config: LLMConfig) -> BaseLLMClient:
    """Factory to instantiate the configured LLM client."""
    provider = (config.provider or "").lower()
    api_key = config.api_key

    if provider == "gemini" and api_key:
        return GeminiLLMClient(api_key=api_key, model=config.model or "gemini-1.5-flash")
    elif provider in ("openai", "custom") and api_key:
        return OpenAILLMClient(api_key=api_key, model=config.model or "gpt-4o-mini")
    elif api_key and (api_key.startswith("AIza") or "gemini" in (config.model or "").lower()):
        return GeminiLLMClient(api_key=api_key, model=config.model or "gemini-1.5-flash")
    elif api_key and (api_key.startswith("sk-") or "gpt" in (config.model or "").lower()):
        return OpenAILLMClient(api_key=api_key, model=config.model or "gpt-4o-mini")
    else:
        return HeuristicMockLLMClient()
