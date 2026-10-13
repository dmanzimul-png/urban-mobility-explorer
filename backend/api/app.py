"""
Flask REST API serving trip data from the SQLite database.

Run from anywhere:  python backend/api/app.py
Then open http://127.0.0.1:5000/ for the dashboard.
"""

import json
import mimetypes
import os
import sqlite3
import sys

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS

# Path setup: backend/ for config, backend/etl/ for the algorithms module
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
sys.path.insert(0, os.path.join(BASE, "etl"))
import config

DB         = config.DB
STATS_JSON = config.STATS_JSON
FRONTEND   = config.FRONTEND_DIR

ZONE_GEOJSON = os.path.join(BASE, "data", "processed", "taxi_zones.geojson")
_zone_cache = {"mtime": None, "data": None}

# Windows can map .js to text/plain in the registry, which stops the
# dashboard's ES modules from loading. Pin the correct types.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")

app = Flask(__name__, static_folder=None)
CORS(app)   # allow the dashboard to call the API from Live Server / http.server

MAX_PAGE_SIZE = 100


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status  = status


@app.errorhandler(ApiError)
def handle_api_error(err):
    return jsonify({"error": err.message}), err.status


# ── DB helpers ─────────────────────────────────────────────────────────────────
def connect():
    if not os.path.exists(DB):
        raise ApiError("Database not found. Run `python backend/etl/clean.py` first.", 503)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def query(sql, params=()):
    conn = connect()
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def query_one(sql, params=()):
    conn = connect()
    try:
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ── Precomputed stats (cached until the ETL rewrites the file) ─────────────────
_stats_cache = {"mtime": None, "data": None}


def load_stats():
    if not os.path.exists(STATS_JSON):
        raise ApiError("Stats not found. Run `python backend/etl/clean.py` first.", 503)
    mtime = os.path.getmtime(STATS_JSON)
    if _stats_cache["mtime"] != mtime:
        with open(STATS_JSON) as f:
            _stats_cache["data"] = json.load(f)
        _stats_cache["mtime"] = mtime
    return _stats_cache["data"]


def arg(name, cast, minimum=None, maximum=None, default=None):
    """Read and validate a query-string parameter."""
    raw = request.args.get(name, "").strip()
    if raw == "":
        return default
    try:
        value = cast(raw)
    except ValueError:
        raise ApiError(f"'{name}' must be a {cast.__name__}, got '{raw}'")
    if minimum is not None and value < minimum:
        raise ApiError(f"'{name}' must be >= {minimum}")
    if maximum is not None and value > maximum:
        raise ApiError(f"'{name}' must be <= {maximum}")
    return value


# ══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/summary")
def summary():
    return jsonify(load_stats()["summary"])


@app.route("/api/data-quality")
def data_quality():
    return jsonify(load_stats()["data_quality"])


@app.route("/api/rejection-reasons")
def rejection_reasons():
    return jsonify(load_stats().get("rejection_reasons", {}))


@app.route("/api/trips")
def trips():
    """
    Paginated trip list.
    Query params:
      page=1, limit=20 (max 100)
      borough=Manhattan
      payment_type=1
      min_fare=0, max_fare=200
      hour=8
    """
    page   = arg("page",  int, minimum=1, default=1)
    limit  = arg("limit", int, minimum=1, maximum=MAX_PAGE_SIZE, default=20)
    offset = (page - 1) * limit

    filters = [
        ("pu_borough = ?",   request.args.get("borough", "").strip() or None),
        ("payment_type = ?", arg("payment_type", int, minimum=1)),
        ("fare_amount >= ?", arg("min_fare", float, minimum=0)),
        ("fare_amount <= ?", arg("max_fare", float, minimum=0)),
        ("hour = ?",         arg("hour", int, minimum=0, maximum=23)),
    ]
    where  = [clause for clause, value in filters if value is not None]
    params = [value  for clause, value in filters if value is not None]
    where_clause = ("WHERE " + " AND ".join(where)) if where else ""

    total = query_one(f"SELECT COUNT(*) AS cnt FROM trips {where_clause}", params)["cnt"]

    rows = query(
        f"""SELECT trip_id, pickup_datetime, dropoff_datetime,
                   passenger_count, trip_distance, pu_borough, do_borough,
                   pu_zone, do_zone, fare_amount, tip_amount, total_amount,
                   payment_type, trip_duration_min, speed_mph,
                   fare_per_mile, tip_percentage, is_airport, hour, day_name
            FROM trips {where_clause}
            ORDER BY trip_id
            LIMIT ? OFFSET ?""",
        params + [limit, offset],
    )

    return jsonify({
        "page":  page,
        "limit": limit,
        "total": total,
        "pages": (total + limit - 1) // limit,
        "trips": rows,
    })


