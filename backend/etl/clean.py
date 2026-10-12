"""
Data cleaning, feature engineering, and database loading.

Run from anywhere:  python backend/etl/clean.py
"""

import glob
import json
import os
import sqlite3
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config

RAW_DIRS = config.RAW_DIRS
PROC     = config.PROC_DIR
LOGS     = config.LOGS_DIR
DB       = config.DB

AIRPORTS = {1, 132, 138}   # EWR, JFK, LaGuardia

# Every charge that makes up total_amount. Older files (e.g. 2019) have no
# airport_fee and an empty congestion_surcharge; newer ones have both.
FARE_COMPONENTS = [
    "fare_amount", "extra", "mta_tax", "tip_amount", "tolls_amount",
    "improvement_surcharge", "congestion_surcharge", "airport_fee",
]

MAX_DURATION_MIN = 24 * 60   # a single taxi trip lasting > 24h is a meter error


def ensure_dirs():
    for d in [PROC, LOGS, os.path.dirname(DB)]:
        os.makedirs(d, exist_ok=True)


# ── 1. LOAD ────────────────────────────────────────────────────────────────────
def find_raw_file(patterns, label):
    """Return the first file matching any pattern in RAW_DIRS."""
    for folder in RAW_DIRS:
        candidates = []
        for pattern in patterns:
            candidates.extend(glob.glob(os.path.join(folder, pattern)))
        if candidates:
            candidates = sorted(candidates)
            if len(candidates) > 1:
                print(f"      Warning: multiple {label} files found, using the first: {candidates}")
            return candidates[0]

    raise FileNotFoundError(
        f"No {label} file found. Looked for {patterns} in: {RAW_DIRS}"
    )


def find_trip_data_file():
    """
    Locate the trip data file without hardcoding a month/year. TLC files are
    named like yellow_tripdata_2019-01.csv / green_tripdata_2024-01.parquet.
    """
    return find_raw_file(["*tripdata*.csv", "*tripdata*.parquet"], "trip data")


def clean_zones(zones):
    """
    Clean the zone lookup: trim text, drop rows without a valid LocationID,
    keep one row per LocationID, and give the two placeholder rows readable
    labels (TLC ships 264 as "Unknown"/"N/A" and 265 as borough "N/A").
    """
    zones = zones.copy()
    for col in ["Borough", "Zone", "service_zone"]:
        zones[col] = zones[col].astype(str).str.strip()
    zones["LocationID"] = pd.to_numeric(zones["LocationID"], errors="coerce")
    zones = zones.dropna(subset=["LocationID"])
    zones["LocationID"] = zones["LocationID"].astype(int)
    zones = zones.drop_duplicates(subset="LocationID", keep="first")

    placeholder = {"", "N/A", "NA", "nan"}
    zones.loc[zones["Borough"].isin(placeholder), "Borough"] = "Unknown"
    zones.loc[zones["LocationID"] == 265, "Borough"] = "Outside NYC"
    zones.loc[zones["Zone"].isin(placeholder), "Zone"] = "Unknown"
    zones.loc[zones["service_zone"].isin(placeholder), "service_zone"] = "Unknown"
    return zones.sort_values("LocationID").reset_index(drop=True)


def load_zones():
    path = find_raw_file(["taxi_zone_lookup.csv"], "zone lookup")
    print(f"      Zones : {path}")
    # keep_default_na=False keeps the literal "N/A" / "Unknown" labels so
    # clean_zones() decides what they become, instead of pandas turning them into NaN.
    zones = clean_zones(pd.read_csv(path, keep_default_na=False))
    zones.to_csv(os.path.join(PROC, "taxi_zones_clean.csv"), index=False)
    print(f"      Zones cleaned : {len(zones)} -> backend/data/processed/taxi_zones_clean.csv")
    return zones


