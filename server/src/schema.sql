-- ---------------------------------------------------------------------------
-- SG / JB Command Centre — read-only analysis store.
--
-- Everything in here is derived from web/public/data/*, which is itself the
-- committed output of `make pipeline`. The database is a cache, never a source
-- of truth: `npm run ingest` drops and rebuilds it from scratch.
--
-- Two conventions hold throughout:
--
--   1. Distances are stored in METRES, never minutes. Minutes depend on the
--      walking speed the user picks, so deriving them at query time is what
--      makes the speed and threshold controls cheap:
--          reachable  <=>  metres <= minutes * 60 * speed_mps
--
--   2. A NULL distance means "no destination of this kind within the
--      pipeline's 60-minute search cap, or this cell is off the walk network".
--      The binary files encode that as 65535. Storing it as a number would
--      make every average and every share silently wrong in exactly the
--      under-served places this project is about.
-- ---------------------------------------------------------------------------

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Pipeline-level facts: h3_resolution, generated_utc, osm_snapshot, the walk
-- speed presets, the threshold presets. Values are JSON so a scalar, an array
-- and an object can all live here without a column per setting.
CREATE TABLE meta (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
) STRICT;

-- Dimension: the two cities. Drives the top-bar toggle and the map camera.
CREATE TABLE cities (
  id                    TEXT PRIMARY KEY,          -- 'sg' | 'jb'
  name                  TEXT NOT NULL,
  center_lon            REAL NOT NULL,
  center_lat            REAL NOT NULL,
  zoom                  REAL NOT NULL,
  population            REAL,                      -- census population of the study area
  population_definition TEXT NOT NULL,
  non_residents         REAL                       -- Singapore only; outside the resident census
) STRICT;

-- Dimension: the things people walk to. 6 basket categories plus two
-- supplementary ones (rapid_transit, civic) that are measured but excluded
-- from the completeness score.
CREATE TABLE essentials (
  id         TEXT PRIMARY KEY,                     -- 'groceries', 'healthcare', …
  label      TEXT NOT NULL,                        -- 'Groceries'
  short      TEXT NOT NULL,                        -- 'Food shop'     (KPI tiles)
  question   TEXT NOT NULL,                        -- 'Can I reach a grocery…?'
  in_basket  INTEGER NOT NULL,                     -- 1 = counts toward completeness
  sort_order INTEGER NOT NULL,
  osm_tags   TEXT                                  -- JSON {strict,core,broad} tag lists
) STRICT;

-- Dimension: the administrative units the hexes roll up to. 55 Singapore
-- subzones + 10 Johor Bahru state constituencies. `idx` is the index the
-- binary `unit` column points at, so it is the real key.
CREATE TABLE neighbourhoods (
  idx                         INTEGER PRIMARY KEY,
  city_id                     TEXT NOT NULL REFERENCES cities(id),
  unit_id                     TEXT NOT NULL,
  unit_name                   TEXT NOT NULL,
  area_km2                    REAL,
  population                  REAL,
  elderly                     REAL,
  share_complete              REAL,
  share_low_access            REAL,
  low_access_population       REAL,
  mean_categories             REAL,
  elderly_share_complete      REAL,
  elderly_share_complete_slow REAL,
  weakest_category            TEXT REFERENCES essentials(id),
  weakest_share               REAL
) STRICT;
CREATE INDEX idx_nb_city ON neighbourhoods(city_id);
CREATE UNIQUE INDEX idx_nb_unit ON neighbourhoods(city_id, unit_id);

-- --------------------------------------------------------------------------
-- Fact: one row per H3 resolution-10 cell (91,357 rows across both cities).
--
-- Wide, not tall. A tall (cell, essential, metres) table would be 548k rows
-- and every dashboard query would have to pivot it back, because the
-- dashboard always wants all six categories at once to count completeness.
--
-- h3_r8 / h3_r7 are the parent cells, precomputed here so the API can
-- GROUP BY them. This is the one decision in the schema that is expensive to
-- change later, and it is what lets the map endpoint threshold first and
-- aggregate second — see README "Why the server aggregates".
-- --------------------------------------------------------------------------
CREATE TABLE cells (
  city_id        TEXT NOT NULL REFERENCES cities(id),
  h3             TEXT NOT NULL,                    -- resolution 10, lowercase hex
  h3_r8          TEXT NOT NULL,                    -- parent, ~0.7 km²
  h3_r7          TEXT NOT NULL,                    -- parent, ~5 km²
  pop            REAL NOT NULL,                    -- modelled residents
  elderly        REAL NOT NULL,                    -- modelled residents 65+
  unit_idx       INTEGER REFERENCES neighbourhoods(idx),  -- NULL = outside every unit
  d_groceries    INTEGER,                          -- metres on the walk network,
  d_healthcare   INTEGER,                          -- NULL = unreachable / off-network
  d_education    INTEGER,
  d_green_space  INTEGER,
  d_transit      INTEGER,
  d_dining       INTEGER,
  d_rapid_transit INTEGER,
  d_civic        INTEGER,
  PRIMARY KEY (city_id, h3)
) STRICT;
CREATE INDEX idx_cells_r8 ON cells(city_id, h3_r8);
CREATE INDEX idx_cells_r7 ON cells(city_id, h3_r7);
CREATE INDEX idx_cells_unit ON cells(unit_idx);

-- Dimension + headline numbers for each scenario, straight from the pipeline's
-- own summary so the dashboard's deltas agree with the published study.
CREATE TABLE scenarios (
  id                    TEXT NOT NULL,             -- 'p2p10' | 'p2p25' | 'p2p50'
  city_id               TEXT NOT NULL REFERENCES cities(id),
  family                TEXT NOT NULL,             -- 'parking'
  label                 TEXT NOT NULL,
  sites                 INTEGER NOT NULL,          -- car parks converted
  site_area_ha          REAL,
  share_complete_before REAL NOT NULL,
  share_complete_after  REAL NOT NULL,
  share_low_before      REAL,
  share_low_after       REAL,
  low_access_pop_before REAL,
  low_access_pop_after  REAL,
  newly_complete        REAL,                      -- residents gaining full access
  PRIMARY KEY (id, city_id)
) STRICT;

-- --------------------------------------------------------------------------
-- Fact: the same cells under the "Parking to Proximity" what-if, where the
-- best N car parks become neighbourhood service hubs.
--
-- Long by scenario, wide by category: the before/after switch becomes
-- `WHERE scenario_id = ?` against an identical column set, so one query shape
-- serves both sides of the comparison.
-- --------------------------------------------------------------------------
CREATE TABLE scenario_cells (
  scenario_id   TEXT NOT NULL,
  city_id       TEXT NOT NULL REFERENCES cities(id),
  h3            TEXT NOT NULL,
  h3_r8         TEXT NOT NULL,
  h3_r7         TEXT NOT NULL,
  d_groceries   INTEGER,
  d_healthcare  INTEGER,
  d_education   INTEGER,
  d_green_space INTEGER,
  d_transit     INTEGER,
  d_dining      INTEGER,
  PRIMARY KEY (scenario_id, city_id, h3),
  FOREIGN KEY (scenario_id, city_id) REFERENCES scenarios(id, city_id)
) STRICT;
CREATE INDEX idx_scn_r8 ON scenario_cells(scenario_id, city_id, h3_r8);
CREATE INDEX idx_scn_r7 ON scenario_cells(scenario_id, city_id, h3_r7);

-- --------------------------------------------------------------------------
-- Fact: the pipeline's own aggregate metrics, per city and cohort.
--
-- Long (metric, value) rather than 35 columns, because the metric list is the
-- pipeline's business and will grow. The dashboard asks for the handful it
-- shows by name.
-- --------------------------------------------------------------------------
CREATE TABLE city_metrics (
  city_id TEXT NOT NULL REFERENCES cities(id),
  cohort  TEXT NOT NULL,                           -- 'all' | 'elderly' | 'elderly_slow_walk'
  metric  TEXT NOT NULL,                           -- 'share_complete', 'median_min_groceries', …
  value   REAL,
  PRIMARY KEY (city_id, cohort, metric)
) STRICT;

-- The pre-computed series the ECharts panels plot directly: completeness by
-- threshold, completeness by walking speed, and the 0…6 categories histogram.
CREATE TABLE city_series (
  city_id  TEXT NOT NULL REFERENCES cities(id),
  cohort   TEXT NOT NULL,
  series   TEXT NOT NULL,                          -- 'by_threshold' | 'by_speed' | 'histogram'
  bucket   TEXT NOT NULL,                          -- '15' | 'brisk' | '3'
  position INTEGER NOT NULL,                       -- stable x-axis order
  value    REAL,
  PRIMARY KEY (city_id, cohort, series, bucket)
) STRICT;

-- --------------------------------------------------------------------------
-- The one-footpath case study. rank 0 is the chosen link, 1…9 the runners-up.
-- The 200 KB pre-projected `figure` geometry in footpath.json is deliberately
-- NOT ingested: it exists to draw the React site's static illustration, and a
-- command centre has a real map for that.
-- --------------------------------------------------------------------------
CREATE TABLE footpath_links (
  rank          INTEGER PRIMARY KEY,
  is_chosen     INTEGER NOT NULL,
  city_id       TEXT NOT NULL REFERENCES cities(id),
  a_lon         REAL NOT NULL,
  a_lat         REAL NOT NULL,
  a_street      TEXT,
  b_lon         REAL NOT NULL,
  b_lat         REAL NOT NULL,
  b_street      TEXT,
  mid_lon       REAL NOT NULL,
  mid_lat       REAL NOT NULL,
  link_m        REAL NOT NULL,                     -- length of the new path
  walk_today_m  REAL NOT NULL,                     -- what residents walk instead today
  footbridge    INTEGER NOT NULL,
  unit_id       TEXT,
  unit_name     TEXT,
  place         TEXT
) STRICT;

CREATE TABLE footpath_metrics (
  rank      INTEGER NOT NULL REFERENCES footpath_links(rank),
  threshold TEXT NOT NULL,                         -- '10min' | '15min' | '15min_slow' | …
  metric    TEXT NOT NULL,                         -- 'residents_gaining', 'gain_healthcare', …
  value     REAL,
  PRIMARY KEY (rank, threshold, metric)
) STRICT;
