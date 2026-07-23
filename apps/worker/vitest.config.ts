import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The monorepo .env lives at the repo root, but vitest runs from this package
// and does not walk up to find it. Load it here so importing @signal/shared
// (which parses REDIS_URL/DATABASE_URL at module load) succeeds without extra
// dependencies.
const rootEnvPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.env",
);

const env: Record<string, string> = {};
try {
  for (const line of readFileSync(rootEnvPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    env[key] = value;
  }
} catch {
  // No root .env present; rely on the ambient environment instead.
}

export default defineConfig({
  test: { env },
});