def normalize_columns(df):
    """Make every TLC file look the same to the rest of the pipeline."""
    rename_map = {}
    for col in df.columns:
        if col.lower() == "airport_fee":
            rename_map[col] = "airport_fee"
        elif col.lower() == "congestion_surcharge":
            rename_map[col] = "congestion_surcharge"
    df = df.rename(columns=rename_map)

    # Charges that didn't exist yet for the reporting period are either
    # missing entirely or present but blank. Default both cases to 0 so fare
    # math never carries NaN.
    for col in FARE_COMPONENTS:
        if col not in df.columns:
            print(f"      Note: '{col}' not present in this file - defaulting to 0")
            df[col] = 0.0
        else:
            df[col] = df[col].fillna(0.0)
    return df


def attach_zones(df, zones):
    """
    Add borough/zone names for pickup and dropoff. A categorical map is used
    instead of two DataFrame merges: on a 7M+ row file a merge copies every
    column twice, while a map only builds the four new columns.
    """
    lookup = zones.set_index("LocationID")
    for prefix, col in [("pu", "PULocationID"), ("do", "DOLocationID")]:
        for field, src in [("borough", "Borough"), ("zone", "Zone")]:
            names = df[col].map(lookup[src])
            df[f"{prefix}_{field}"] = names.fillna("Unknown").astype("category")
    return df


def load_raw(nrows=None):
    print("[1/6] Loading raw data...")

    trip_file = find_trip_data_file()
    is_csv    = trip_file.lower().endswith(".csv")
    print(f"      Trips : {trip_file} ({'CSV' if is_csv else 'Parquet'})")

    if is_csv:
        df = pd.read_csv(
            trip_file,
            nrows=nrows,
            usecols=lambda c: c != "store_and_fwd_flag",
            parse_dates=["tpep_pickup_datetime", "tpep_dropoff_datetime"],
            date_format="%Y-%m-%d %H:%M:%S",
            dtype={
                "VendorID": "Int8", "passenger_count": "Int8",
                "RatecodeID": "Int8", "PULocationID": "Int16",
                "DOLocationID": "Int16", "payment_type": "Int8",
            },
        )
    else:
        df = pd.read_parquet(trip_file)
        if nrows:
            df = df.head(nrows)

    zones = load_zones()
    print(f"      Raw records : {len(df):,}")

    df = normalize_columns(df)
    df = attach_zones(df, zones)
    return df, zones


# ── 2. IDENTIFY ISSUES ────────────────────────────────────────────────────────
def get_expected_month_window(df):
    """
    The valid pickup window is the file's dominant (most common) calendar
    month, detected from the data instead of hardcoded. Anything outside it
    is a temporal anomaly.
    """
    year_month   = df["tpep_pickup_datetime"].dt.to_period("M")
    dominant     = year_month.mode().iloc[0]
    window_start = dominant.start_time
    window_end   = dominant.end_time.normalize() + pd.Timedelta(days=1)
    return window_start, window_end


def fare_component_mismatch(df, tolerance=1.0):
    """
    Flag trips whose total_amount doesn't reconcile with the sum of its
    component charges beyond a small tolerance (default $1.00, which absorbs
    rounding). Components missing from the frame count as 0.

    Real TLC files contain rows where total_amount was recorded independently
    of the line items (meter glitches, manual overrides, refunds); those would
    otherwise distort revenue totals.
    """
    components = pd.Series(0.0, index=df.index)
    for col in FARE_COMPONENTS:
        if col in df.columns:
            components = components + df[col].fillna(0)
    return (df["total_amount"].fillna(0) - components).abs() > tolerance


def trip_duration_minutes(df):
    return (
        (df["tpep_dropoff_datetime"] - df["tpep_pickup_datetime"])
        .dt.total_seconds() / 60
    )


