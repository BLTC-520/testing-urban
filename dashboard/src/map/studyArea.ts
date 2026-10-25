/**
 * The study area as [west, south, east, north] in degrees: the pipeline's
 * acquisition box (config/study_area.yml), which holds both cities and the
 * strait between them with a margin.
 *
 * The map's camera is kept inside it, and 3D building tiles outside it are
 * never requested — a wall display about Singapore and Johor Bahru has no use
 * for Batam's rooftops on the horizon.
 */
export type Bounds = [west: number, south: number, east: number, north: number];

export const STUDY_AREA: Bounds = [103.3, 1.1, 104.3, 1.85];
