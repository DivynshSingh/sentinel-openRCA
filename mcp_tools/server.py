"""Sentinel MCP Server — exposes tools that call the REST layer via HTTP.

All tools are HTTP clients against the REST service. No direct file access.
This mirrors real observability stacks where telemetry lives on separate systems.

Usage:
    python -m mcp_tools.server          # stdio transport (default)
    python -m mcp_tools.server --sse    # SSE transport
"""
import os
import sys
import argparse
import json
from typing import Any, Dict, Optional

import httpx
import yaml
from pathlib import Path

# MCP SDK imports with fallback
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.server.sse import SseServerTransport
    from mcp.types import Tool, TextContent, ImageContent, EmbeddedResource
    MCP_V2 = True
except ImportError:
    try:
        from mcp import Server, StdioServerTransport
        from mcp.types import Tool, TextContent
        MCP_V2 = False
    except ImportError:
        print("ERROR: mcp package not installed. Run: pip install mcp", file=sys.stderr)
        sys.exit(1)


def load_config():
    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path) as f:
        return yaml.safe_load(f)["sentinel"]


class SentinelMCPServer:
    """MCP server that proxies all tool calls to the REST service."""

    def __init__(self):
        cfg = load_config()
        self.base_url = cfg["mcp_server"]["rest_base_url"]
        self.client = httpx.Client(base_url=self.base_url, timeout=60.0)

    def _get(self, path: str, params: Optional[Dict] = None) -> Dict:
        r = self.client.get(path, params=params)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, json_data: Optional[Dict] = None) -> Dict:
        r = self.client.post(path, json=json_data)
        r.raise_for_status()
        return r.json()

    def _patch(self, path: str, json_data: Optional[Dict] = None) -> Dict:
        r = self.client.patch(path, json=json_data)
        r.raise_for_status()
        return r.json()

    # ------------------------------------------------------------------
    # TOOL DEFINITIONS
    # ------------------------------------------------------------------

    def get_tools(self) -> list:
        """Return list of Tool definitions for MCP."""
        return [
            Tool(
                name="process_query",
                description="Run the data processor for a query. Idempotent — skips if already processed.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string", "description": "Query ID to process"},
                        "force": {"type": "boolean", "description": "Force re-processing even if already done", "default": False},
                    },
                    "required": ["query_id"],
                },
            ),
            Tool(
                name="summarize_metrics",
                description="Get pre-processed metric anomalies for a query (3-sigma + shape classification + top-K).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                    },
                    "required": ["query_id"],
                },
            ),
            Tool(
                name="fetch_metrics",
                description="Fetch raw metric time-series points for a query window.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                        "component": {"type": "string", "description": "Filter by component_id"},
                        "metric": {"type": "string", "description": "Filter by kpi_name"},
                    },
                    "required": ["query_id"],
                },
            ),
            Tool(
                name="summarize_traces",
                description="Get pre-processed trace summaries and 3-hop call paths for a query.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                    },
                    "required": ["query_id"],
                },
            ),
            Tool(
                name="fetch_traces",
                description="Fetch raw spans for a query window.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                        "trace_id": {"type": "string", "description": "Filter by trace_id"},
                        "component": {"type": "string", "description": "Filter by component_id"},
                    },
                    "required": ["query_id"],
                },
            ),
            Tool(
                name="walk_upstream_trace",
                description="Deterministic upstream walk from a span via parent_span_id. Returns ancestor chain with anomaly flags. Defends against salience capture.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "span_id": {"type": "string", "description": "Starting span ID"},
                        "max_hops": {"type": "integer", "description": "Max hops to walk", "default": 10},
                    },
                    "required": ["span_id"],
                },
            ),
            Tool(
                name="summarize_logs",
                description="Get pre-processed log summaries for a query (keyword-filtered + template-parsed + TF-IDF ranked).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                    },
                    "required": ["query_id"],
                },
            ),
            Tool(
                name="fetch_logs",
                description="Fetch raw log entries for a query window.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                        "component": {"type": "string", "description": "Filter by component_id"},
                        "level": {"type": "string", "description": "Filter by log level (ERROR, WARN, INFO, etc.)"},
                    },
                    "required": ["query_id"],
                },
            ),
            Tool(
                name="run_sql",
                description="Execute arbitrary SQL against DuckDB. Can join hypothesis_evidence with telemetry tables for verification.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "sql": {"type": "string", "description": "SQL query to execute"},
                    },
                    "required": ["sql"],
                },
            ),
            Tool(
                name="create_hypothesis",
                description="Create a new hypothesis with evidence citations.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                        "component_id": {"type": "string", "description": "Accused component"},
                        "phase_created": {"type": "string", "description": "p1_metrics | p2_logs | p3_verify"},
                        "reason": {"type": "string", "description": "Why this component is the root cause"},
                        "confidence": {"type": "number", "description": "Confidence score 0.0-1.0"},
                        "evidence": {
                            "type": "array",
                            "description": "List of evidence citations",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "evidence_type": {"type": "string"},
                                    "evidence_table": {"type": "string"},
                                    "evidence_pk": {"type": "string"},
                                    "citation_text": {"type": "string"},
                                },
                            },
                        },
                    },
                    "required": ["query_id", "component_id", "phase_created", "reason"],
                },
            ),
            Tool(
                name="get_hypotheses",
                description="Get all hypotheses for a query, optionally filtered by status.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                        "status": {"type": "string", "description": "active | dropped | confirmed"},
                    },
                    "required": ["query_id"],
                },
            ),
            Tool(
                name="update_hypothesis",
                description="Update hypothesis status (drop, confirm, supersede).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "hypothesis_id": {"type": "string"},
                        "status": {"type": "string", "description": "active | dropped | confirmed"},
                        "superseded_by": {"type": "string", "description": "ID of better hypothesis"},
                        "confidence": {"type": "number"},
                    },
                    "required": ["hypothesis_id"],
                },
            ),
            Tool(
                name="create_finding",
                description="Create final root cause finding. Marks query as done.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                        "hypothesis_id": {"type": "string"},
                        "root_cause_time": {"type": "string", "description": "ISO timestamp"},
                        "root_cause_component": {"type": "string"},
                        "root_cause_reason": {"type": "string"},
                    },
                    "required": ["query_id"],
                },
            ),
            Tool(
                name="log_agent_step",
                description="Log an agent step for observability and debugging.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query_id": {"type": "string"},
                        "phase": {"type": "string", "description": "p0 | p1 | p2 | p3 | p4"},
                        "tool_name": {"type": "string"},
                        "args": {"type": "object"},
                        "result_summary": {"type": "string"},
                    },
                    "required": ["query_id", "phase", "tool_name"],
                },
            ),
        ]

    # ------------------------------------------------------------------
    # TOOL HANDLERS
    # ------------------------------------------------------------------

    def handle_tool(self, name: str, arguments: Dict[str, Any]) -> list:
        """Dispatch tool call to REST endpoint."""
        try:
            if name == "process_query":
                result = self._post(f"/queries/{arguments['query_id']}/process", {"force": arguments.get("force", False)})

            elif name == "summarize_metrics":
                result = self._get(f"/queries/{arguments['query_id']}/metrics/summary")

            elif name == "fetch_metrics":
                params = {k: v for k, v in arguments.items() if k != "query_id" and v is not None}
                result = self._get(f"/queries/{arguments['query_id']}/metrics", params)

            elif name == "summarize_traces":
                result = self._get(f"/queries/{arguments['query_id']}/traces/summary")

            elif name == "fetch_traces":
                params = {k: v for k, v in arguments.items() if k != "query_id" and v is not None}
                result = self._get(f"/queries/{arguments['query_id']}/traces", params)

            elif name == "walk_upstream_trace":
                params = {"max_hops": arguments.get("max_hops", 10)}
                result = self._get(f"/traces/spans/{arguments['span_id']}/upstream", params)

            elif name == "summarize_logs":
                result = self._get(f"/queries/{arguments['query_id']}/logs/summary")

            elif name == "fetch_logs":
                params = {k: v for k, v in arguments.items() if k != "query_id" and v is not None}
                result = self._get(f"/queries/{arguments['query_id']}/logs", params)

            elif name == "run_sql":
                result = self._post("/query", {"sql": arguments["sql"]})

            elif name == "create_hypothesis":
                payload = {k: v for k, v in arguments.items() if v is not None}
                result = self._post(f"/queries/{arguments['query_id']}/hypotheses", payload)

            elif name == "get_hypotheses":
                params = {k: v for k, v in arguments.items() if k != "query_id" and v is not None}
                result = self._get(f"/queries/{arguments['query_id']}/hypotheses", params)

            elif name == "update_hypothesis":
                payload = {k: v for k, v in arguments.items() if k != "hypothesis_id" and v is not None}
                result = self._patch(f"/hypotheses/{arguments['hypothesis_id']}", payload)

            elif name == "create_finding":
                payload = {k: v for k, v in arguments.items() if k != "query_id" and v is not None}
                result = self._post(f"/queries/{arguments['query_id']}/findings", payload)

            elif name == "log_agent_step":
                payload = {k: v for k, v in arguments.items() if k != "query_id" and v is not None}
                result = self._post(f"/queries/{arguments['query_id']}/steps", payload)

            else:
                raise ValueError(f"Unknown tool: {name}")

            return [TextContent(type="text", text=json.dumps(result, indent=2, default=str))]

        except httpx.HTTPStatusError as e:
            err = {"error": True, "status_code": e.response.status_code, "detail": e.response.text}
            return [TextContent(type="text", text=json.dumps(err, indent=2))]
        except Exception as e:
            err = {"error": True, "detail": str(e)}
            return [TextContent(type="text", text=json.dumps(err, indent=2))]


