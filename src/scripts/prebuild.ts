import * as fs from 'fs';
import * as path from 'path';
import { fetchScheduleFromNotion, fetchEgentidData, fetchFaqFromNotion } from '../services/notion';
import type { ScheduleEvent, Contributor, FaqItem } from '../services/notion';

const FALLBACK_FILE = path.join(process.cwd(), 'src/config/notion-fallback.json');

async function run() {
  console.log('--- Notion Pre-build: Syncing Static Fallbacks ---');
  
  // 1. Load existing data if available
  let existingData: {
    schedule: ScheduleEvent[];
    egentid: {
      contributors: Contributor[];
    };
    faqs: FaqItem[];
  } = { schedule: [], egentid: { contributors: [] }, faqs: [] };
  if (fs.existsSync(FALLBACK_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf-8'));
    } catch {
      // Ignore parse errors, start fresh
    }
  }

  // 2. Fetch fresh data from Notion
  // If NOTION_API_KEY is not defined, we skip the queries gracefully
  if (!process.env.NOTION_API_KEY) {
    console.warn('⚠️ Warning: NOTION_API_KEY is not defined in the environment. Skipping Notion prebuild sync.');
    return;
  }

  try {
    console.log('Syncing schedule timeline...');
    const schedule = await fetchScheduleFromNotion();
    if (schedule && schedule.length > 0) {
      existingData.schedule = schedule;
      console.log(`Fetched ${schedule.length} schedule items.`);
    }
  } catch (err: any) {
    console.warn('⚠️ Warning: Failed to pre-fetch schedule timeline:', err.message || err);
  }

  try {
    console.log('Syncing Egentid recommendations...');
    const contributors = await fetchEgentidData();
    if (contributors && contributors.length > 0) {
      existingData.egentid.contributors = contributors;
      console.log(`Fetched ${contributors.length} Egentid contributors.`);
    }
  } catch (err: any) {
    console.warn('⚠️ Warning: Failed to pre-fetch Egentid contributors:', err.message || err);
  }

  try {
    console.log('Syncing FAQs...');
    const faqs = await fetchFaqFromNotion();
    if (faqs && faqs.length > 0) {
      existingData.faqs = faqs;
      console.log(`Fetched ${faqs.length} FAQ items.`);
    }
  } catch (err: any) {
    console.warn('⚠️ Warning: Failed to pre-fetch FAQs:', err.message || err);
  }

  // 3. Write data back to file
  try {
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(existingData, null, 2), 'utf-8');
    console.log('--- Notion Pre-build: Static fallbacks written successfully ---');
  } catch (err) {
    console.error('❌ Error: Failed to write fallback file:', err);
  }
}

run().catch((err) => {
  console.error('❌ Notion Pre-build script crashed:', err);
});
