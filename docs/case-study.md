# Case study — Singapore / Johor Bahru 15-Minute City Explorer

> Can you walk to everything you need? Two cities share a strait — and not a street pattern.
> An open, reproducible street-network study for 5.8 million people.

All figures below come from `data/derived/summary.json` (OpenStreetMap snapshot 2026-10-05,
walking at 1.2 m/s, 15 minutes, core definitions) unless stated otherwise.

---

## 1. Problem

The "15-minute city" asks whether everyday needs are within a short walk of home. Most
implementations answer with circles — every shop within 1 km "counts" — and with maps that
cannot say how many people a gap affects or whether a finding survives a different definition.

Singapore and Johor Bahru make the question unusually sharp. They are one functional region —
Woodlands Checkpoint handled about 327,000 travellers a day in 2024 — but two different urban
models: Singapore's planned public-housing towns built around transit, and Johor Bahru's
car-oriented metropolis of private estates (*taman*) linked by highways. The RTS Link, a 4 km
cross-border shuttle due to open by the end of 2026, and Singapore's first public autonomous
shuttles (Punggol, April 2026) add a forward-looking question: **what should infrastructure look
like when many road users are autonomous agents?**

## 2. Research questions

1. What share of residents can reach a basket of six essentials on foot within 15 minutes, in each city?
2. Where are the gaps, which essential is missing, and who is affected (including older and slower walkers)?
3. How much of the difference is street structure, how much is destinations, and how much is the map itself?
4. How robust are the findings to the definitions a researcher could reasonably choose?
5. What would change with the RTS Link, a shared autonomous feeder, or car-park land converted into neighbourhood hubs?

## 3. Data

| Layer | Source | Class |
|---|---|---|
| Streets, footpaths, destinations, parks, car parks | OpenStreetMap planet snapshot 2026-10-05 (bbox extract) | observed |
| Independent places (sensitivity) | Overture Maps Places 2026-09-23 | observed |
| Population | Census 2020: SingStat (subzones; residents), DOSM (state constituencies N.40–N.49; all persons) | observed |
| Where residents live inside census units | Meta/CIESIN HRSL 30 m, Kontur (fallback and sensitivity) | modelled |
| Residents aged 65+ | SingStat / DOSM age tables, HRSL elderly layer | observed / modelled |
| Bus stops, rail stations (validation) | LTA DataMall, myBAS GTFS | observed |
| Bus timetables (cross-border model) | myBAS Johor GTFS, KTMB GTFS | observed |
| Land cover (basemap) | ESA WorldCover 2021 | observed |

Most official portals were unreachable from the build environment, so every source was taken from
an authoritative mirror (AWS Open Data, official GitHub releases) and recorded with its URL,
SHA-256 and retrieval time in `data/provenance.json`. The OpenStreetMap extract was cut by
streaming the dated planet file through `osmium extract`, so no 95 GB file was stored.

## 4. Methodology

* **Network.** A walk graph of 456,015 nodes and 612,470 edges (36,355 km) built from OSM with
  explicit inclusion rules; a strict variant forbids walking on trunk/primary carriageways without
  a mapped sidewalk.
* **Origins.** 91,357 H3 resolution-10 cells (≈0.015 km²) carrying census-calibrated residents.
* **Access.** One multi-source Dijkstra search per essential gives every cell its network distance to
  the nearest destination. Points join the network at the nearest *edge* (not node), with the
  off-network leg counted at 1.3 × its length and a 250 m cap.
* **Metrics.** Completeness (share of the six essentials within τ minutes), share of residents with
  all six ("complete"), low access (fewer than three), cumulative opportunities, a gravity index
  (10-minute half-life), weighted quantiles and Gini; walk-shed ratio (residents reached on the
  network ÷ residents in the circle) and circuity for urban form.
* **Validation.** OSM vs official stops and stations, OSM vs Overture per category, population
  model vs census.
* **Sensitivity.** 72 runs: speed × threshold × taxonomy × network × population model, with each
  finding labelled robust (≥ 90 % of runs), conditional (50–90 %) or fragile.

The Methods page in the site documents every formula and parameter.

## 5. Design process

The product was designed around one sentence: *a reader should feel the difference between a
circle and a walk.* That led to three surfaces:

* **Story** — a scrollytelling essay over a single fixed map. Each step is a *scene* (camera +
  layers); essays with small, accessible SVG charts scroll over it. The hero shows both cities as
  hexagon columns (height = residents, colour = essentials reached), so population and access read
  together.
* **Explorer** — the full instrument: change the time budget, walking speed, definitions, network,
  population group or scenario, and every number recomputes in the browser; click anywhere to
  watch a walk-shed grow along the real streets.
* **Methods** — documentation generated from the same data files.

