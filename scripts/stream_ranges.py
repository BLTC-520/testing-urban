"""Stream a large S3 object to stdout in ordered byte-range chunks with per-chunk retries.

Used once to cut a regional extract from the OSM planet without storing the planet on disk:
  python stream_planet.py URL | osmium extract -b ... -s simple -F pbf - -o out.osm.pbf
"""
import hashlib, sys, time, urllib.request

url = sys.argv[1]
chunk = 128 * 1024 * 1024
req = urllib.request.Request(url, method="HEAD")
size = int(urllib.request.urlopen(req, timeout=60).headers["Content-Length"])
md5 = hashlib.md5()
out = sys.stdout.buffer
pos = 0
t0 = time.time()
while pos < size:
    end = min(pos + chunk, size) - 1
    for attempt in range(8):
        try:
            r = urllib.request.Request(url, headers={"Range": f"bytes={pos}-{end}"})
            data = urllib.request.urlopen(r, timeout=300).read()
            if len(data) != end - pos + 1:
                raise IOError(f"short read {len(data)}")
            break
        except Exception as e:  # noqa: BLE001 - retry any transport error
            print(f"retry {attempt} at {pos}: {e}", file=sys.stderr, flush=True)
            time.sleep(2 ** attempt)
    else:
        sys.exit(f"failed at byte {pos}")
    md5.update(data)
    out.write(data)
    pos = end + 1
    el = time.time() - t0
    print(f"{pos/1e9:.2f}/{size/1e9:.2f} GB  {pos/el/1e6:.1f} MB/s  eta {(size-pos)/(pos/el)/60:.0f} min", file=sys.stderr, flush=True)
out.flush()
print(f"MD5 {md5.hexdigest()}", file=sys.stderr, flush=True)
