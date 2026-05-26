import { Client } from '@notionhq/client';
import { env } from 'cloudflare:workers';
import { notionConfig } from '../config/notion';

// Cache for Data Source IDs in memory to avoid repeated metadata queries
const dataSourceIdCache = new Map<string, string>();

async function getDataSourceId(notion: Client, databaseId: string): Promise<string> {
  if (dataSourceIdCache.has(databaseId)) {
    return dataSourceIdCache.get(databaseId)!;
  }
  
  console.log(`Resolving data source ID for database: ${databaseId}`);
  const db = await notion.databases.retrieve({ database_id: databaseId });
  if ('data_sources' in db && db.data_sources && db.data_sources.length > 0) {
    const dsId = db.data_sources[0].id;
    dataSourceIdCache.set(databaseId, dsId);
    return dsId;
  }
  throw new Error(`No data source found for database container: ${databaseId}`);
}

// Helper to get Notion client based on environment
export function getNotionClient() {
  // Use the imported cloudflare workers env, or fallback to process.env in local CLI environments
  const apiKey = env?.NOTION_API_KEY || process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error("NOTION_API_KEY is not defined. Please add it to your .env file or Cloudflare environment variables.");
  }
  return new Client({ 
    auth: apiKey,
    notionVersion: '2025-09-03',
  });
}

export interface Guest {
  id: string;
  name: string;
  rsvp: string; // "Venter" | "Kommer" | "Kommer ikke"
  allergies: string;
  tableId?: string | null;
  tableName?: string | null;
}

export interface Invite {
  id: string;
  code: string;
  name: string;
  guests: Guest[];
}

// 1. Fetch Invite by Code
export async function fetchInviteByCode(code: string): Promise<Invite | null> {
  const notion = getNotionClient();
  
  try {
    const invitesDsId = await getDataSourceId(notion, notionConfig.databases.invitesId);

    // Query Invites database for matching code
    const invitesResponse = await notion.dataSources.query({
      data_source_id: invitesDsId,
      filter: {
        property: notionConfig.mappings.invites.code,
        rich_text: {
          equals: code.trim(),
        },
      },
    });

    if (invitesResponse.results.length === 0) {
      return null;
    }

    const invitePage = invitesResponse.results[0];
    if (!('properties' in invitePage)) {
      return null;
    }

    // Get basic invite details
    const nameProp = invitePage.properties[notionConfig.mappings.invites.name];
    const inviteName = nameProp?.type === 'title' ? nameProp.title?.[0]?.plain_text || "Invitasjon" : "Invitasjon";

    const codeProp = invitePage.properties[notionConfig.mappings.invites.code];
    const inviteCode = codeProp?.type === 'rich_text' ? codeProp.rich_text?.[0]?.plain_text || "" : "";

    // Fetch related guests
    const guestsRelation = invitePage.properties[notionConfig.mappings.invites.guests];
    const guestIds: string[] = [];
    if (guestsRelation?.type === 'relation' && guestsRelation.relation) {
      guestIds.push(...guestsRelation.relation.map(r => r.id));
    }

    // Fetch each guest in parallel
    const guests: Guest[] = [];
    if (guestIds.length > 0) {
      const guestPromises = guestIds.map(async (id) => {
        try {
          const guestPage = await notion.pages.retrieve({ page_id: id });
          if ('properties' in guestPage) {
            const guestNameProp = guestPage.properties[notionConfig.mappings.guests.name];
            const guestName = guestNameProp?.type === 'title' ? guestNameProp.title?.[0]?.plain_text || "" : "";

            const guestRsvpProp = guestPage.properties[notionConfig.mappings.guests.rsvp];
            const guestRsvp = guestRsvpProp?.type === 'status' ? guestRsvpProp.status?.name || notionConfig.rsvpStatus.pending : notionConfig.rsvpStatus.pending;

            const guestAllergiesProp = guestPage.properties[notionConfig.mappings.guests.allergies];
            const guestAllergies = guestAllergiesProp?.type === 'select' ? guestAllergiesProp.select?.name || "" : "";

            const guestTableProp = guestPage.properties[notionConfig.mappings.guests.table];
            const guestTableId = guestTableProp?.type === 'relation' && guestTableProp.relation?.[0]?.id || null;

            return {
              id: guestPage.id,
              name: guestName,
              rsvp: guestRsvp,
              allergies: guestAllergies,
              tableId: guestTableId,
            } as Guest;
          }
        } catch (err) {
          console.error(`Error fetching guest ${id}:`, err);
        }
        return null;
      });

      const guestResults = await Promise.all(guestPromises);
      guests.push(...(guestResults.filter(Boolean) as Guest[]));
    }

    return {
      id: invitePage.id,
      code: inviteCode,
      name: inviteName,
      guests,
    };
  } catch (error) {
    console.error("Error in fetchInviteByCode:", error);
    throw error;
  }
}

