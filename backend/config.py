"""
Shared paths and settings for the ETL, algorithms and API.

Every path can be overridden with an environment variable, e.g.
    set UME_DB=D:\\data\\nyc_taxi.db        (Windows)
    export UME_DB=/data/nyc_taxi.db        (macOS/Linux)
"""

import os

BACKEND  = os.path.dirname(os.path.abspath(__file__))
ROOT     = os.path.dirname(BACKEND)

# Raw inputs: yellow_tripdata_2019-01.csv and taxi_zone_lookup.csv live in the
# repo root; backend/data/raw/ is checked as a fallback.
RAW_DIR  = os.environ.get("UME_RAW_DIR", os.path.join(BACKEND, "data", "raw"))
RAW_DIRS = [ROOT, RAW_DIR]

# Generated outputs
PROC_DIR   = os.environ.get("UME_PROC_DIR", os.path.join(BACKEND, "data", "processed"))
LOGS_DIR   = os.environ.get("UME_LOGS_DIR", os.path.join(BACKEND, "data", "logs"))
DB         = os.environ.get("UME_DB", os.path.join(BACKEND, "database", "nyc_taxi.db"))
STATS_JSON = os.path.join(PROC_DIR, "stats.json")

# Dashboard served by the API
FRONTEND_DIR = os.path.join(ROOT, "Frontend")

# API
API_HOST  = os.environ.get("UME_HOST", "127.0.0.1")
API_PORT  = int(os.environ.get("UME_PORT", "5000"))
API_DEBUG = os.environ.get("UME_DEBUG", "1") == "1"
