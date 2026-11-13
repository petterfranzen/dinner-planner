// tsc only emits compiled JS, so schema.sql would be missing from dist/ and
// `node dist/index.js` would crash on a non-Docker start. Copy it next to the
// compiled db.js so `npm run build && npm start` works without Docker.
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
copyFileSync(join(here, "..", "src", "schema.sql"), join(here, "..", "dist", "schema.sql"));
