import { fileURLToPath } from "node:url";
// Share the downloaded local test binary across suites and child processes.
process.env.MONGOMS_DOWNLOAD_DIR = fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url));
