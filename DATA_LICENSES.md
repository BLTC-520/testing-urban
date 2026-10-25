# Data licences and attribution

The **code** in this repository is released under the MIT licence (see `LICENSE`).
The **data** it downloads and the derived files it publishes (`data/derived/`, `web/public/data/`,
`web/public/tiles/`) remain subject to the licences of their sources, listed below.
Anyone republishing the site or its data must keep these attributions.

| Source | Provider | Licence | Required attribution |
|---|---|---|---|
| OpenStreetMap planet, snapshot 2026-10-05 | OpenStreetMap Foundation | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | © OpenStreetMap contributors |
| High Resolution Settlement Layer v1.5.5 (general, elderly 60+) | Meta Data for Good & CIESIN, Columbia University | CC BY 4.0 | Data for Good at Meta & CIESIN — High Resolution Population Density Maps |
| Kontur Population (H3 r8), 2023-11-01 | Kontur | CC BY 4.0 | Kontur Population: Global Population Density for 400m H3 Hexagons |
| Population and Housing Census of Malaysia 2020, by state constituency | Department of Statistics Malaysia (DOSM) | Malaysia Open Data terms (attribution) | Department of Statistics Malaysia (DOSM), Census 2020 |
| Electoral and district boundaries | DOSM | Malaysia Open Data terms (attribution) | Department of Statistics Malaysia (DOSM) |
| Master Plan 2019 Planning Area Boundary (No Sea) | URA via data.gov.sg | Singapore Open Data Licence v1.0 | Contains information from Master Plan 2019 Planning Area Boundary (No Sea) accessed from data.gov.sg |
| Census of Population 2020, residents by subzone | SingStat via data.gov.sg | Singapore Open Data Licence v1.0 | Contains information from the Census of Population 2020 accessed from data.gov.sg |
| Singapore residents by subzone and age group, June 2020 | SingStat | Singapore Open Data Licence v1.0 | Singapore Department of Statistics |
| Tourist Attractions | Singapore Tourism Board via data.gov.sg | Singapore Open Data Licence v1.0 | Contains information from Tourist Attractions accessed from data.gov.sg |
| Rapid Transit System Station layer (April 2025) | LTA DataMall | Singapore Open Data Licence v1.0 | Contains information from LTA DataMall |
| Master Plan 2019 Rail Station layer | URA via data.gov.sg | Singapore Open Data Licence v1.0 | Contains information from Master Plan 2019 Rail Station layer accessed from data.gov.sg |
| Bus stops (sgbusdata compilation of LTA DataMall) | LTA DataMall / sgbusdata | Singapore Open Data Licence v1.0 | Contains information from LTA DataMall |
| ESA WorldCover 10 m 2021 v200 | ESA WorldCover consortium | CC BY 4.0 | © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) |
| Overture Maps Places, release 2026-09-23.1 | Overture Maps Foundation | CDLA-Permissive-2.0 | © Overture Maps Foundation (Places: Meta, Microsoft, Foursquare and others) |
| myBAS Johor Bahru GTFS Static | data.gov.my (Malaysia Official Open API) | Malaysia Open Data terms (attribution) | Malaysia Official Open API (data.gov.my) |
| KTMB GTFS Static | data.gov.my (Malaysia Official Open API) | Malaysia Open Data terms (attribution) | Malaysia Official Open API (data.gov.my) |

The Tourist Attractions layer is used only to anchor the 3D landmarks on the command-centre map —
it supplies the published point for a dozen of them, which `scripts/landmarks/footprints.py` then
snaps to an OpenStreetMap footprint where one contains it. It plays no part in the accessibility
analysis.

**Share-alike.** Files derived from OpenStreetMap (street-graph tiles, destination tables, the basemap
and the accessibility tables computed from them) are a *Derivative Database* under the ODbL and are
offered under the ODbL 1.0 with attribution to OpenStreetMap contributors.

Machine-readable details — URLs, mirrors, checksums and retrieval times — are in
`config/sources.yml` and `data/provenance.json`.

## Reference photographs for the 3D landmarks

The twelve landmark models on the command-centre map are modelled from published dimensions, from
the OpenStreetMap footprints already listed above, and from the colours of a handful of night
photographs. **The photographs are not redistributed in this repository**: they are hosted in
third-party GitHub repositories that state no licence, so only the URLs and the numbers derived
from them are committed, in `scripts/landmarks/sources.json` and `scripts/landmarks/refs/`.

The Johor Bahru side is thinner than the Singapore side, which is worth saying rather than hiding:
one usable night photograph of the Causeway and the city behind it, against eight for Marina Bay.
The models of Bangunan Sultan Ibrahim, the state mosque, Komtar JBCC and The Astaka are built from
published descriptions and dimensions alone. That asymmetry in available material runs alongside
the asymmetry in mapping that the study measures directly.

What is derived is a palette and a silhouette profile — cluster centres of pixel colours, and the
lit width of the structure band by band. Neither reproduces the image. `scripts/landmarks/fetch_refs.sh`
re-downloads the originals for anyone who wants to repeat the analysis, and substituting your own
photographs changes only the colours, not the geometry.

The models themselves (`dashboard/public/models/*.glb`) are original work generated by
`scripts/landmarks/build_models.py` and carry this repository's MIT licence. They are
representations of buildings, not copies of any model of them; where a landmark's *position* or
*bearing* came from an OpenStreetMap footprint that is noted in the manifest, and the ODbL
attribution above covers it.
