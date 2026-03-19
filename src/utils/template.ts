/**
 * Handlebars template rendering for prompts.
 */

import Handlebars from "handlebars";

Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

export function renderTemplate(
  template: string,
  context: Record<string, unknown>
): string {
  const compiled = Handlebars.compile(template, { noEscape: true });
  return compiled(context);
}
