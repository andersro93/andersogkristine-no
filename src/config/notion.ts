export const notionConfig = {
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
