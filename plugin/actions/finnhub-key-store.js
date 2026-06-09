import path from "path";
import { promises as fs } from "fs";

import { Utils } from "./ulanzi-api/index.js";

const LEGACY_STORE_PATH = path.join(Utils.getPluginPath(), "data", "finnhub-key.json");
const STORE_PATH = path.join(Utils.getPluginPath(), "finnhub-key.json");

function normalizeKey(key) {
  return String(key || "").trim();
}

export async function readStoredFinnhubKey() {
  for (const filePath of [STORE_PATH, LEGACY_STORE_PATH]) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const json = JSON.parse(content);
      const key = normalizeKey(json?.finnhub_api_key);
      if (key) {
        return key;
      }
    } catch (error) {
      // ignore missing or invalid files and try the next candidate
    }
  }

  return "";
}

export async function saveStoredFinnhubKey(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return "";
  }

  await fs.writeFile(
    STORE_PATH,
    JSON.stringify(
      {
        finnhub_api_key: normalizedKey,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  return normalizedKey;
}