def identify_issues(df):
    window_start, window_end = get_expected_month_window(df)
    duration = trip_duration_minutes(df)
    return {
        "total_raw"            : int(len(df)),
        "null_passenger"       : int(df["passenger_count"].isna().sum()),
        "null_ratecode"        : int(df["RatecodeID"].isna().sum()),
        "zero_passenger"       : int((df["passenger_count"] == 0).sum()),
        "negative_fare"        : int((df["fare_amount"] < 0).sum()),
        "zero_distance"        : int((df["trip_distance"] <= 0).sum()),
        "future_pickup"        : int((df["tpep_pickup_datetime"] >= window_end).sum()),
        "past_pickup"          : int((df["tpep_pickup_datetime"] < window_start).sum()),
        "dropoff_before_pickup": int((duration <= 0).sum()),
        "extreme_duration"     : int((duration > MAX_DURATION_MIN).sum()),
        "extreme_fare"         : int((df["fare_amount"] > 500).sum()),
        "extreme_distance"     : int((df["trip_distance"] > 100).sum()),
        "fare_mismatch"        : int(fare_component_mismatch(df).sum()),
    }


# ── 3. CLEAN ──────────────────────────────────────────────────────────────────
def clean(df):
    print("[2/6] Cleaning data...")
    original = len(df)
    mask     = pd.Series(False, index=df.index)
    reasons  = pd.Series("", index=df.index, dtype=object)

    window_start, window_end = get_expected_month_window(df)
    print(f"      Reporting month detected: {window_start.strftime('%Y-%m')} "
          f"(valid window {window_start.date()} to {window_end.date()})")

    duration = trip_duration_minutes(df)

    def flag(condition, reason):
        nonlocal mask
        condition = condition.fillna(False).astype(bool)
        new = condition & ~mask
        mask |= condition
        reasons[new] = reason

    # Order matters: a row is labeled with the first rule it breaks.
    flag(df["tpep_pickup_datetime"] >= window_end,  "future_date")
    flag(df["tpep_pickup_datetime"] <  window_start, "past_date")
    flag(duration <= 0,                "bad_duration")
    flag(duration > MAX_DURATION_MIN,  "extreme_duration")
    flag(df["fare_amount"] < 0,        "negative_fare")
    flag(df["trip_distance"] <= 0,     "zero_distance")
    flag(df["passenger_count"] == 0,   "zero_passengers")
    flag(df["fare_amount"] > 500,      "extreme_fare")
    flag(df["trip_distance"] > 100,    "extreme_distance")
    flag(fare_component_mismatch(df),  "fare_mismatch")

    rejected           = df[mask].copy()
    rejected["reason"] = reasons[mask]
    clean_df           = df[~mask].copy()

    # Fill remaining nulls with the mode (1) rather than dropping the trip
    clean_df["passenger_count"] = clean_df["passenger_count"].fillna(1)
    clean_df["RatecodeID"]      = clean_df["RatecodeID"].fillna(1)
    for col in ["pu_borough", "do_borough", "pu_zone", "do_zone"]:
        if clean_df[col].isna().any():
            clean_df[col] = clean_df[col].astype(object).fillna("Unknown")

    print(f"      Clean    : {len(clean_df):,}")
    print(f"      Rejected : {len(rejected):,}  ({len(rejected)/max(original, 1)*100:.1f}%)")
    return clean_df, rejected


# ── 4. FEATURE ENGINEERING ────────────────────────────────────────────────────
def engineer(df):
    print("[3/6] Engineering features...")

    # Derived feature 1: trip duration in minutes
    df["trip_duration_min"] = trip_duration_minutes(df).round(2)

    # Derived feature 2: average speed mph
    df["speed_mph"] = (
        df["trip_distance"] / (df["trip_duration_min"] / 60)
    ).replace([np.inf, -np.inf], 0).fillna(0).round(2)

    # Derived feature 3: fare efficiency ($ per mile)
    df["fare_per_mile"] = (
        df["fare_amount"] / df["trip_distance"]
    ).replace([np.inf, -np.inf], 0).fillna(0).round(2)

    # Derived feature 4: tip as a percentage of the base fare. Computed against
    # fare_amount (not total_amount) so tolls/surcharges don't dilute it.
    # Cash trips report tip_amount = 0 by TLC convention, so they show 0%.
    df["tip_percentage"] = (
        df["tip_amount"] / df["fare_amount"] * 100
    ).replace([np.inf, -np.inf], 0).fillna(0).round(2)

    # Time features
    pickup = df["tpep_pickup_datetime"]
    df["hour"]        = pickup.dt.hour.astype("int8")
    df["day_name"]    = pickup.dt.day_name().astype("category")
    df["pickup_date"] = pickup.dt.strftime("%Y-%m-%d").astype("category")

    # Airport flag
    df["is_airport"] = (
        df["PULocationID"].isin(AIRPORTS) | df["DOLocationID"].isin(AIRPORTS)
    ).fillna(False).astype("int8")

    # Remove implausible speeds (GPS errors)
    df = df[df["speed_mph"] <= 100].copy()
    print(f"      Records after speed filter : {len(df):,}")
    return df


