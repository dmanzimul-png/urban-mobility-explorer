# urban-mobility-explorer
Urban Mobility Data Explorer — NYC Taxi Analytics

A full-stack data platform that cleans, analyzes and visualizes NYC Yellow Taxi trip data: a Python ETL pipeline, a SQLite database, a Flask REST API, three hand-written algorithms, and an interactive Chart.js dashboard.

| Capability | Detail |
|---|---|
| Data source | `yellow_tripdata_2019-01.csv` (fact table) + `taxi_zone_lookup.csv` (dimension table) |
| Records processed | 7,667,792 raw → 7,469,864 clean trips (97.4% kept) |
| Feature engineering | Trip duration, average speed, fare per mile, tip percentage, hour/day, airport flag |
| Database | SQLite, `trips` + `taxi_zones` tables, 7 indexes |
| Backend | Flask REST API, 16 endpoints, also serves the dashboard |
| Frontend | 6-tab dashboard (vanilla JS + Chart.js) |
| Custom algorithms | QuickSort, Min-Heap Top-K, HashMap — no built-in `sort`, `heapq` or `Counter` |

---

## Team

| Name | Role |
|---|---|
| _to fill in_ | |

---

## Architecture

```
 yellow_tripdata_2019-01.csv   taxi_zone_lookup.csv
              │                        │
              └───────────┬────────────┘
                          ▼
        ETL pipeline — backend/etl/clean.py
          1. load + attach zone names
          2. count data-quality issues
          3. reject invalid rows  → backend/data/logs/dead_letter.csv
          4. engineer features
          5. precompute stats     → backend/data/processed/stats.json
          6. bulk-load SQLite     → backend/database/nyc_taxi.db
                          │
                          ▼
        Flask API — backend/api/app.py   (http://127.0.0.1:5000)
          /api/*  JSON endpoints        /  dashboard (Frontend/)
                          │ fetch()
                          ▼
        Dashboard — Frontend/  (HTML/CSS/JS + Chart.js)
          Overview · Time Patterns · Geography ·
          Trip Explorer · DSA Benchmark · Data Quality
```

**Why this stack?**
- **SQLite**: no database server to install, so anyone can clone and run it.
- **Flask**: small and enough for a read-heavy JSON API; it also serves the dashboard so there's one thing to start.
- **Vanilla JS + Chart.js**: no build step.

---

## Project Structure

```
urban-mobility-explorer/
├── README.md
├── requirements.txt
├── taxi_zone_lookup.csv            – TLC zone lookup (not committed)
├── yellow_tripdata_2019-01.csv     – trip data (not committed, ~690 MB)
│
├── backend/
│   ├── etl/
│   │   ├── clean.py                – cleaning, feature engineering, DB load
│   │   └── algorithms.py           – QuickSort, MinHeap, HashMap + benchmark
│   ├── api/
│   │   └── app.py                  – Flask REST API
│   ├── tests/
│   │   ├── test_clean.py
│   │   ├── test_algorithms.py
│   │   └── test_api.py
│   ├── data/
│   │   ├── raw/                    – optional location for the raw files
│   │   ├── processed/stats.json    – precomputed dashboard stats
│   │   ├── processed/taxi_zones_clean.csv – cleaned zone lookup (generated)
│   │   └── logs/                   – dead_letter.csv, rejection_summary.json
│   └── database/nyc_taxi.db        – generated, not committed
│
└── Frontend/
    ├── index.html
    ├── style.css
    └── js/
        ├── api.js                  – fetch wrappers
        ├── charts.js               – Chart.js render functions
        └── dashboard.js            – main controller
```

---

## Setup

Requires Python 3.10+.

```bash
python -m venv venv
venv\Scripts\activate            # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
```

Download `yellow_tripdata_2019-01.csv` and `taxi_zone_lookup.csv` from the [NYC TLC trip record page](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page) and put both in the repo root. Neither is committed. The ETL reads both files from the repo root (`backend/data/raw/` is only a fallback). It accepts any `*tripdata*.csv` or `*tripdata*.parquet` file and detects the reporting month from the data.

