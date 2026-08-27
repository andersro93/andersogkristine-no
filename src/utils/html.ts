/** Escape text for safe interpolation into HTML text nodes and attributes. */
export function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const LINK_CLASS = "underline hover:text-brand-title/80 transition-colors";

// Markdown-style [label](url) where the url is http(s), mailto or a site-relative path
const MD_LINK =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g;

// Bare URLs and e-mail addresses in plain text
const BARE_LINK = /(https?:\/\/\S+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

// Punctuation (and escaped quotes) that trails a bare URL but is not part of it
const TRAILING_PUNCTUATION = /(?:[.,;:!?)]|&quot;|&#039;)+$/;

function anchor(href: string, label: string): string {
  // Site-relative links open in the same tab; everything else in a new one
  const external = !href.startsWith("/");
  const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
  return `<a href="${href}"${attrs} class="${LINK_CLASS}">${label}</a>`;
}

function autolinkBare(text: string): string {
  return text.replace(BARE_LINK, (_match, url, email) => {
    if (email) return anchor(`mailto:${email}`, email);
    const trimmed = url.replace(TRAILING_PUNCTUATION, "");
    return anchor(trimmed, trimmed) + url.slice(trimmed.length);
  });
}

/**
 * Turn markdown-style [label](url) links, bare URLs and e-mail addresses in
 * an HTML-escaped text fragment into anchor tags. Must only be called on
 * text that has already been through escapeHtml (or contains no markup).
 */
export function linkifyEscapedText(text: string): string {
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(MD_LINK)) {
    parts.push(autolinkBare(text.slice(last, match.index)));
    parts.push(anchor(match[2], match[1]));
    last = match.index + match[0].length;
  }
  parts.push(autolinkBare(text.slice(last)));
  return parts.join("");
}
