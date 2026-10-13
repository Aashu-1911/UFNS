#!/usr/bin/env python3
"""M6 dashboard/API launcher (UFNS SIH26085).

Serves the scenario-inspection dashboard and the versioned JSON/artifact API
from the precomputed M5 results (no simulation re-run). Usage:

    python3 scripts/run_dashboard.py            # http://127.0.0.1:8000

Environment (see .env.example): UFNS_API_HOST, UFNS_API_PORT.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

# Load .env if present
env_file = REPO_ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

import socket

import uvicorn  # noqa: E402

from apps.api.app import app  # noqa: E402


def find_free_port(host: str, preferred_port: int, avoid_ports: set[int] = {8000, 8080}) -> int:
    """Find a guaranteed free port, avoiding explicitly blocked ports."""
    candidate = preferred_port
    while candidate < 65535:
        if candidate in avoid_ports:
            candidate += 1
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, candidate))
                return candidate
            except OSError:
                candidate += 1
    return preferred_port


def main() -> None:
    parser = argparse.ArgumentParser(description="UFNS Tactical GIS Dashboard & API Server")
    parser.add_argument(
        "--host",
        default=os.environ.get("UFNS_API_HOST", "127.0.0.1"),
        help="Host to bind server (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("UFNS_API_PORT", "8088")),
        help="Port to bind server (default: 8088)",
    )
    args = parser.parse_args()

    # Verify requested port is free; if occupied or in avoid list, find next free port
    active_port = find_free_port(args.host, args.port, avoid_ports={8000, 8080})
    if active_port != args.port:
        print(f"  [NOTE] Port {args.port} is busy or reserved. Automatically switched to port {active_port}.")

    print(f"\n==================================================================")
    print(f"  UFNS v4.0.0 OPERATIONAL GIS SERVER")
    print(f"  Tactical AMOLED Basemap & REST API: http://{args.host}:{active_port}")
    print(f"==================================================================\n")

    uvicorn.run(app, host=args.host, port=active_port, log_level="info")


if __name__ == "__main__":
    main()