---

## Running

### 1. Run the ETL pipeline
```bash
python backend/etl/clean.py              # full file: ~7.7M rows, a few minutes, ~4 GB RAM
python backend/etl/clean.py --nrows 100000   # quick run on the first 100k rows
```

Output on the full January 2019 file:
```
[1/6] Loading raw data...
      Raw records : 7,667,792
[2/6] Cleaning data...
      Reporting month detected: 2019-01 (valid window 2019-01-01 to 2019-02-01)
      Clean    : 7,475,075
      Rejected : 192,717  (2.5%)
[3/6] Engineering features...
      Records after speed filter : 7,469,864
[4/6] Dead-letter: 197,928 records -> backend/data/logs/dead_letter.csv
[5/6] Computing dashboard stats...
[6/6] Saving to database...
      Inserted 7,469,864 trips
```

### 2. Start the API and dashboard
```bash
python backend/api/app.py
```
Open **http://127.0.0.1:5000/** for the dashboard; the API index is at `/api`.
(Live Server or `python -m http.server` in `Frontend/` also works — the dashboard then calls the API on port 5000.)

### 3. Run the tests
```bash
python backend/tests/test_clean.py
python backend/tests/test_algorithms.py
python backend/tests/test_api.py
# or, with pytest installed:
python -m pytest backend/tests
```
The API tests build their own temporary database and don't need the ETL to have run.

### 4. Run the algorithm benchmark on its own
```bash
python backend/etl/algorithms.py
```

---

## Database Schema

```sql
CREATE TABLE taxi_zones (
    location_id  INTEGER PRIMARY KEY,
    borough      TEXT NOT NULL,
    zone         TEXT NOT NULL,
    service_zone TEXT
);

CREATE TABLE trips (
    trip_id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id             INTEGER,
    pickup_datetime       TEXT NOT NULL,
    dropoff_datetime      TEXT NOT NULL,
    passenger_count       INTEGER,
    trip_distance         REAL NOT NULL,
    pu_location_id        INTEGER REFERENCES taxi_zones(location_id),
    do_location_id        INTEGER REFERENCES taxi_zones(location_id),
    rate_code_id          INTEGER,
    payment_type          INTEGER,
    fare_amount           REAL NOT NULL,
    extra                 REAL DEFAULT 0,
    mta_tax               REAL DEFAULT 0,
    tip_amount            REAL DEFAULT 0,
    tolls_amount          REAL DEFAULT 0,
    improvement_surcharge REAL DEFAULT 0,
    total_amount          REAL NOT NULL,
    congestion_surcharge  REAL DEFAULT 0,
    airport_fee           REAL DEFAULT 0,
    trip_duration_min     REAL,   -- derived
    speed_mph             REAL,   -- derived
    fare_per_mile         REAL,   -- derived
    tip_percentage        REAL,   -- derived
    hour                  INTEGER,
    day_name              TEXT,
    pickup_date           TEXT,
    is_airport            INTEGER DEFAULT 0,
    pu_borough            TEXT,
    do_borough            TEXT,
    pu_zone               TEXT,
    do_zone               TEXT
);
-- Indexes: pickup_date, pu_borough, pu_zone, hour, payment_type, is_airport, fare_amount
```

Borough and zone names are stored on each trip (denormalized) so the dashboard's filters and group-bys don't need a join over 7.5M rows.

---

## Custom Algorithms (`backend/etl/algorithms.py`)

| Algorithm | Used for | Complexity |
|---|---|---|
| QuickSort (Lomuto partition, descending) | Sorting trips by fare | O(n log n) avg, O(n²) worst; O(log n) stack, because it only recurses into the smaller partition |
| Min-Heap Top-K | Top 10 busiest pickup zones | O(n log k) time, O(k) space |
| HashMap (separate chaining, polynomial rolling hash) | Trips per borough | O(n) average, O(k) space |