# ── 5. SAVE TO DB ─────────────────────────────────────────────────────────────
SCHEMA = """
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS taxi_zones;

CREATE TABLE taxi_zones (
    location_id  INTEGER PRIMARY KEY,
    borough      TEXT NOT NULL,
    zone         TEXT NOT NULL,
    service_zone TEXT
);

CREATE TABLE trips (
    trip_id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id             INTEGER,
    pickup_datetime       TEXT    NOT NULL,
    dropoff_datetime      TEXT    NOT NULL,
    passenger_count       INTEGER,
    trip_distance         REAL    NOT NULL,
    pu_location_id        INTEGER REFERENCES taxi_zones(location_id),
    do_location_id        INTEGER REFERENCES taxi_zones(location_id),
    rate_code_id          INTEGER,
    payment_type          INTEGER,
    fare_amount           REAL    NOT NULL,
    extra                 REAL    DEFAULT 0,
    mta_tax               REAL    DEFAULT 0,
    tip_amount            REAL    DEFAULT 0,
    tolls_amount          REAL    DEFAULT 0,
    improvement_surcharge REAL    DEFAULT 0,
    total_amount          REAL    NOT NULL,
    congestion_surcharge  REAL    DEFAULT 0,
    airport_fee           REAL    DEFAULT 0,
    trip_duration_min     REAL,
    speed_mph             REAL,
    fare_per_mile         REAL,
    tip_percentage        REAL,
    hour                  INTEGER,
    day_name              TEXT,
    pickup_date           TEXT,
    is_airport            INTEGER DEFAULT 0,
    pu_borough            TEXT,
    do_borough            TEXT,
    pu_zone               TEXT,
    do_zone               TEXT
);
"""

# Built after the bulk insert — maintaining indexes row-by-row during a
# multi-million row load is several times slower.
INDEXES = """
CREATE INDEX idx_date    ON trips(pickup_date);
CREATE INDEX idx_borough ON trips(pu_borough);
CREATE INDEX idx_zone    ON trips(pu_zone);
CREATE INDEX idx_hour    ON trips(hour);
CREATE INDEX idx_payment ON trips(payment_type);
CREATE INDEX idx_airport ON trips(is_airport);
CREATE INDEX idx_fare    ON trips(fare_amount);
"""

TRIP_COLUMNS = {
    "VendorID":              "vendor_id",
    "tpep_pickup_datetime":  "pickup_datetime",
    "tpep_dropoff_datetime": "dropoff_datetime",
    "passenger_count":       "passenger_count",
    "trip_distance":         "trip_distance",
    "PULocationID":          "pu_location_id",
    "DOLocationID":          "do_location_id",
    "RatecodeID":            "rate_code_id",
    "payment_type":          "payment_type",
    "fare_amount":           "fare_amount",
    "extra":                 "extra",
    "mta_tax":               "mta_tax",
    "tip_amount":            "tip_amount",
    "tolls_amount":          "tolls_amount",
    "improvement_surcharge": "improvement_surcharge",
    "total_amount":          "total_amount",
    "congestion_surcharge":  "congestion_surcharge",
    "airport_fee":           "airport_fee",
    "trip_duration_min":     "trip_duration_min",
    "speed_mph":             "speed_mph",
    "fare_per_mile":         "fare_per_mile",
    "tip_percentage":        "tip_percentage",
    "hour":                  "hour",
    "day_name":              "day_name",
    "pickup_date":           "pickup_date",
    "is_airport":            "is_airport",
    "pu_borough":            "pu_borough",
    "do_borough":            "do_borough",
    "pu_zone":               "pu_zone",
    "do_zone":               "do_zone",
}


