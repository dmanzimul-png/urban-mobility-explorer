"""Convert the TLC taxi_zones SHAPEFILE into a web-ready GeoJSON 
Usage: python shp_to_geojson.py <taxi_zones.shp> <taxi_zone_lookup.csv> [output.geojson]
"""
import sys, os, json, struct, math, csv

# --- projection constants taken from taxi_zones.prj ---
A, INV_F = 6378137.0, 298.257222101              # GRS80 ellipsoid
E = math.sqrt(2 / INV_F - (1 / INV_F) ** 2)
FT = 0.3048006096012192                          # US survey foot -> metres
LAT1, LAT2, LAT0, LON0 = map(math.radians, (40.66666666666666, 41.03333333333333, 40.16666666666666, -74.0))
FE = 984250.0                                    # false easting (feet)

def _m(p): return math.cos(p) / math.sqrt(1 - (E * math.sin(p)) ** 2)
def _t(p): return math.tan(math.pi / 4 - p / 2) / ((1 - E * math.sin(p)) / (1 + E * math.sin(p))) ** (E / 2)
N = (math.log(_m(LAT1)) - math.log(_m(LAT2))) / (math.log(_t(LAT1)) - math.log(_t(LAT2)))
F = _m(LAT1) / (N * _t(LAT1) ** N)
RHO0 = A * F * _t(LAT0) ** N

def to_latlon(x_ft, y_ft):
    x, y = (x_ft - FE) * FT, y_ft * FT
    rho = math.copysign(math.hypot(x, RHO0 - y), N)
    t = (rho / (A * F)) ** (1 / N)
    lon = math.atan2(x, RHO0 - y) / N + LON0
    lat = math.pi / 2 - 2 * math.atan(t)
    for _ in range(6):                           # iterate for the ellipsoid
        lat = math.pi / 2 - 2 * math.atan(t * ((1 - E * math.sin(lat)) / (1 + E * math.sin(lat))) ** (E / 2))
    return round(math.degrees(lon), 5), round(math.degrees(lat), 5)

def read_dbf(path):
    d = open(path, "rb").read()
    n, hl, rl = struct.unpack("<I", d[4:8])[0], struct.unpack("<H", d[8:10])[0], struct.unpack("<H", d[10:12])[0]
    fields, p = [], 32
    while d[p] != 0x0D:
        fields.append((d[p:p + 11].split(b"\0")[0].decode(), d[p + 16])); p += 32
    rows = []
    for i in range(n):
        rec, off, row = d[hl + i * rl: hl + (i + 1) * rl], 1, {}
        for name, ln in fields:
            row[name] = rec[off:off + ln].decode("latin-1").strip(); off += ln
        rows.append(row)
    return rows

def read_shp(path):
    d = open(path, "rb").read(); pos, shapes = 100, []
    while pos < len(d):
        clen = struct.unpack(">i", d[pos + 4:pos + 8])[0] * 2
        c, pos = d[pos + 8: pos + 8 + clen], pos + 8 + clen
        if struct.unpack("<i", c[:4])[0] != 5: shapes.append([]); continue      # polygons only
        nparts, npts = struct.unpack("<ii", c[36:44])
        parts = list(struct.unpack(f"<{nparts}i", c[44:44 + 4 * nparts])) + [npts]
        o = 44 + 4 * nparts
        pts = [struct.unpack("<dd", c[o + 16 * i: o + 16 * i + 16]) for i in range(npts)]
        shapes.append([pts[parts[i]:parts[i + 1]] for i in range(nparts)])
    return shapes

def area(ring):                                   # signed area: negative = clockwise (outer ring)
    return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)) / 2

def convert(shp, out):
    attrs, shapes, feats = read_dbf(shp[:-4] + ".dbf"), read_shp(shp), []
    for a, rings in zip(attrs, shapes):
        polys = []
        for r in rings:
            ll = [list(to_latlon(x, y)) for x, y in r]
            if area(r) < 0 or not polys: polys.append([ll])     # new outer ring
            else: polys[-1].append(ll)                          # hole inside previous outer ring
        feats.append({"type": "Feature",
                      "properties": {"LocationID": int(a["LocationID"]), "zone": a["zone"], "borough": a["borough"]},
                      "geometry": {"type": "MultiPolygon", "coordinates": polys}})
    json.dump({"type": "FeatureCollection", "features": feats}, open(out, "w"))
    print(f"Wrote {len(feats)} zones -> {os.path.abspath(out)}")
    return feats

if __name__ == "__main__":
    # usage: python shp_to_geojson.py <taxi_zones.shp> <taxi_zone_lookup.csv> [output.geojson]
    shp = sys.argv[1]
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(shp)), "taxi_zones.geojson")
    feats = convert(shp, out)
    if len(sys.argv) > 2:                                       # integrity check against the lookup CSV
        ids = {int(r["LocationID"]) for r in csv.DictReader(open(sys.argv[2], encoding="utf-8-sig"))}
        shp_ids = {f["properties"]["LocationID"] for f in feats}
        print("In lookup but no polygon:", sorted(ids - shp_ids))
        print("Polygon but not in lookup:", sorted(shp_ids - ids))
