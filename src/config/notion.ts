/**
 * Mapping between Notion column names and app fields — the single place that
 * encodes the Notion schema. If a column is renamed in Notion, change it here.
 * (Column types noted for reference; the README "Notion schema expectations"
 * section mirrors this file.)
 */
export const notionConfig = {
  mappings: {
    invites: {
      code: "Kode", // rich_text — the invite code
      guests: "🧑‍🤝‍🧑 Gjester", // relation → Guests
      name: "Name", // title
    },
    guests: {
      name: "Navn", // title
      rsvp: "RSVP", // status (options: "Venter", "Kommer", "Kommer ikke")
      allergies: "Allergener", // multi_select
      table: "Bord", // relation → Tables
      invite: "Invitasjon", // relation → Invites
    },
    tables: {
      name: "Name", // title
      guests: "🧑‍🤝‍🧑 Gjester", // relation → Guests
    },
    program: {
      title: "Tittel", // title
      time: "Tidspunkt", // date
      description: "Beskrivelse", // rich_text
      published: "Webside", // select ("Ja" publishes the row)
      location: "Sted", // relation → Locations
    },
    faq: {
      question: "Spørsmål", // title
      answer: "Svar", // rich_text (basic formatting + bullet lines supported)
    },
    story: {
      title: "Tittel", // title
      content: "Beskrivelse", // rich_text
      date: "Dato", // date (year is shown; used for ordering)
    },
    contributors: {
      name: "Navn", // title
      role: "Role", // rich_text ("Toastmaster" marks toastmasters, "Forlover" marks forlovere)
      emoji: "Emoji", // rich_text
      email: "Email", // email
      photo: "Bilde", // files (local files under public/images win when present)
    },
    egentid: {
      title: "Tittel", // title
      description: "Beskrivelse", // rich_text
      contributor: "Medvirkende", // relation → Contributors (Medvirkende)
      location: "📍 Sted", // relation → Locations
    },
    locations: {
      name: "Name", // title
      lat: "Lat", // number
      lng: "Long", // number
      googleMaps: "Google Maps", // url
      zone: "Sone", // rich_text "lat,lng;lat,lng;…" (≥3 points draws a polygon)
      zoneColor: "Sone-farge", // select (blue|red|green|yellow|purple|orange|gray)
    },
    flags: {
      id: "Flagg Id", // title (case-insensitive flag key)
      enabled: "Aktivert", // select|status|rich_text — "Ja" enables
    },
  },

  // RSVP status values in Notion
  rsvpStatus: {
    pending: "Venter",
    attending: "Kommer",
    declined: "Kommer ikke",
  },
};