def save_db(df, zones, chunk_size=250_000):
    print("[6/6] Saving to database...")
    conn = sqlite3.connect(DB)
    cur  = conn.cursor()
    # Fast bulk load: the DB is fully regenerated on every run, so there is
    # nothing to protect with a journal while loading.
    cur.execute("PRAGMA journal_mode = OFF")
    cur.execute("PRAGMA synchronous = OFF")
    cur.executescript(SCHEMA)

    zones_clean = zones.rename(columns={
        "LocationID": "location_id", "Borough": "borough",
        "Zone": "zone", "service_zone": "service_zone",
    })
    zones_clean.to_sql("taxi_zones", conn, if_exists="append", index=False)

    cols   = list(TRIP_COLUMNS.values())
    sql    = f"INSERT INTO trips ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
    total  = len(df)
    start  = time.perf_counter()

    for lo in range(0, total, chunk_size):
        chunk = df.iloc[lo:lo + chunk_size][list(TRIP_COLUMNS)].rename(columns=TRIP_COLUMNS)
        chunk = chunk.astype({c: object for c in chunk.columns})   # pandas NA -> None
        chunk["pickup_datetime"]  = chunk["pickup_datetime"].astype(str)
        chunk["dropoff_datetime"] = chunk["dropoff_datetime"].astype(str)
        chunk = chunk.where(chunk.notna(), None)
        cur.executemany(sql, chunk.itertuples(index=False, name=None))
        done = min(lo + chunk_size, total)
        print(f"      {done:,} / {total:,} rows  ({time.perf_counter() - start:.0f}s)", end="\r")
    print()

    conn.commit()
    print("      Building indexes...")
    cur.executescript(INDEXES)
    conn.commit()

    n = cur.execute("SELECT COUNT(*) FROM trips").fetchone()[0]
    print(f"      Inserted {n:,} trips")
    conn.close()


# ── 6. SAVE STATS ─────────────────────────────────────────────────────────────
PAYMENT_LABELS = {1: "Credit Card", 2: "Cash", 3: "No Charge", 4: "Dispute", 5: "Unknown", 6: "Voided"}


