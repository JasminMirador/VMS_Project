import { createContext, useContext, useLayoutEffect, useState } from "react";

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("miradorai_theme") || "light";
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", saved);
    }
    return saved;
  });

  useLayoutEffect(() => {
    document.documentElement.removeAttribute("style"); // Clear any stale inline styles
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("miradorai_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
