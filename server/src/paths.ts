import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root (server/src → server → repo). */
export const REPO = resolve(here, "..", "..");

/** The committed pipeline outputs. Read-only: the ingest never writes here. */
export const DATA = resolve(REPO, "web", "public", "data");

/** Where the built database lives. Disposable — rebuilt by `npm run ingest`. */
export const DB_PATH = process.env.SGJB_DB ?? resolve(here, "..", "data", "sgjb.db");
