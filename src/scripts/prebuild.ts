import * as fs from "node:fs";
import * as path from "node:path";
import type {
  Contributor,
  FaqItem,
  ScheduleEvent,
  StoryItem,
  TableWithGuests,
  WeddingLocation,
} from "../services/notion";

const FALLBACK_FILE = path.join(
  process.cwd(),
  "src/config/notion-fallback.json",
);

// Bootstrap the fallback file if it doesn't exist yet to prevent import errors in services/notion.ts
if (!fs.existsSync(FALLBACK_FILE)) {
  console.log(
    "Bootstrap: notion-fallback.json does not exist. Creating default dummy to prevent loader crash...",
  );
  fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });
  fs.writeFileSync(
    FALLBACK_FILE,
    JSON.stringify(
      {
        schedule: [],
        egentid: { contributors: [] },
        faqs: [],
        locations: [],
        seating: [],
        flags: {},
        story: [],
      },
      null,
      2,
    ),
    "utf-8",
  );
}

interface FallbackData {
  schedule: ScheduleEvent[];
  egentid: { contributors: Contributor[] };
  faqs: FaqItem[];
  locations: WeddingLocation[];
  seating: TableWithGuests[];
  flags: Record<string, boolean>;
  story?: StoryItem[];
}

async function downloadImage(url: string, id: string): Promise<string> {
  // If it's already a local path, return as is
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return url;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Fetch failed with status ${res.status}`);
    }

    // Determine extension from content-type or url
    const contentType = res.headers.get("content-type") || "";
    let ext = "webp";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      ext = "jpg";
    } else if (contentType.includes("png")) {
      ext = "png";
    } else if (contentType.includes("gif")) {
      ext = "gif";
    } else {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      if (match) {
        ext = match[1];
      }
    }

    const dir = path.join(process.cwd(), "public/images/egentid/downloads");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filename = `${id}.${ext}`;
    const filePath = path.join(dir, filename);

    const arrayBuffer = await res.arrayBuffer();
    await Bun.write(filePath, arrayBuffer);
    console.log(
      `Downloaded image for contributor ${id} to public/images/egentid/downloads/${filename}`,
    );

    return `/images/egentid/downloads/${filename}`;
  } catch (err: any) {
    console.warn(
      `⚠️ Warning: Failed to download contributor image for ${id}:`,
      err.message || err,
    );
    return url;
  }
}

async function run() {
  console.log("--- Notion Pre-build: Syncing Static Fallbacks ---");

  // Dynamic import of services to avoid importing notion.ts statically before fallback is generated
  const {
    fetchAllSeatingData,
    fetchEgentidData,
    fetchFaqFromNotion,
    fetchFeatureFlags,
    fetchLocationsFromNotion,
    fetchScheduleFromNotion,
    fetchStoryFromNotion,
  } = await import("../services/notion");

  // 1. Load existing data if available
  let existingData: FallbackData = {
    schedule: [],
    egentid: { contributors: [] },
    faqs: [],
    locations: [],
    seating: [],
    flags: {},
  };
  if (fs.existsSync(FALLBACK_FILE)) {
    try {
      existingData = {
        ...existingData,
        ...JSON.parse(fs.readFileSync(FALLBACK_FILE, "utf-8")),
      };
    } catch {
      // Ignore parse errors, start fresh
    }
  }

  // 2. Fetch fresh data from Notion
  // If NOTION_API_KEY is not defined, we skip the queries gracefully
  if (!process.env.NOTION_API_KEY) {
    console.warn(
      "⚠️ Warning: NOTION_API_KEY is not defined in the environment. Skipping Notion prebuild sync.",
    );
    return;
  }

  try {
    console.log("Syncing schedule timeline...");
    const schedule = await fetchScheduleFromNotion();
    if (schedule && schedule.length > 0) {
      existingData.schedule = schedule;
      console.log(`Fetched ${schedule.length} schedule items.`);
    }
  } catch (err: any) {
    console.warn(
      "⚠️ Warning: Failed to pre-fetch schedule timeline:",
      err.message || err,
    );
  }

  try {
    console.log("Syncing Egentid recommendations...");
    const contributors = await fetchEgentidData();
    if (contributors && contributors.length > 0) {
      const localizedContributors = [];
      for (const contributor of contributors) {
        const localPhoto = await downloadImage(
          contributor.photo,
          contributor.id,
        );
        localizedContributors.push({
          ...contributor,
          photo: localPhoto,
        });
      }
      existingData.egentid.contributors = localizedContributors;
      console.log(
        `Fetched ${contributors.length} Egentid contributors and localized images.`,
      );
    }
  } catch (err: any) {
    console.warn(
      "⚠️ Warning: Failed to pre-fetch Egentid contributors:",
      err.message || err,
    );
  }

  try {
    console.log("Syncing FAQs...");
    const faqs = await fetchFaqFromNotion();
    if (faqs && faqs.length > 0) {
      existingData.faqs = faqs;
      console.log(`Fetched ${faqs.length} FAQ items.`);
    }
  } catch (err: any) {
    console.warn("⚠️ Warning: Failed to pre-fetch FAQs:", err.message || err);
  }

  try {
    console.log("Syncing Locations (Steder)...");
    const locations = await fetchLocationsFromNotion();
    if (locations && locations.length > 0) {
      existingData.locations = locations;
      console.log(`Fetched ${locations.length} locations.`);
    }
  } catch (err: any) {
    console.warn(
      "⚠️ Warning: Failed to pre-fetch locations:",
      err.message || err,
    );
  }

  try {
    console.log("Syncing Seating (Bord)...");
    const seating = await fetchAllSeatingData();
    if (seating && seating.length > 0) {
      existingData.seating = seating;
      console.log(`Fetched ${seating.length} tables with guests.`);
    }
  } catch (err: any) {
    console.warn(
      "⚠️ Warning: Failed to pre-fetch seating data:",
      err.message || err,
    );
  }

  try {
    console.log("Syncing Feature Flags...");
    const flags = await fetchFeatureFlags();
    if (flags && Object.keys(flags).length > 0) {
      existingData.flags = flags;
      console.log(`Fetched ${Object.keys(flags).length} feature flags.`);
    }
  } catch (err: any) {
    console.warn(
      "⚠️ Warning: Failed to pre-fetch feature flags:",
      err.message || err,
    );
  }

  try {
    console.log("Syncing Our Story (Historie)...");
    const story = await fetchStoryFromNotion();
    if (story && story.length > 0) {
      existingData.story = story;
      console.log(`Fetched ${story.length} story items.`);
    }
  } catch (err: any) {
    console.warn(
      "⚠️ Warning: Failed to pre-fetch story items:",
      err.message || err,
    );
  }

  // 3. Write data back to file
  try {
    fs.writeFileSync(
      FALLBACK_FILE,
      JSON.stringify(existingData, null, 2),
      "utf-8",
    );
    console.log(
      "--- Notion Pre-build: Static fallbacks written successfully ---",
    );
  } catch (err) {
    console.error("❌ Error: Failed to write fallback file:", err);
  }
}

run().catch((err) => {
  console.error("❌ Notion Pre-build script crashed:", err);
});
