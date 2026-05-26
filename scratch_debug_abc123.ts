import { Client } from '@notionhq/client';
import { notionConfig } from './src/config/notion';
import { fetchInviteByCode } from './src/services/notion';

async function main() {
  const code = "abc123";
  console.log("Fetching invite with code:", code);
  try {
    const invite = await fetchInviteByCode(code);
    console.log("Invite query result:", JSON.stringify(invite, null, 2));
  } catch (error) {
    console.error("Failed to query invite:", error);
  }
}

main();
