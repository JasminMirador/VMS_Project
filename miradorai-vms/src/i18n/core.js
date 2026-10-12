// ============================================================
// GLOBAL i18n  —  React App
//   ├── English → locales/en.json
//   └── Arabic  → locales/ar.json
//
// Usage in any component:
//   import { useI18n } from "../../i18n";
//   const { t, language, setLanguage, dir } = useI18n();
//   t("topbar.logout")                 // → "Logout" / "تسجيل الخروج"
//   t("greeting", { name: "Ali" })     // "Hello {{name}}" interpolation
//
// Outside React (utils, services):
//   import { translate } from "../i18n";
//   translate("ar", "topbar.logout");
//
// To add a language: drop <code>.json into ./locales and register it
// in LANGUAGES below. Missing keys fall back to English, then to the key.
// ============================================================

import en from "./locales/en.json";
import ar from "./locales/ar.json";

export const STORAGE_KEY = "mirador_language";
export const DEFAULT_LANGUAGE = "en";

export const LANGUAGES = {
  en: { code: "en", label: "English", nativeLabel: "English", dir: "ltr", messages: en },
  ar: { code: "ar", label: "Arabic", nativeLabel: "العربية", dir: "rtl", messages: ar },
};

export const getDir = (lang) => (LANGUAGES[lang] || LANGUAGES[DEFAULT_LANGUAGE]).dir;

export function getStoredLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LANGUAGES[saved] ? saved : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function lookup(messages, key) {
  return key.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), messages);
}

function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) =>
    params[name] !== undefined ? String(params[name]) : m
  );
}

/** translate("ar", "topbar.logout", { optional: params }) */
export function translate(lang, key, params) {
  const messages = (LANGUAGES[lang] || LANGUAGES[DEFAULT_LANGUAGE]).messages;
  const value = lookup(messages, key) ?? lookup(en, key);
  return typeof value === "string" ? interpolate(value, params) : key;
}

// ---- English text → key (for dynamic labels that arrive as English text,
// e.g. navConfig.js section / item names). Unknown text is returned as is.
const TEXT_TO_KEY = {};
(function build(obj, prefix) {
  Object.entries(obj).forEach(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object") build(v, path);
    else if (!(v in TEXT_TO_KEY)) TEXT_TO_KEY[v] = path;
  });
})(en, "");

export function translateText(lang, text) {
  if (!text || lang === DEFAULT_LANGUAGE) return text;
  const key = TEXT_TO_KEY[text];
  return key ? translate(lang, key) : text;
}

