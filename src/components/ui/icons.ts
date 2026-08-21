/**
 * Shared icon registry (Heroicons-style stroked glyphs + a couple of brand/solid
 * glyphs). Rendered by <Icon> (Astro) and <Icon> (React) so the same glyph is
 * never inlined twice.
 */
export interface IconDef {
  /** SVG path `d` attributes, drawn with stroke="currentColor" unless `fill` */
  paths: string[];
  /** Filled glyph (no stroke) */
  fill?: boolean;
  /** Default stroke width when the caller does not pass one */
  strokeWidth?: number;
}

export const ICONS = {
  chevronDown: { paths: ["M19.5 8.25l-7.5 7.5-7.5-7.5"], strokeWidth: 2.5 },
  chevronRight: { paths: ["M8.25 4.5l7.5 7.5-7.5 7.5"], strokeWidth: 2 },
  arrowRight: {
    paths: ["M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"],
    strokeWidth: 2.5,
  },
  externalLink: {
    paths: [
      "M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25",
    ],
    strokeWidth: 2.5,
  },
  mapPin: {
    paths: [
      "M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
      "M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0z",
    ],
    strokeWidth: 2,
  },
  search: {
    paths: ["M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"],
    strokeWidth: 2,
  },
  x: { paths: ["M6 18L18 6M6 6l12 12"], strokeWidth: 2 },
  check: { paths: ["M5 13l4 4L19 7"], strokeWidth: 2 },
  alertCircle: {
    paths: ["M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"],
    strokeWidth: 2,
  },
  lock: {
    paths: [
      "M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z",
    ],
    strokeWidth: 1.5,
  },
  play: { paths: ["M8 5v14l11-7z"], fill: true },
  spotify: {
    paths: [
      "M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.892-.982-.336.076-.67-.135-.746-.47-.077-.337.135-.67.472-.747 3.856-.88 7.15-.506 9.822 1.13.295.18.387.563.204.862zm1.224-2.724c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.082-1.182-.413.125-.847-.107-.972-.52-.125-.413.107-.847.52-.972 3.676-1.116 8.243-.574 11.348 1.336.368.226.488.707.26 1.078zm.105-2.836C14.692 8.879 9.366 8.7 6.273 9.64c-.477.145-.975-.125-1.12-.602-.145-.477.125-.975.602-1.12 3.56-1.08 9.425-.87 13.136 1.333.43.256.572.812.316 1.242-.256.43-.812.573-1.242.317z",
    ],
    fill: true,
  },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** The indeterminate spinner is two shapes with different opacity — kept separate. */
export const SPINNER = {
  circle: { cx: 12, cy: 12, r: 10, strokeWidth: 4 },
  path: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z",
} as const;
