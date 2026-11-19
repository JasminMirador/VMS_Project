import { useEffect, useState } from "react";
import logoImg from "../../assets/logo.jpg";
import "./SplashScreen.css";

export default function SplashScreen({
  onDone,
  title,
  subtitle,
  language = localStorage.getItem("mirador_language") || "en",
  embedded = false,
}) {
  const [phase, setPhase] = useState("idle");

  // =========================================================
  // LANGUAGE
  // =========================================================

  const isArabic = language === "ar";

  // =========================================================
  // SPLASH TEXT
  // =========================================================

  const displayTitle =
    title !== undefined && title !== null
      ? title
      : isArabic
      ? "ميرادور في إم إس"
      : "MIRADOR VMS";

  const displaySubtitle =
    subtitle !== undefined && subtitle !== null
      ? subtitle
      : isArabic
      ? "نظام إدارة الفيديو"
      : "VIDEO MANAGEMENT SYSTEM";

  // =========================================================
  // SPLASH ANIMATION
  // =========================================================

  useEffect(() => {
    const speed = embedded ? 0.65 : 1.0;

    const t1 = setTimeout(() => {
      setPhase("logo");
    }, Math.round(100 * speed));

    const t2 = setTimeout(() => {
      setPhase("text");
    }, Math.round(800 * speed));

    const t3 = setTimeout(() => {
      setPhase("line");
    }, Math.round(1550 * speed));

    const t4 = setTimeout(() => {
      setPhase("exit");
    }, Math.round(2300 * speed));

    const t5 = setTimeout(() => {
      onDone?.();
    }, Math.round(3000 * speed));

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [onDone, embedded]);

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div
      className={`splash ${embedded ? "splash--embedded" : ""} ${
        phase === "exit" ? "splash--exit" : ""
      }`}
      dir={isArabic ? "rtl" : "ltr"}
      lang={isArabic ? "ar" : "en"}
    >

      {/* =====================================================
          AMBIENT BACKGROUND
          ===================================================== */}

      <div className="splash__blob splash__blob--1" />
      <div className="splash__blob splash__blob--2" />


      {/* =====================================================
          CENTER CONTENT
          ===================================================== */}

      <div className="splash__center">


        {/* ===================================================
            LOGO
            =================================================== */}

        <div
          className={`splash__logo-wrap ${
            phase !== "idle"
              ? "splash__logo-wrap--in"
              : ""
          
          }`} style={{ backgroundColor: "#002a43" }}

        >
          <img
            src={logoImg}
            alt={displayTitle || "Mirador VMS"}
            className="splash__logo"
          />

          {/* Shimmer animation */}
          <div
            className={`splash__shimmer ${
              phase !== "idle"
                ? "splash__shimmer--run"
                : ""
            }`}
          />
        </div>


        {/* ===================================================
            PRODUCT NAME

            IMPORTANT:
            Keep this as ONE text node.

            DO NOT:
            display:flex
            title.split("")
            map every character
            =================================================== */}

        <div
          className={`splash__name ${
            isArabic
              ? "splash__name--arabic"
              : "splash__name--english"
          } ${
            phase === "text" ||
            phase === "line" ||
            phase === "exit"
              ? "splash__name--in"
              : ""
          }`}
          dir={isArabic ? "rtl" : "ltr"}
          lang={isArabic ? "ar" : "en"}
        >
          {displayTitle}
        </div>


        {/* ===================================================
            SUBTITLE
            =================================================== */}

        {Boolean(displaySubtitle) && (
          <div
            className={`splash__sub ${
              phase === "text" ||
              phase === "line" ||
              phase === "exit"
                ? "splash__sub--in"
                : ""
            }`}
            dir={isArabic ? "rtl" : "ltr"}
            lang={isArabic ? "ar" : "en"}
          >
            {displaySubtitle}
          </div>
        )}


        {/* ===================================================
            ANIMATED LINE
            =================================================== */}

        <div className="splash__line-wrap">
          <div
            className={`splash__line ${
              phase === "line" ||
              phase === "exit"
                ? "splash__line--in"
                : ""
            }`}
          />
        </div>

      </div>
    </div>
  );
}