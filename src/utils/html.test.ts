import { describe, expect, test } from "bun:test";
import { escapeHtml, linkifyEscapedText } from "./html";

describe("linkifyEscapedText", () => {
  test("renders markdown-style links to external URLs", () => {
    const html = linkifyEscapedText(
      "Se [kartet vårt](https://example.com/kart) for detaljer",
    );
    expect(html).toBe(
      'Se <a href="https://example.com/kart" target="_blank" rel="noopener noreferrer" class="underline hover:text-brand-title/80 transition-colors">kartet vårt</a> for detaljer',
    );
  });

  test("renders markdown-style links to internal pages without target=_blank", () => {
    const html = linkifyEscapedText("Se [kartet](/kart) for parkering");
    expect(html).toContain('<a href="/kart" class=');
    expect(html).not.toContain("target=");
  });

  test("renders markdown-style mailto links", () => {
    const html = linkifyEscapedText("Kontakt [Kristine](mailto:k@example.com)");
    expect(html).toContain('<a href="mailto:k@example.com"');
    expect(html).toContain(">Kristine</a>");
  });

  test("auto-links bare URLs and keeps trailing punctuation outside the link", () => {
    const html = linkifyEscapedText("Les mer på https://example.com/side.");
    expect(html).toContain('<a href="https://example.com/side"');
    expect(html).toContain("</a>.");
  });

  test("auto-links bare e-mail addresses as mailto", () => {
    const html = linkifyEscapedText(
      "Send e-post til kristine.lindland@ros-nett.com i dag",
    );
    expect(html).toContain('<a href="mailto:kristine.lindland@ros-nett.com"');
    expect(html).toContain(">kristine.lindland@ros-nett.com</a>");
  });

  test("does not auto-link text inside a markdown link twice", () => {
    const html = linkifyEscapedText(
      "[https://example.com](https://example.com)",
    );
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  test("ignores markdown links with unsupported protocols", () => {
    const html = linkifyEscapedText("[klikk her](javascript:alert(1))");
    expect(html).not.toContain("<a ");
  });

  test("leaves escaped quotes trailing a bare URL out of the href", () => {
    const html = linkifyEscapedText(escapeHtml('Se "https://example.com" her'));
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain("</a>&quot; her");
  });

  test("leaves plain text untouched", () => {
    expect(linkifyEscapedText("Bare vanlig tekst her")).toBe(
      "Bare vanlig tekst her",
    );
  });
});
