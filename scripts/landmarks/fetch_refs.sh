#!/usr/bin/env bash
# Re-download the reference photographs listed in sources.json.
#
# They are not committed (unclear licences), so the analysis step needs them
# fetched first. Everything lands in one throwaway directory:
#
#   ./scripts/landmarks/fetch_refs.sh /tmp/landmark-refs
#   python scripts/landmarks/analyse_refs.py /tmp/landmark-refs \
#       -o scripts/landmarks/refs/analysis.json
set -euo pipefail
dir="${1:?usage: fetch_refs.sh <dir>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$dir"
python3 - "$here/sources.json" <<'PY' | while read -r key url; do
import json, sys
src = json.load(open(sys.argv[1]))["references"]
for k, v in src.items():
    print(k, v["url"])
PY
  echo "  $key"
  # Keep whatever extension the source has: one of these is a PNG, and saving
  # it as .jpg works only because every reader here sniffs the format.
  ext="${url##*.}"
  case "$ext" in jpg|jpeg|png|webp) ;; *) ext=jpg ;; esac
  curl -fsSL --retry 3 -o "$dir/$key.$ext" "$url"
done
echo "references in $dir"