# ------------------------------------------------------------------
# SERVER ENTRY POINTS
# ------------------------------------------------------------------

async def run_stdio():
    """Run MCP server over stdio (for Claude Desktop, etc.)."""
    server = SentinelMCPServer()

    if MCP_V2:
        mcp = Server("sentinel-mcp")

        @mcp.list_tools()
        async def list_tools() -> list:
            return server.get_tools()

        @mcp.call_tool()
        async def call_tool(name: str, arguments: dict) -> list:
            return server.handle_tool(name, arguments)

        async with stdio_server() as (read_stream, write_stream):
            await mcp.run(read_stream, write_stream, mcp.create_initialization_options())
    else:
        # MCP v1 fallback
        mcp = Server({"name": "sentinel-mcp", "version": "2.0.0"})
        mcp.setRequestHandler("list_tools", lambda req: {"tools": server.get_tools()})
        mcp.setRequestHandler("call_tool", lambda req: {
            "content": server.handle_tool(req["params"]["name"], req["params"]["arguments"])
        })
        transport = StdioServerTransport()
        await mcp.connect(transport)


async def run_sse():
    """Run MCP server over SSE (for web clients)."""
    from starlette.applications import Starlette
    from starlette.routing import Route
    from mcp.server.sse import SseServerTransport

    server = SentinelMCPServer()
    sse = SseServerTransport("/messages/")

    mcp = Server("sentinel-mcp")

    @mcp.list_tools()
    async def list_tools() -> list:
        return server.get_tools()

    @mcp.call_tool()
    async def call_tool(name: str, arguments: dict) -> list:
        return server.handle_tool(name, arguments)

    async def handle_sse(request):
        async with sse.connect_session(request.scope, request.receive, request._send) as (read_stream, write_stream):
            await mcp.run(read_stream, write_stream, mcp.create_initialization_options())

    async def handle_messages(request):
        await sse.handle_post_message(request.scope, request.receive, request._send)

    starlette_app = Starlette(
        debug=True,
        routes=[
            Route("/sse", endpoint=handle_sse),
            Route("/messages/", endpoint=handle_messages, methods=["POST"]),
        ],
    )

    import uvicorn
    uvicorn.run(starlette_app, host="0.0.0.0", port=8001)


def main():
    parser = argparse.ArgumentParser(description="Sentinel MCP Server")
    parser.add_argument("--sse", action="store_true", help="Use SSE transport instead of stdio")
    args = parser.parse_args()

    import asyncio
    if args.sse:
        run_sse()
    else:
        asyncio.run(run_stdio())


if __name__ == "__main__":
    main()
