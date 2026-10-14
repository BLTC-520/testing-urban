"""Scheduled public transport from GTFS, as a frequency-based routing layer.

For a departure window (e.g. weekday 07:00–09:00) every distinct stop
sequence of a route ("pattern") becomes a chain of route-stop nodes:

    walk node ──board (½ headway, capped + penalty)──▶ route-stop
    route-stop ──ride (median scheduled in-vehicle time)──▶ next route-stop
    route-stop ──alight (0)──▶ walk node

Expected waiting time of half the headway is the standard assumption for
travellers who do not time their arrival to the schedule.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd


def _secs(t: pd.Series) -> pd.Series:
    """GTFS 'HH:MM:SS' (hours may exceed 24) or 'HH:MM' to seconds after midnight."""
    parts = t.str.strip().str.split(":", expand=True).astype(int)
    secs = parts[0] * 3600 + parts[1] * 60
    return secs + parts[2] if 2 in parts.columns else secs


def read_gtfs(path: Path) -> dict[str, pd.DataFrame]:
    out = {}
    with zipfile.ZipFile(path) as z:
        for name in ("stops", "routes", "trips", "stop_times", "calendar", "calendar_dates"):
            fn = f"{name}.txt"
            if fn in z.namelist():
                out[name] = pd.read_csv(io.BytesIO(z.read(fn)), dtype=str, encoding="utf-8-sig")
    return out


def active_services(g: dict[str, pd.DataFrame], date: str) -> set[str]:
    """Service ids running on ``date`` (YYYY-MM-DD) per calendar/calendar_dates.

    Feeds whose trips reference service ids absent from both tables (as the
    myBAS feed does with ``ALLDAY``) are treated as running every day.
    """
    ymd = date.replace("-", "")
    weekday = pd.Timestamp(date).day_name().lower()
    active: set[str] = set()
    cal = g.get("calendar")
    if cal is not None:
        ok = (cal[weekday] == "1") & (cal["start_date"] <= ymd) & (cal["end_date"] >= ymd)
        active |= set(cal.loc[ok, "service_id"])
    cd = g.get("calendar_dates")
    if cd is not None:
        day = cd[cd["date"] == ymd]
        active |= set(day.loc[day["exception_type"] == "1", "service_id"])
        active -= set(day.loc[day["exception_type"] == "2", "service_id"])
    known = set(cal["service_id"]) if cal is not None else set()
    if cd is not None:
        known |= set(cd["service_id"])
    undeclared = set(g["trips"]["service_id"]) - known
    return active | undeclared


@dataclass
class Pattern:
    route_id: str
    route_name: str
    stops: list[str]            # stop ids in order
    ride_s: np.ndarray          # in-vehicle seconds between consecutive stops
    trips_in_window: int
    headway_s: float


def patterns_in_window(g: dict[str, pd.DataFrame], date: str, window: tuple[str, str]) -> list[Pattern]:
    services = active_services(g, date)
    trips = g["trips"][g["trips"]["service_id"].isin(services)]
    st = g["stop_times"][g["stop_times"]["trip_id"].isin(trips["trip_id"])].copy()
    st["seq"] = st["stop_sequence"].astype(int)
    st["dep"] = _secs(st["departure_time"])
    st["arr"] = _secs(st["arrival_time"])
    st = st.sort_values(["trip_id", "seq"])
    first = st.groupby("trip_id")["dep"].first()
    w0, w1 = (_secs(pd.Series([w])).iloc[0] for w in window)
    in_win = first[(first >= w0) & (first < w1)].index
    st = st[st["trip_id"].isin(in_win)]
    seqs = st.groupby("trip_id")["stop_id"].agg(tuple)
    routes = trips.set_index("trip_id")["route_id"]
    names = g["routes"].set_index("route_id")["route_short_name"] if "routes" in g else pd.Series(dtype=str)
    out: list[Pattern] = []
    span = (w1 - w0)
    for (route_id, stops), trip_ids in seqs.groupby([routes.reindex(seqs.index).values, seqs.values]).groups.items():
        sub = st[st["trip_id"].isin(trip_ids)]
        arr = sub.pivot(index="trip_id", columns="seq", values="arr")
        dep = sub.pivot(index="trip_id", columns="seq", values="dep")
        ride = (arr.to_numpy()[:, 1:] - dep.to_numpy()[:, :-1])
        ride = np.nanmedian(np.where(ride >= 0, ride, np.nan), axis=0)
        ride = np.where(np.isfinite(ride), np.maximum(ride, 20.0), 60.0)
        n = len(trip_ids)
        out.append(Pattern(route_id=str(route_id), route_name=str(names.get(route_id, route_id)), stops=list(stops),
                           ride_s=ride.astype(np.float64), trips_in_window=n, headway_s=span / n))
    return out


def route_headways(patterns: list[Pattern]) -> pd.DataFrame:
    rows = [{"route": p.route_name, "stops": len(p.stops), "trips": p.trips_in_window,
             "headway_min": round(p.headway_s / 60, 1)} for p in patterns]
    return pd.DataFrame(rows).sort_values(["route", "headway_min"]).reset_index(drop=True)


def stop_frequency(patterns: list[Pattern], window_min: float) -> pd.Series:
    """Scheduled departures per hour at each stop within the window (all routes)."""
    from collections import Counter

    c: Counter = Counter()
    for p in patterns:
        for s in p.stops[:-1]:
            c[s] += p.trips_in_window
    return pd.Series(c, dtype=float) / (window_min / 60.0)
