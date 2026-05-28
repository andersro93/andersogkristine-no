export const notionConfig = {
  // Database IDs (fallback to process.env during local dev)
  databases: {
    invitesId:
      process.env.NOTION_INVITES_DATABASE_ID ||
      "36c8d3696e2d801493eefe611eb2f646",
    guestsId:
      process.env.NOTION_GUESTS_DATABASE_ID ||
      "2e68d3696e2d8086a009ea4e06c26cdc",
    tablesId:
      process.env.NOTION_TABLES_DATABASE_ID ||
      "36c8d3696e2d80698c3ddea712dda88f",
    programId:
      process.env.NOTION_PROGRAM_DATABASE_ID ||
      "2e68d3696e2d80cca2cafe8e90fedd96",
    locationsId:
      process.env.NOTION_LOCATIONS_DATABASE_ID ||
      "36e8d3696e2d80999344e01768cb51d3",
  },

  // Data Source IDs (used in modern 2026 Notion API query & retrieve endpoints)
  dataSources: {
    invitesDsId: "36c8d369-6e2d-8032-a574-000bd5ad3f22",
    guestsDsId: "2e68d369-6e2d-80e0-aea4-000bbbeacda4",
    tablesDsId: "36c8d369-6e2d-80f7-9de2-000bc538baa2",
  },

  // Mappings between Notion columns and app keys
  mappings: {
    invites: {
      code: "Kode", // rich_text
      guests: "🧑‍🤝‍🧑 Gjester", // relation
      name: "Name", // title
    },
    guests: {
      name: "Navn", // title
      rsvp: "RSVP", // status (options: "Venter", "Kommer", "Kommer ikke")
      allergies: "Allergener", // select
      table: "Bord", // relation to Tables database
      invite: "Invitasjon", // relation to Invites database
    },
    tables: {
      name: "Name", // title
      guests: "🧑‍🤝‍🧑 Gjester", // relation to Guests database
    },
  },

  // RSVP status values in Notion
  rsvpStatus: {
    pending: "Venter",
    attending: "Kommer",
    declined: "Kommer ikke",
  },
};
