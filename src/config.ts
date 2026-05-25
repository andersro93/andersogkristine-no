export const weddingConfig = {
  names: {
    groom: "Anders",
    bride: "Kristine",
    ampersand: "og", // "og" in Norwegian
    fullTitle: "Kristine & Anders"
  },
  date: {
    iso: "2026-08-15T14:00:00", // ISO date string for countdown timer
    displayDate: "Lørdag 15. August 2026",
    displayTime: "Kl. 14:00",
  },
  venue: {
    name: "Herregården Hallen",
    city: "Oslo, Norge",
    address: "Herregårdsveien 42, 1150 Oslo",
    googleMapsLink: "https://maps.google.com/?q=Herregårdsveien+42,+Oslo",
    embedMapSrc: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2002.5!2d10.79!3d59.91!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x46416e50!2sOslo!5e0!3m2!1sno!2sno!4v1"
  },
  toastmaster: {
    name: "Morten Hansen",
    contact: "toastmaster@example.com / +47 999 99 999",
    info: "Meld gjerne ifra om taler eller innslag innen 1. juli."
  },
  story: [
    {
      year: "2018",
      title: "Vårt første møte",
      content: "Vi møttes på en solrik sommerdag i Oslo, og siden har vi vært uadskillelige."
    },
    {
      year: "2022",
      title: "Samboere",
      content: "Vi flyttet inn i vår første felles leilighet og lærte at begge elsker morgenkaffe."
    },
    {
      year: "2025",
      title: "Forlovet!",
      content: "Under en gåtur i fjellet gikk Anders ned på kne. Kristine sa ja før han i det hele tatt rakk å spørre."
    }
  ],
  schedule: [
    {
      time: "14:00",
      title: "Vielse",
      description: "Vielsen finner sted i den vakre hagen bak herregården. Oppmøte senest kl 13:45.",
      icon: "ring"
    },
    {
      time: "15:00",
      title: "Mottakelse & Champagne",
      description: "Mingling, fingermat og bobler i glasset mens brudeparet tar bilder.",
      icon: "glass"
    },
    {
      time: "17:00",
      title: "Middag",
      description: "Tre-retters festmiddag i storsalen. Taler og underholdning koordineres av toastmaster.",
      icon: "food"
    },
    {
      time: "21:30",
      title: "Kake & Kaffe",
      description: "Kakeskjæring fulgt av nytraktet kaffe og avec.",
      icon: "cake"
    },
    {
      time: "22:30",
      title: "Fest & Dans",
      description: "Brudevals, DJ, åpen bar og dans ut i de sene nattetimer.",
      icon: "music"
    }
  ],
  accommodations: [
    {
      name: "Grand Hotel Oslo",
      distance: "15 min unna",
      description: "Hotell midt i sentrum med rabatterte priser for bryllupsgjester ved bruk av kode 'K&A2026'.",
      link: "https://grand.no"
    },
    {
      name: "Villa Sandviken B&B",
      distance: "5 min unna",
      description: "Et koselig overnattingssted rett i nærheten av selskapslokalet.",
      link: "https://villasandviken.no"
    }
  ],
  registry: {
    description: "Vårt største ønske er å feire dagen sammen med dere. Om dere likevel ønsker å gi en gave, har vi opprettet gavelister hos følgende butikker:",
    links: [
      { store: "Illums Bolighus", url: "https://www.illumsbolighus.no" },
      { store: "Kitch'n (Gaveliste #4298)", url: "https://www.kitchn.no" }
    ]
  },
  faqs: [
    {
      question: "Hva er kleskoden for bryllupet?",
      answer: "Kleskoden er Mørk Dress / Smoking. Vi ønsker at alle pynter seg for anledningen!"
    },
    {
      question: "Kan vi ta med barna våre?",
      answer: "Vi ønsker å feire denne dagen med voksne. Barn er velkommen til vielsen, men selve middagen og festen blir en barnefri feiring."
    },
    {
      question: "Når er RSVP-fristen?",
      answer: "Vennligst gi oss beskjed om du kan komme eller ikke innen 1. juni 2026. Du vil motta en personlig lenke for å svare elektronisk."
    },
    {
      question: "Hvem kontakter jeg for matallergier?",
      answer: "Vennligst meld fra om eventuelle allergier eller diettbehov i RSVP-skjemaet eller direkte til oss på e-post."
    }
  ]
};
export type WeddingConfig = typeof weddingConfig;
