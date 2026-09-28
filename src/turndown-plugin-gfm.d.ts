/**
 * Minimal ambient type declarations for turndown-plugin-gfm.
 * The package ships no TypeScript types; this file satisfies the compiler.
 */
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  type Plugin = (service: TurndownService) => void;

  /** Full GFM plugin bundle (tables + strikethrough + task list items + highlighted code). */
  export const gfm: Plugin;

  /** GFM table support only. */
  export const tables: Plugin;

  /** GFM strikethrough support only. */
  export const strikethrough: Plugin;

  /** GitHub-style task list items. */
  export const taskListItems: Plugin;

  /** Syntax-highlighted code block support. */
  export const highlightedCodeBlock: Plugin;
}
