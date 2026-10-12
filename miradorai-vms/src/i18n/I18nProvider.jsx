import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  LANGUAGES,
  STORAGE_KEY,
  getDir,
  getStoredLanguage,
  translate,
  translateText,
} from "./core";

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(getStoredLanguage);

  const setLanguage = useCallback((code) => {
    if (!LANGUAGES[code]) return;
    setLanguageState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  }, []);

  // Keep <html lang/dir> in sync (RTL for Arabic)
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = getDir(language);
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      dir: getDir(language),
      isRTL: getDir(language) === "rtl",
      setLanguage,
      t: (key, params) => translate(language, key, params),
      tText: (text) => translateText(language, text),
    }),
    [language, setLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