`GET /api/dsa-benchmark` runs all three live against the database, times them against the Python built-ins, and checks the results match.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/summary` | KPI summary |
| GET | `/api/trips` | Paginated trips. Filters: `borough`, `payment_type`, `min_fare`, `max_fare`, `hour`; paging: `page`, `limit` (max 100). Invalid values return 400 |
| GET | `/api/trips/<id>` | Single trip (404 if missing) |
| GET | `/api/by-hour` | Trips by hour of day |
| GET | `/api/by-day` | Trips by day of week |
| GET | `/api/by-borough` | Trips and revenue by pickup borough |
| GET | `/api/by-payment` | Trips by payment type |
| GET | `/api/top-zones` | Top 10 pickup zones |
| GET | `/api/daily-trend` | Daily trip counts and revenue |
| GET | `/api/airport` | Airport vs non-airport average fare |
| GET | `/api/speed-distribution` | Speed buckets |
| GET | `/api/dsa-benchmark` | Live algorithm benchmark |
| GET | `/api/boroughs` | Borough list |
| GET | `/api/zones?borough=` | Zone list, optionally by borough |
| GET | `/api/data-quality` | Issue counts in the raw data |
| GET | `/api/rejection-reasons` | Why each rejected record was dropped |

---

## Data Cleaning

Each rejected row is labeled with the **first** rule it breaks and written to `backend/data/logs/dead_letter.csv`. Counts for January 2019:

| Rule | Rejected | Reasoning |
|---|---:|---|
| Zero passengers | 115,608 | Data entry error |
| Zero / negative distance | 47,350 | Cancelled trip or GPS failure |
| Fare total mismatch (> $1) | 15,766 | `total_amount` ≠ sum of fare, extra, MTA tax, tip, tolls, improvement + congestion surcharge |
| Negative fare | 7,122 | Refunds / meter errors |
| Dropoff at or before pickup | 6,291 | Impossible duration |
| Speed > 100 mph | 5,211 | GPS error (checked after feature engineering) |
| Pickup before the reporting month | 441 | Temporal anomaly |
| Pickup after the reporting month | 96 | Temporal anomaly |
| Distance > 100 mi | 29 | Outlier |
| Fare > $500 | 9 | Outlier |
| Trip longer than 24 h | 5 | Stuck meter (e.g. one trip ran 1–31 Jan) |
| **Total** | **197,928** | 2.6% of raw records |

**Zone lookup** (`taxi_zone_lookup.csv`, 265 zones): text is trimmed, duplicate or non-numeric LocationIDs are dropped, and the TLC placeholder rows get readable labels — 264 becomes borough/zone `Unknown`, 265 becomes borough `Outside NYC`. The cleaned table is saved to `backend/data/processed/taxi_zones_clean.csv` and loaded into `taxi_zones`.

Nulls are filled rather than dropped: `passenger_count` and `RatecodeID` default to the mode (1); `congestion_surcharge` (blank for all of Jan 2019) and `airport_fee` (not yet in 2019 files) default to 0.

**Note on fare mismatches:** almost all of them come from vendor 2 and run exactly $1.95, $2.50 or $4.95 *above* the itemized charges, which looks like a surcharge billed before it had its own column. They're excluded because their totals can't be reconciled, but they are a known, systematic pattern rather than random noise.

---

## Key Findings (January 2019)

- Average trip: **$12.17** fare, **2.82 mi**, **16.6 min**, **11.7 mph**; average tip **15.6%** of the fare.
- Airport trips average **$39.59** vs **$10.29** for everything else.
- Busiest pickup hour is **18:00** (501,112 trips).
- Busiest pickup zones: Upper East Side South, Upper East Side North, Midtown Center.

---

## AI Usage Disclosure

_To complete per the course's academic integrity policy._ AI assistance (Claude Code) was used to port the earlier version of this project into this repository: adapting the ETL to the 2019 file format, the API validation, the tests and this README.
