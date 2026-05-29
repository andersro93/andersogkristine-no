import notionFallback from "./config/notion-fallback.json";

export const weddingConfig = {
  names: {
    groom: "Anders",
    bride: "Kristine",
    ampersand: "og",
    fullTitle: "Kristine & Anders",
  },
  date: {
    iso: "2026-09-26T11:00:00",
    displayDate: "Lørdag 26. September 2026",
    displayTime: "Kl. 11:00",
  },
  venue: {
    name: "Tårnet Kulturarena",
    city: "Oslo, Norge",
    address: "Kabelgata 51, 0581 Oslo",
    googleMapsLink: "https://maps.google.com/?q=Tårnet+Kulturarena,+Oslo",
    embedMapSrc:
      "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2754.258417190076!2d10.816381977151805!3d59.926990474909225!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x46416fb7de792a47%3A0x5971fe1774ec4171!2sT%C3%A5rnet%20Kulturarena!5e1!3m2!1sno!2sno!4v1779748057725!5m2!1sno!2sno",
  },
  toastmaster: {
    name: (notionFallback as any).toastmaster?.name,
    contact:
      (notionFallback as any).toastmaster?.email &&
      (notionFallback as any).toastmaster?.phone
        ? `${(notionFallback as any).toastmaster.email} / ${(notionFallback as any).toastmaster.phone}`
        : (notionFallback as any).toastmaster?.email ||
          (notionFallback as any).toastmaster?.phone,
    info: "Meld gjerne ifra om taler eller innslag innen 1. juli.",
  },
  story: (notionFallback as any).story || [],
  schedule: notionFallback.schedule || [],
  accommodations: [
    {
      name: "Quality Hotel™ 33",
      distance: "5 min unna",
      description:
        "Hotellet er et prisvinnende designhotell på Økern i Oslo, bare en kort t-banetur fra alt byen har å by på. Hotellet ligger også 5 minutter gange fra selskapslokalene.",
      link: "https://www.strawberry.no/hotell/norge/oslo/quality-hotel-33",
    },
  ],
  faqs: notionFallback.faqs || [],
  egentid: {
    title: "Egentid",
    subtitle: "Tid til å utforske nabolaget",
    description:
      "Mellom vielsen og festen åpner er det et lite opphold mens brudeparet fotograferes. Vi oppfordrer dere til å utforske det fantastiske nærområdet vårt! Klikk på bildene under for å se våre personlige anbefalinger til kafeer, lekeplasser og turstier.",
    contributors: notionFallback.egentid?.contributors || [],
  },
};
export type WeddingConfig = typeof weddingConfig;
