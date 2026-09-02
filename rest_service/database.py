"""DuckDB connection manager for Sentinel REST service."""
import os
import duckdb
import yaml
from pathlib import Path
from contextlib import contextmanager
from typing import Optional

# Global connection cache
_db_conn: Optional[duckdb.DuckDBPyConnection] = None

def load_config():
    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path) as f:
        return yaml.safe_load(f)["sentinel"]

def get_db_path() -> str:
    cfg = load_config()
    return cfg["data_paths"]["db_path"]

def init_db(db_path: Optional[str] = None) -> duckdb.DuckDBPyConnection:
    """Initialize DuckDB connection and schema."""
    global _db_conn
    if db_path is None:
        db_path = get_db_path()

    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    _db_conn = duckdb.connect(db_path)

    # Load schema
    schema_path = Path(__file__).parent.parent / "schema.sql"
    with open(schema_path) as f:
        _db_conn.execute(f.read())

    return _db_conn

def get_db() -> duckdb.DuckDBPyConnection:
    """Get existing connection or initialize new one."""
    global _db_conn
    if _db_conn is None:
        return init_db()
    return _db_conn

def close_db():
    """Close global connection."""
    global _db_conn
    if _db_conn:
        _db_conn.close()
        _db_conn = None

@contextmanager
def db_cursor():
    """Context manager for database cursor."""
    conn = get_db()
    cursor = conn.cursor()
    try:
        yield cursor
    finally:
        cursor.close()
