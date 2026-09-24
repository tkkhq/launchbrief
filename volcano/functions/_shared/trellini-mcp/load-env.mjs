/**
 * Must be the first import in index.ts and depend on nothing else in this
 * package. ES modules evaluate all of a file's imports, in the order
 * listed, before that file's own body runs — so if this logic lived inline
 * in index.ts, `volcano.ts`'s module-level `requireEnv()` calls (from a
 * later import in the same file) would already have run and thrown before
 * this ever got a chance to populate process.env. Importing this as its own
 * dependency-free module first forces it to finish before volcano.ts's
 * import is even reached.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, '..', '.env') });
