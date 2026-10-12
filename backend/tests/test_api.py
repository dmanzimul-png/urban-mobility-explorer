"""
Integration tests for the Flask API, run against a small temporary database
built by the real ETL functions (the production DB is never touched).

Run with:  python backend/tests/test_api.py   (or: python -m pytest backend/tests)
"""

import os
import sys
import tempfile
from datetime import datetime, timedelta

import pandas as pd

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BACKEND, "etl"))
sys.path.insert(0, os.path.join(BACKEND, "api"))

import clean
import app as api


def build_fixture():
    """Write a 3-trip database + stats.json into a temp dir and point the API at it."""
    tmp  = tempfile.mkdtemp()
    base = datetime(2019, 1, 15, 8, 0, 0)
    df = pd.DataFrame({
        "VendorID":              [1, 2, 1],
        "tpep_pickup_datetime":  [base, base + timedelta(hours=1), base + timedelta(hours=2)],
        "tpep_dropoff_datetime": [base + timedelta(minutes=10),
                                  base + timedelta(hours=1, minutes=20),
                                  base + timedelta(hours=2, minutes=30)],
        "passenger_count":       [1, 2, 1],
        "trip_distance":         [2.0, 5.0, 17.0],
        "RatecodeID":            [1, 1, 2],
        "PULocationID":          [100, 200, 132],
        "DOLocationID":          [50, 60, 230],
        "payment_type":          [1, 2, 1],
        "fare_amount":           [10.0, 20.0, 52.0],
        "extra":                 [0.0, 0.0, 0.0],
        "mta_tax":               [0.5, 0.5, 0.5],
        "tip_amount":            [2.0, 0.0, 10.0],
        "tolls_amount":          [0.0, 0.0, 5.76],
        "improvement_surcharge": [0.3, 0.3, 0.3],
        "total_amount":          [12.8, 20.8, 68.56],
        "congestion_surcharge":  [0.0, 0.0, 0.0],
        "airport_fee":           [0.0, 0.0, 0.0],
    })
    zones = pd.DataFrame({
        "LocationID":   [50, 60, 100, 132, 200, 230],
        "Borough":      ["Manhattan", "Bronx", "Manhattan", "Queens", "Bronx", "Manhattan"],
        "Zone":         ["Clinton West", "Crotona Park East", "Garment District",
                         "JFK Airport", "Riverdale", "Times Sq"],
        "service_zone": ["Yellow Zone", "Boro Zone", "Yellow Zone", "Airports", "Boro Zone", "Yellow Zone"],
    })

    df = clean.attach_zones(df, zones)
    issues = clean.identify_issues(df)
    df, _ = clean.clean(df)
    df = clean.engineer(df)

    clean.DB   = os.path.join(tmp, "test.db")
    clean.PROC = tmp
    clean.save_db(df, zones)
    clean.save_stats(df, issues, {})

    api.DB         = clean.DB
    api.STATS_JSON = os.path.join(tmp, "stats.json")
    return api.app.test_client()


client = build_fixture()


def test_summary_returns_kpis():
    data = client.get("/api/summary").get_json()
    assert data["total_trips"] == 3
    assert data["airport_trips"] == 1
    print(" test_summary_returns_kpis PASSED")


def test_trips_filters_by_borough():
    data = client.get("/api/trips?borough=Bronx").get_json()
    assert data["total"] == 1
    assert data["trips"][0]["pu_zone"] == "Riverdale"
    print(" test_trips_filters_by_borough PASSED")


def test_trips_filters_by_fare_range_and_hour():
    data = client.get("/api/trips?min_fare=15&max_fare=60").get_json()
    assert data["total"] == 2
    data = client.get("/api/trips?hour=10").get_json()
    assert data["total"] == 1 and data["trips"][0]["fare_amount"] == 52.0
    print(" test_trips_filters_by_fare_range_and_hour PASSED")


def test_trips_paginates():
    data = client.get("/api/trips?limit=2&page=2").get_json()
    assert data["pages"] == 2
    assert len(data["trips"]) == 1
    print(" test_trips_paginates PASSED")


def test_invalid_params_return_400():
    assert client.get("/api/trips?hour=abc").status_code == 400
    assert client.get("/api/trips?hour=24").status_code == 400
    assert client.get("/api/trips?limit=1000").status_code == 400
    print(" test_invalid_params_return_400 PASSED")


def test_trip_detail_and_404():
    assert client.get("/api/trips/1").get_json()["trip_id"] == 1
    assert client.get("/api/trips/999").status_code == 404
    print(" test_trip_detail_and_404 PASSED")


def test_boroughs_come_from_zone_table():
    assert client.get("/api/boroughs").get_json() == ["Bronx", "Manhattan", "Queens"]
    print(" test_boroughs_come_from_zone_table PASSED")


def test_missing_database_returns_503():
    original = api.DB
    api.DB = os.path.join(tempfile.mkdtemp(), "missing.db")
    try:
        assert client.get("/api/trips").status_code == 503
    finally:
        api.DB = original
    print(" test_missing_database_returns_503 PASSED")


def run_all_tests():
    print("=" * 60)
    print("Running API Integration Tests")
    print("=" * 60)
    test_summary_returns_kpis()
    test_trips_filters_by_borough()
    test_trips_filters_by_fare_range_and_hour()
    test_trips_paginates()
    test_invalid_params_return_400()
    test_trip_detail_and_404()
    test_boroughs_come_from_zone_table()
    test_missing_database_returns_503()
    print("=" * 60)
    print("All tests completed.")
    print("=" * 60)


if __name__ == "__main__":
    run_all_tests()