// 2. Update Guest RSVP & Allergies
export async function updateGuestRSVP(
  guestId: string, 
  rsvp: string, 
  allergies: string, 
  comment?: string
): Promise<void> {
  const notion = getNotionClient();

  try {
    const properties: any = {
      [notionConfig.mappings.guests.rsvp]: {
        status: {
          name: rsvp,
        },
      },
      [notionConfig.mappings.guests.allergies]: allergies.trim()
        ? { select: { name: allergies.trim() } }
        : { select: null },
    };

    // Try to update comments (song requests/messages) if they added a Kommentar field.
    // We use a safe try-catch so it won't crash if they don't have the column in their Notion table.
    if (comment && comment.trim()) {
      properties["Kommentar"] = {
        rich_text: [
          {
            text: {
              content: comment.trim(),
            },
          },
        ],
      };
    }

    await notion.pages.update({
      page_id: guestId,
      properties,
    });
  } catch (error) {
    console.error(`Error updating guest RSVP for ${guestId}:`, error);
    // If it failed because of "Kommentar" property (e.g. doesn't exist), retry without it
    if (comment && error instanceof Error && error.message.includes("Kommentar")) {
      console.log("Retrying update without 'Kommentar' column...");
      const propertiesRetry: any = {
        [notionConfig.mappings.guests.rsvp]: {
          status: {
            name: rsvp,
          },
        },
        [notionConfig.mappings.guests.allergies]: allergies.trim()
          ? { select: { name: allergies.trim() } }
          : { select: null },
      };
      await notion.pages.update({
        page_id: guestId,
        properties: propertiesRetry,
      });
    } else {
      throw error;
    }
  }
}

// 3. Fetch All Seating Data (for Tables and Seating Chart)
export interface TableWithGuests {
  id: string;
  name: string;
  guests: {
    id: string;
    name: string;
  }[];
}

export async function fetchAllSeatingData(): Promise<TableWithGuests[]> {
  const notion = getNotionClient();

  try {
    const tablesDsId = await getDataSourceId(notion, notionConfig.databases.tablesId);

    // A. Query all tables
    const tablesResponse = await notion.dataSources.query({
      data_source_id: tablesDsId,
    });

    const tablesMap = new Map<string, TableWithGuests>();
    
    for (const page of tablesResponse.results) {
      if ('properties' in page) {
        const nameProp = page.properties[notionConfig.mappings.tables.name];
        const tableName = nameProp?.type === 'title' ? nameProp.title?.[0]?.plain_text || "Bord" : "Bord";
        
        tablesMap.set(page.id, {
          id: page.id,
          name: tableName,
          guests: [],
        });
      }
    }

    const guestsDsId = await getDataSourceId(notion, notionConfig.databases.guestsId);

    // B. Query all attending guests
    const guestsResponse = await notion.dataSources.query({
      data_source_id: guestsDsId,
      filter: {
        property: notionConfig.mappings.guests.rsvp,
        status: {
          equals: notionConfig.rsvpStatus.attending, // Only pull guests who are attending
        },
      },
      page_size: 100, // Adjust as necessary
    });

    // C. Map guests to their respective tables
    for (const page of guestsResponse.results) {
      if ('properties' in page) {
        const nameProp = page.properties[notionConfig.mappings.guests.name];
        const guestName = nameProp?.type === 'title' ? nameProp.title?.[0]?.plain_text || "" : "";
        
        const tableProp = page.properties[notionConfig.mappings.guests.table];
        if (tableProp?.type === 'relation' && tableProp.relation && tableProp.relation.length > 0) {
          const tableId = tableProp.relation[0].id;
          const table = tablesMap.get(tableId);
          if (table) {
            table.guests.push({
              id: page.id,
              name: guestName,
            });
          }
        }
      }
    }

    // Sort guests alphabetically within each table so seating layout looks neat and searchable
    const tables = Array.from(tablesMap.values());
    for (const table of tables) {
      table.guests.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    }

    // Sort tables by name (e.g. Bord 1, Bord 2...)
    tables.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    return tables;
  } catch (error) {
    console.error("Error in fetchAllSeatingData:", error);
    throw error;
  }
}
