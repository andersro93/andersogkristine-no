import type { PageObjectResponse } from "@notionhq/client";
import { notionConfig } from "../../config/notion";
import { getDataSourceId } from "../cache";
import {
  getMultiSelectProperty,
  getNotionClient,
  getRelationIds,
  getRichTextProperty,
  getSelectProperty,
  getTitleProperty,
  type NotionSelectItem,
  requireDatabaseId,
} from "./shared";

/**
 * Reads the allergy property as a list of items. Accepts both the current
 * multi_select type and the legacy select type, so guests who answered before
 * the Notion column was converted still see their answer.
 */
function getAllergyItems(prop: any): string[] {
  if (prop?.type === "multi_select") {
    return getMultiSelectProperty(prop);
  }
  const legacy = getSelectProperty(prop);
  return legacy ? [legacy] : [];
}

// Notion rejects commas in select/multi_select option names, and caps the name
// at 100 characters.
const ALLERGY_ITEM_MAX_LENGTH = 100;
const ALLERGY_ITEM_MAX_COUNT = 20;

/**
 * Normalises untrusted allergy input into names Notion will accept: splits on
 * commas, trims, drops empties, truncates, and removes case-insensitive
 * duplicates while keeping the first spelling.
 */
export function sanitizeAllergyItems(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of items) {
    if (typeof raw !== "string") {
      continue;
    }
    for (const part of raw.split(",")) {
      const name = part.trim().slice(0, ALLERGY_ITEM_MAX_LENGTH);
      if (!name) {
        continue;
      }
      const key = name.toLocaleLowerCase("nb");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(name);
      if (result.length >= ALLERGY_ITEM_MAX_COUNT) {
        return result;
      }
    }
  }

  return result;
}

export interface Guest {
  id: string;
  name: string;
  rsvp: string; // "Venter" | "Kommer" | "Kommer ikke"
  allergies: string[]; // multi_select option names
  tableId?: string | null;
  tableName?: string | null;
}

export interface Invite {
  id: string;
  code: string;
  name: string;
  guests: Guest[];
}

export async function fetchInviteByCode(
  code: string,
  env: Env,
): Promise<Invite | null> {
  const notion = getNotionClient(env);

  try {
    const invitesDsId = await getDataSourceId(
      notion,
      requireDatabaseId(env, "NOTION_INVITES_DATABASE_ID"),
      env,
    );

    const invitesResponse = await notion.dataSources.query({
      data_source_id: invitesDsId,
      filter: {
        property: notionConfig.mappings.invites.code,
        rich_text: { equals: code.trim() },
      },
    });

    if (invitesResponse.results.length === 0) {
      return null;
    }

    const invitePage = invitesResponse.results[0];
    if (!("properties" in invitePage)) {
      return null;
    }

    const inviteName = getTitleProperty(
      invitePage.properties[notionConfig.mappings.invites.name],
      "Invitasjon",
    );
    const inviteCode = getRichTextProperty(
      invitePage.properties[notionConfig.mappings.invites.code],
    );
    const guestIds = getRelationIds(
      invitePage.properties[notionConfig.mappings.invites.guests],
    );

    const guestResults = await Promise.all(
      guestIds.map(async (id): Promise<Guest | null> => {
        try {
          const guestPage = (await notion.pages.retrieve({
            page_id: id,
          })) as PageObjectResponse;
          if (!("properties" in guestPage)) return null;

          const props = guestPage.properties;
          const guestRsvpProp = props[notionConfig.mappings.guests.rsvp];
          const guestRsvp =
            guestRsvpProp?.type === "status"
              ? guestRsvpProp.status?.name || notionConfig.rsvpStatus.pending
              : notionConfig.rsvpStatus.pending;

          return {
            id: guestPage.id,
            name: getTitleProperty(props[notionConfig.mappings.guests.name]),
            rsvp: guestRsvp,
            allergies: getAllergyItems(
              props[notionConfig.mappings.guests.allergies],
            ),
            tableId:
              getRelationIds(props[notionConfig.mappings.guests.table])[0] ??
              null,
          };
        } catch (err) {
          console.error(`Error fetching guest ${id}:`, err);
          return null;
        }
      }),
    );

    return {
      id: invitePage.id,
      code: inviteCode,
      name: inviteName,
      guests: guestResults.filter((g): g is Guest => g !== null),
    };
  } catch (error) {
    console.error("Error in fetchInviteByCode:", error);
    throw error;
  }
}

/**
 * Update a guest's RSVP status and allergies.
 * `allergies` are Notion multi_select option names; unknown names are created
 * by Notion on write (the couple reviews them before they go to the kitchen).
 */
export async function updateGuestRSVP(
  guestId: string,
  rsvp: string,
  allergies: string[],
  env: Env,
): Promise<void> {
  const notion = getNotionClient(env);

  try {
    await notion.pages.update({
      page_id: guestId,
      properties: {
        [notionConfig.mappings.guests.rsvp]: { status: { name: rsvp } },
        [notionConfig.mappings.guests.allergies]: {
          multi_select: sanitizeAllergyItems(allergies).map((name) => ({
            name,
          })),
        },
      } as any,
    });
  } catch (error) {
    console.error(`Error updating guest RSVP for ${guestId}:`, error);
    throw error;
  }
}

/**
 * Reads the existing option names off the allergy property so the RSVP form can
 * offer them back as suggestions. Keeping guests on the existing spellings is
 * what stops the option list from fragmenting.
 *
 * Under notionVersion 2025-09-03 the property schema lives on the data source,
 * not on the database container. Returns [] on any failure — the chip input
 * still works without suggestions, and this must never break the RSVP page.
 */
export async function fetchAllergyOptions(env: Env): Promise<string[]> {
  try {
    const notion = getNotionClient(env);
    const guestsDsId = await getDataSourceId(
      notion,
      requireDatabaseId(env, "NOTION_GUESTS_DATABASE_ID"),
      env,
    );

    const dataSource: any = await notion.dataSources.retrieve({
      data_source_id: guestsDsId,
    });

    const prop =
      dataSource?.properties?.[notionConfig.mappings.guests.allergies];
    // Accept the legacy select type so suggestions work before the conversion.
    const options: NotionSelectItem[] =
      prop?.multi_select?.options ?? prop?.select?.options ?? [];

    return options
      .map((option) => option.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "nb"));
  } catch (error) {
    console.error("Error fetching allergy options:", error);
    return [];
  }
}
