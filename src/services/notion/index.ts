/**
 * Notion data layer. One module per concern; this barrel keeps the public
 * surface stable for pages, components, scripts and tests.
 */

export { escapeHtml } from "../../utils/html";
export type { WaitUntilContext } from "../cache";
export * from "./content";
export * from "./flags";
export * from "./invites";
export * from "./locations";
export {
  type Contributor,
  type ContributorContact,
  type EgentidSuggestion,
  fetchEgentidData,
  fetchForlovere,
  fetchToastmasters,
  resolveContributorPhoto,
} from "./people";
export * from "./program";
export * from "./seating";
export { CACHE_KEYS, getNotionClient } from "./shared";
