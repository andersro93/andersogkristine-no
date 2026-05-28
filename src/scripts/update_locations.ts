// src/scripts/update_locations.ts
/**
 * Script to bulk‑update location coordinates in the Notion Locations database.
 * Expected input file: `locations_updates.json` placed in the project root.
 * The JSON should be an array of objects with the shape:
 * [{ "id": "<Notion page ID>", "lat": <number>, "lng": <number> }, ...]
 */
import { bulkUpdateLocations } from "../services/notion";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const updatesPath = path.resolve(process.cwd(), "locations_updates.json");
  if (!fs.existsSync(updatesPath)) {
    console.error(`❌ Missing file: ${updatesPath}`);
    console.error(
      "Create a JSON file named 'locations_updates.json' with an array of {id, lat, lng} objects."
    );
    process.exit(1);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(updatesPath, "utf-8");
  } catch (e) {
    console.error(`❌ Unable to read ${updatesPath}:`, e);
    process.exit(1);
  }

  let updates: Array<{ id: string; lat: number; lng: number }>;
  try {
    updates = JSON.parse(raw);
    if (!Array.isArray(updates)) throw new Error("JSON is not an array");
  } catch (e) {
    console.error("❌ Invalid JSON format in locations_updates.json:", e);
    process.exit(1);
  }

  console.log(`🚀 Updating ${updates.length} location(s) in Notion…`);
  await bulkUpdateLocations(updates);
  console.log("✅ Done.");
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
