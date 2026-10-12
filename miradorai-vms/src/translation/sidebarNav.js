// Backwards-compatible wrapper. All strings now live in src/i18n/locales/*.json.
import { translateText } from "../i18n";

export function tNav(text, language) {
  return translateText(language, text);
}
