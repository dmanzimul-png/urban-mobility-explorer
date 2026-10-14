"""Map endpoints: zone boundaries (GeoJSON) and pickups per zone.
Registered in app.py with two lines (see README step 2)."""
import os
import sqlite3
import sys

from flask import Blueprint, jsonify, send_file

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # backend/
sys.path.insert(0, BASE)
import config

bp = Blueprint("zones_api", __name__)
ZONE_GEOJSON = os.path.join(BASE, "data", "processed", "taxi_zones.geojson")
_cache = {"mtime": None, "data": None}


def _error(message, status):
    return jsonify({"error": message}), status


@bp.route("/api/zone-counts")
def zone_counts():
    """Pickups and average fare per pickup zone (cached until the database changes)."""
    if not os.path.exists(config.DB):
        return _error("Database not found. Run `python backend/etl/clean.py` first.", 503)
    mtime = os.path.getmtime(config.DB)
    if _cache["mtime"] != mtime:
        conn = sqlite3.connect(config.DB)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """SELECT pu_zone AS zone, pu_borough AS borough,
                          COUNT(*) AS trips, ROUND(AVG(fare_amount), 2) AS avg_fare
                   FROM trips GROUP BY pu_zone, pu_borough"""
            ).fetchall()
        finally:
            conn.close()
        _cache["data"] = [dict(r) for r in rows]
        _cache["mtime"] = mtime
    return jsonify(_cache["data"])


@bp.route("/api/zone-shapes")
def zone_shapes():
    """Zone boundaries made by backend/etl/shp_to_geojson.py."""
    if not os.path.exists(ZONE_GEOJSON):
        return _error("Zone shapes not found. Run backend/etl/shp_to_geojson.py first.", 503)
    return send_file(ZONE_GEOJSON, mimetype="application/json")