Visual identity: a dark "night survey" basemap so that places with services light up; a single
analogous blue-to-mint ramp for completeness (monotone in lightness); a validated colour pair for
the cities (vermilion for Singapore, blue for Johor Bahru) used only in charts and legends; and one
warm accent reserved for scenario gains. Palettes were checked with a colour-vision-deficiency
validator; charts follow thin-mark, single-axis, legend-plus-table rules. Evidence badges
(observed · calculated · modelled · assumed · scenario) mark the status of every number.

## 6. System architecture

A static-first design: the Python pipeline writes compact binary tables, JSON and tiled street
graphs; the React site reads them and does the remaining computation in the browser (completeness
for any assumption, Dijkstra isochrones, the cross-border model). MapLibre renders a self-hosted
PMTiles basemap; deck.gl draws the analysis layers in the same WebGL context. No server, no API
keys. Details: [architecture.md](architecture.md).

## 7. Implementation notes

* Graph kernels (CSR, multi-source and bounded Dijkstra, cumulative-opportunity accumulation) are
  numba-compiled; the full accessibility stage runs in about 75 seconds.
* Cross-language tests ensure the TypeScript decoders, routing and metrics reproduce the Python
  outputs; output-integrity tests check census totals, audit sizes and monotonicity.
* Running on the complete extract surfaced real-world issues the development sample hid: roads cut
  by the extract boundary, an LTA station layer with an empty name column (the audit counted one
  station until fixed), country relations missing from bbox extracts (the border is now drawn from
  boundary ways), and an OSM station name that differs from the timetable's.

## 8. Findings

| | Singapore | Johor Bahru |
|---|---:|---:|
| Census 2020 count (SG residents; JB all persons) | 4,044,340 | 1,753,284 |
| All six essentials within 15 min | **80.4 %** | **12.0 %** |
| Fewer than three within 15 min | 2.0 % (78,900) | 37.9 % (657,200) |
| None of the six within 15 min | 0.2 % | 14.4 % |
| Median essentials reached | 6 of 6 | 3 of 6 |
| All six within 10 / 20 min | 49.5 % / 92.5 % | 3.5 % / 24.7 % |
| All six at 0.9 m/s (slow walkers) | 59.9 % | 5.1 % |
| Residents 65+ with all six (1.2 → 0.9 m/s) | 81.4 % → 60.2 % | 12.9 % → 5.6 % |
| Essential most often missing | healthcare (16 % lack it) | healthcare (67 % lack it) |
| Rail station within 10 min | 51 % | 0.2 % |
| Street junctions per km² | 287 | 98 |
| Footpaths, share of walkable length | 47 % | 11 % |
| Neighbours in the 15-min circle reached on foot (median) | 47 % | 34 % |

**Population basis.** Singapore's census counts residents; Johor Bahru's counts all persons. Shares count
residents whose homes are within 250 m of a walkable street: 99.9 % of Singapore's census count and
98.9 % of Johor Bahru's. Singapore's total population also includes about 1.64 million non-residents
(Singapore Department of Statistics, *Population in Brief 2020*), many of them work-permit holders. The
pipeline does not model where they live. Even if none of them had all six essentials within reach,
Singapore's share of all persons would be at least 57.1 %, still far above Johor Bahru's 12.0 %. The
direction of the finding cannot flip; the gap would be at least 45 points rather than 68. Using Overture
Places for food shops, clinics, schools and eateries gives 89.5 % in Singapore and 23.0 % in Johor Bahru.

1. **The gap is large and robust.** Singapore leads in all 72 sensitivity runs; the gap exceeds
   20 points in 70 of them. "Most Johor Bahru residents lack at least one essential" holds in every
   run; "most Singapore residents have all six" is *conditional* (79 % of runs) — it fails with a
   10-minute budget or a slow walker.
2. **The shape of the gap differs.** In Singapore the question is *which* essential is missing — 14 %
   of residents are exactly one short, usually for healthcare (a clinic, hospital or pharmacy). In
   Johor Bahru it is *how many*: residents spread almost evenly from none to all six.
3. **Street structure matters.** Singapore has three times the junction density and four times the
   footpath share; from a typical home its walk reaches a larger share of the neighbours inside the
   circle.
4. **Part of the gap is the map, most is not.** OpenStreetMap lists a third as many clinics,
   hospitals and pharmacies per resident in Johor Bahru as Overture Places does. Re-running with
   Overture lifts Johor Bahru to 23.0 % (Singapore 89.5 %): the gap narrows by two points. Bus-stop recall against
   official lists is 92 % (Singapore) and 83 % (Johor Bahru) within 30 m.
5. **Older and slower walkers lose the most.** At 0.9 m/s Singapore's complete share falls by 20
   points — a design target for an ageing city.

