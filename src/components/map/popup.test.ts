import { describe, expect, test } from "bun:test";
import {
  buildMarkerHtml,
  buildPopupHtml,
  getLabelForEmoji,
  getZoneColor,
} from "./popup";

describe("map popup helpers", () => {
  test("labels known emoji categories and falls back to Lokasjon", () => {
    expect(getLabelForEmoji("⛪")).toBe("Kirke");
    expect(getLabelForEmoji("🍔")).toBe("Mat & Drikke");
    expect(getLabelForEmoji(undefined)).toBe("Lokasjon");
    expect(getLabelForEmoji("🦄")).toBe("Lokasjon");
  });

  test("zone colours are case-insensitive with a blue default", () => {
    expect(getZoneColor("RED")).toBe("#ef4444");
    expect(getZoneColor(undefined)).toBe("#3b82f6");
    expect(getZoneColor("magenta")).toBe("#3b82f6");
  });

  test("popup escapes Notion-sourced text and links", () => {
    const html = buildPopupHtml({
      id: "1",
      name: 'Tårnet <script>alert("x")</script>',
      lat: 59.9,
      lng: 10.7,
      ikon: "🏛️",
      googleMapsUrl: 'https://maps.google.com/?q=a"onmouseover="x',
      activities: [
        { type: "program", title: "Vielse <b>", time: "13:00" },
        {
          type: "egentid",
          title: "Kafé & bar",
          suggestedBy: "Kristine",
          suggestedByEmoji: "👰",
        },
      ],
    });
    expect(html).toContain("Tårnet &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Vielse &lt;b&gt;");
    expect(html).toContain("Kafé &amp; bar");
    expect(html).toContain(
      'href="https://maps.google.com/?q=a&quot;onmouseover=&quot;x"',
    );
    expect(html).toContain("Bryllupsfest");
  });

  test("marker html escapes the emoji and picks a colour class", () => {
    expect(buildMarkerHtml("⛪")).toContain("bg-[#8d7c68]");
    expect(buildMarkerHtml("<x>")).toContain("&lt;x&gt;");
  });
});