@app.route("/api/trips/<int:trip_id>")
def trip_detail(trip_id):
    row = query_one("SELECT * FROM trips WHERE trip_id = ?", (trip_id,))
    if not row:
        raise ApiError(f"Trip {trip_id} not found", 404)
    return jsonify(row)


@app.route("/api/by-hour")
def by_hour():
    return jsonify(load_stats()["by_hour"])


@app.route("/api/by-borough")
def by_borough():
    return jsonify(load_stats()["by_borough"])


@app.route("/api/by-day")
def by_day():
    return jsonify(load_stats()["by_day"])


@app.route("/api/by-payment")
def by_payment():
    return jsonify(load_stats()["by_payment"])


@app.route("/api/top-zones")
def top_zones():
    return jsonify(load_stats()["top_pickup_zones"])


@app.route("/api/daily-trend")
def daily_trend():
    return jsonify(load_stats()["daily_trend"])


@app.route("/api/airport")
def airport():
    return jsonify(load_stats()["airport_vs_nonairport"])


@app.route("/api/speed-distribution")
def speed_dist():
    return jsonify(load_stats()["speed_distribution"])


@app.route("/api/dsa-benchmark")
def dsa_benchmark():
    """Run the custom-algorithm benchmark live and return its timings."""
    from algorithms import run_benchmark
    try:
        return jsonify(run_benchmark())
    except FileNotFoundError as e:
        raise ApiError(str(e), 503)

    
@app.route("/api/boroughs")
def boroughs():
    rows = query("SELECT DISTINCT borough FROM taxi_zones ORDER BY borough")
    return jsonify([r["borough"] for r in rows])


@app.route("/api/zones")
def zones():
    borough = request.args.get("borough", "").strip()
    if borough:
        rows = query("SELECT zone FROM taxi_zones WHERE borough = ? ORDER BY zone", (borough,))
    else:
        rows = query("SELECT zone FROM taxi_zones ORDER BY zone")
    return jsonify([r["zone"] for r in rows])


@app.route("/api")
def api_index():
    return jsonify({
        "name":    "NYC Taxi Urban Mobility API",
        "version": "1.0",
        "endpoints": [
            "/api/summary",
            "/api/trips",
            "/api/trips/<id>",
            "/api/by-hour",
            "/api/by-borough",
            "/api/by-day",
            "/api/by-payment",
            "/api/top-zones",
            "/api/daily-trend",
            "/api/airport",
            "/api/speed-distribution",
            "/api/dsa-benchmark",
            "/api/boroughs",
            "/api/zones",
            "/api/data-quality",
            "/api/rejection-reasons",
        ],
    })

from zones_api import bp as zones_bp
app.register_blueprint(zones_bp)

# ── Dashboard (served from the same origin, so no Live Server is needed) ───────
@app.route("/")
def dashboard():
    return send_from_directory(FRONTEND, "index.html")


@app.route("/<path:filename>")
def frontend_files(filename):
    return send_from_directory(FRONTEND, filename)


if __name__ == "__main__":
    print(f"NYC Taxi API  -  http://{config.API_HOST}:{config.API_PORT}  (dashboard at /, API at /api)")
    app.run(host=config.API_HOST, port=config.API_PORT, debug=config.API_DEBUG)