## 9. Scenarios

**RTS Link — door to platform (regional, not a 15-minute measure).** Under central border
assumptions (15 min clearance per country, 20 min on the Causeway), the median Johor Bahru
resident needs 132 minutes from home to a Singapore MRT platform by public transport today, 124 with
the RTS Link, and 85 with a shared autonomous feeder to Bukit Chagar (6-minute wait, pooled rides).
The share within 90 minutes moves from 3 % to 9 % to 63 %. The RTS removes the Causeway queue, but
most of the trip happens before the border: buses with peak headways mostly of 20–40 minutes.
Readers can set their own border assumptions in the story.

**Parking to Proximity (local).** Converting mapped car parks of at least 2,000 m² into hubs
(grocer, clinic or pharmacy, childcare, eatery, bus stop; a park on sites over 1 ha), chosen
greedily for the most residents newly complete:

| Hubs per city | Singapore | Johor Bahru |
|---:|---:|---:|
| 0 (today) | 80.4 % | 12.0 % |
| 10 | 86.9 % (+264,200) | 16.7 % (+82,700) |
| 25 | 90.1 % (+393,500) | 20.8 % (+152,800) |
| 50 | 92.7 % (+497,000) | 24.4 % (+215,700) |

Returns diminish quickly in both cities. In Singapore much of the gain fills clinic gaps that are
partly a mapping artefact; in Johor Bahru, where the gaps are spread across the basket and only
425 car parks are mapped, 50 hubs lift complete access by 12 points but leave three in four
residents short.

**One footpath (local, one neighbourhood).** The smallest intervention changes the street network
itself. Every dead end of the Johor Bahru walk network was paired with points within 80 m in a
straight line that are at least 400 m further away on foot (9,893 pairs). Links that would cross a
building (2 m clearance), water, a river, canal or stream, a railway, a primary or trunk road,
another walkable way or a mapped wall or fence, or a school, hospital, cemetery, military or prison
site, were dropped, as were links ending on service roads, tracks or corridors, which mostly lead
into compounds (an early version picked a back gate into a private hospital's grounds); 1,488
remained. Because a shortest path uses a new edge at most once, each link was scored exactly from
the baseline distance fields and two bounded searches (checked against full recomputation in the
tests). The best is a 75 m path in Bukit Indah (Perling) between the end of Jalan Bestari 10/1 and
Jalan Penglin, 1,402 m apart on foot today: about 2,200 residents would gain an essential within 15
minutes and would then have all six. Most were one essential short, usually healthcare: for the
1,900 who gain it, the median walk to a clinic, hospital or pharmacy falls from 20 to 12 minutes. The gain is about 880 at a 10-minute limit and 1,600 at 0.9 m/s. It is a desk study: who
owns the strip, whether an unmapped wall or drain is in the way, and how residents of a quiet street
feel about opening it can only be checked on site, and the Story lists those checks.

## 10. Implications for future city design

1. **Design for the slowest walker.** Signal timing, crossing distances and kerb design for an
   autonomous era should be judged at 0.9 m/s.
2. **Make the network continuous before making it smart.** Sidewalk robots, wheelchairs and people
   need the same unbroken, mapped path; Johor Bahru's map rarely records pavements at all.
3. **Fix the trip to the border, not only the border.** The first kilometres are the slow part;
   kerbside pick-up and drop-off space at Bukit Chagar is infrastructure.
4. **Treat the kerb as the interface.** With autonomous fleets, boarding, alighting and deliveries
   concentrate at the kerb; it needs allocating and pricing where walk-sheds converge.
5. **Spend any parking dividend on proximity.** The best sites are not the largest but those whose
   walk-sheds reach homes one or two essentials short.
6. **Measure the network you have.** Open, reproducible measurement lets cities test interventions
   before building them.

## 11. Limitations

* OpenStreetMap completeness differs by category and country (bounded, not removed, by the audits).
* Presence is not service: capacity, price, hours and quality are not measured.
* Network distance is not walkability: heat, shade, crossings, gradients and safety are not modelled.
* Population inside census units is modelled; census definitions differ (residents vs all persons). The Findings section gives the bound.
* Gated estates: private roads are excluded, so residents inside them start from the nearest public street.
* Scenarios are explorations with stated assumptions, not forecasts.

## 12. Future possibilities

* Time-of-day accessibility with opening hours and service frequencies.
* Thermal comfort: shade and covered-walkway weighting for a tropical city.
* A fuller cross-border model with crossing-time distributions from observed queues.
* Validation of clinic coverage against Singapore's CHAS clinic register and Malaysian health
  facility lists.
* Coverage-aware scenarios that use Overture and OSM together.