def compute_stats(df, issues):
    group = lambda col: df.groupby(col, observed=True)

    return {
        "summary": {
            "total_trips"   : int(len(df)),
            "total_revenue" : round(float(df["total_amount"].sum()), 2),
            "avg_fare"      : round(float(df["fare_amount"].mean()), 2),
            "avg_distance"  : round(float(df["trip_distance"].mean()), 2),
            "avg_duration"  : round(float(df["trip_duration_min"].mean()), 2),
            "avg_speed"     : round(float(df["speed_mph"].mean()), 2),
            "airport_trips" : int(df["is_airport"].sum()),
            "avg_tip"       : round(float(df["tip_amount"].mean()), 2),
            "avg_tip_pct"   : round(float(df["tip_percentage"].mean()), 2),
        },
        "data_quality": issues,

        "by_borough": group("pu_borough").agg(
            trips=("fare_amount", "count"),
            revenue=("total_amount", "sum"),
            avg_fare=("fare_amount", "mean"),
            avg_distance=("trip_distance", "mean"),
        ).round(2).reset_index().rename(columns={"pu_borough": "borough"}).to_dict("records"),

        "by_hour": group("hour").agg(
            trips=("fare_amount", "count"),
            avg_fare=("fare_amount", "mean"),
            avg_duration=("trip_duration_min", "mean"),
        ).round(2).reset_index().to_dict("records"),

        "by_day": group("day_name").agg(
            trips=("fare_amount", "count"),
            avg_fare=("fare_amount", "mean"),
            revenue=("total_amount", "sum"),
        ).round(2).reset_index().to_dict("records"),

        "by_payment": [
            {
                "payment_type": int(pt),
                "label": PAYMENT_LABELS.get(int(pt), "Other"),
                "trips": int(grp["fare_amount"].count()),
                "avg_tip": round(float(grp["tip_amount"].mean()), 2),
                "avg_fare": round(float(grp["fare_amount"].mean()), 2),
            }
            for pt, grp in group("payment_type")
        ],

        "top_pickup_zones": group("pu_zone")["fare_amount"].count()
            .sort_values(ascending=False).head(10)
            .reset_index().rename(columns={"pu_zone": "zone", "fare_amount": "trips"})
            .to_dict("records"),

        "daily_trend": group("pickup_date").agg(
            trips=("fare_amount", "count"),
            revenue=("total_amount", "sum"),
        ).round(2).reset_index().to_dict("records"),

        "airport_vs_nonairport": {
            "airport":     round(float(df.loc[df["is_airport"] == 1, "fare_amount"].mean()), 2),
            "non_airport": round(float(df.loc[df["is_airport"] == 0, "fare_amount"].mean()), 2),
        },

        "speed_distribution": {
            "0-10":  int(((df["speed_mph"] >= 0)  & (df["speed_mph"] < 10)).sum()),
            "10-20": int(((df["speed_mph"] >= 10) & (df["speed_mph"] < 20)).sum()),
            "20-30": int(((df["speed_mph"] >= 20) & (df["speed_mph"] < 30)).sum()),
            "30-40": int(((df["speed_mph"] >= 30) & (df["speed_mph"] < 40)).sum()),
            "40+":   int((df["speed_mph"] >= 40).sum()),
        },
    }


def save_stats(df, issues, rejected_summary):
    print("[5/6] Computing dashboard stats...")
    stats = compute_stats(df, issues)
    stats["rejection_reasons"] = rejected_summary
    stats["data_quality"]["total_rejected"] = int(sum(rejected_summary.values()))
    stats["data_quality"]["total_clean"]    = int(len(df))
    with open(os.path.join(PROC, "stats.json"), "w") as f:
        json.dump(stats, f, indent=2, default=str)
    print("      Stats saved -> backend/data/processed/stats.json")


def save_dead_letter(rejected, speed_rejected):
    """Write every rejected record (with its reason) to the dead-letter log."""
    speed_rejected = speed_rejected.assign(reason="impossible_speed")
    all_rejected   = pd.concat([rejected, speed_rejected], ignore_index=True)
    all_rejected.to_csv(os.path.join(LOGS, "dead_letter.csv"), index=False)

    summary = {k: int(v) for k, v in all_rejected["reason"].value_counts().items()}
    with open(os.path.join(LOGS, "rejection_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print(f"[4/6] Dead-letter: {len(all_rejected):,} records -> backend/data/logs/dead_letter.csv")
    print(f"      Reasons: {summary}")
    return summary


# ── MAIN ──────────────────────────────────────────────────────────────────────
def run(nrows=None):
    started = time.perf_counter()
    print("=" * 60)
    print("NYC Taxi ETL Pipeline  -  Urban Mobility Explorer")
    print("=" * 60)
    ensure_dirs()

    df, zones = load_raw(nrows)
    issues    = identify_issues(df)
    df, rej   = clean(df)

    engineered = engineer(df)
    speed_rej  = df.loc[~df.index.isin(engineered.index)]
    del df

    summary = save_dead_letter(rej, speed_rej)
    del rej, speed_rej

    save_stats(engineered, issues, summary)
    save_db(engineered, zones)

    print("=" * 60)
    print(f"Done. {len(engineered):,} clean trips loaded in {time.perf_counter() - started:.0f}s.")
    print("=" * 60)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Run the NYC taxi ETL pipeline.")
    parser.add_argument("--nrows", type=int, default=None,
                        help="Only load the first N rows (default: the full file)")
    run(parser.parse_args().nrows)
