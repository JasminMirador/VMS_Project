import { useEffect } from "react";

// ============================================================
// NUMBER MAPS
// ============================================================

const ARABIC_NUMBERS = [
  "٠",
  "١",
  "٢",
  "٣",
  "٤",
  "٥",
  "٦",
  "٧",
  "٨",
  "٩",
];

const ENGLISH_NUMBERS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
];


// ============================================================
// ENGLISH → ARABIC NUMERALS
// ============================================================

function convertToArabicNumerals(text) {
  if (!text) return text;

  return text.replace(
    /[0-9]/g,
    (digit) => ARABIC_NUMBERS[Number(digit)]
  );
}


// ============================================================
// ARABIC → ENGLISH NUMERALS
// ============================================================

function convertToEnglishNumerals(text) {
  if (!text) return text;

  return text.replace(
    /[٠-٩]/g,
    (digit) =>
      ENGLISH_NUMBERS[
        ARABIC_NUMBERS.indexOf(digit)
      ]
  );
}


// ============================================================
// REMOVE BIDI CONTROL CHARACTERS
// ============================================================

function removeBidiControls(text) {
  if (!text) return text;

  return text
    .replace(/\u2066/g, "")
    .replace(/\u2067/g, "")
    .replace(/\u2068/g, "")
    .replace(/\u2069/g, "")
    .replace(/\u200E/g, "")
    .replace(/\u200F/g, "");
}


// ============================================================
// FIX PARENTHESIZED NUMBERS
//
// English:
// Total Cameras (0)
//
// Arabic:
// إجمالي الكاميرات (٠)
//
// LRI/PDI keeps the parentheses visually ordered.
// ============================================================

function isolateArabicParenthesizedNumbers(text) {
  if (!text) return text;

  // Remove previous bidi isolation first
  text = removeBidiControls(text);

  return text.replace(
    /\(([٠-٩]+)\)/g,
    "\u2066($1)\u2069"
  );
}


// ============================================================
// PROTECTED TEXT
// ============================================================

function isProtectedText(node) {
  if (!node) return true;

  let current = node.parentElement;

  while (current) {

    // Explicit no-translation areas
    if (
      current.classList?.contains("notranslate") ||
      current.getAttribute("translate") === "no" ||
      current.hasAttribute("data-no-translate")
    ) {
      return true;
    }

    // Form controls
    const tag = current.tagName;

    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT"
    ) {
      return true;
    }

    current = current.parentElement;
  }

  const text = node.nodeValue?.trim() || "";

  if (!text) {
    return true;
  }


  // ==========================================================
  // IP ADDRESS
  // ==========================================================

  if (
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(text)
  ) {
    return true;
  }


  // ==========================================================
  // MAC ADDRESS
  // ==========================================================

  if (
    /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(text)
  ) {
    return true;
  }


  // ==========================================================
  // URL
  // ==========================================================

  if (
    /^(https?|rtsp|rtmp|ws|wss):\/\//i.test(text)
  ) {
    return true;
  }


  // ==========================================================
  // CAMERA / DEVICE IDs
  // ==========================================================

  if (
    /^(CAM|DEV|ID|CH)[-_][A-Z0-9_-]+$/i.test(text)
  ) {
    return true;
  }


  // ==========================================================
  // UUID
  // ==========================================================

  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      text
    )
  ) {
    return true;
  }


  // ==========================================================
  // EMAIL
  // ==========================================================

  if (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
  ) {
    return true;
  }


  return false;
}


// ============================================================
// PROCESS ONE TEXT NODE
// ============================================================

function processTextNode(node, language) {
  if (!node) return null;

  if (node.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  if (isProtectedText(node)) {
    return null;
  }

  const original = node.nodeValue;

  if (!original) {
    return null;
  }


  // ==========================================================
  // ARABIC
  // ==========================================================

  if (language === "ar") {

    if (!/[0-9]/.test(original)) {
      return null;
    }

    let converted =
      convertToArabicNumerals(original);

    converted =
      isolateArabicParenthesizedNumbers(converted);

    if (converted !== original) {
      return converted;
    }

    return null;
  }


  // ==========================================================
  // ENGLISH
  // ==========================================================

  if (language === "en") {

    if (
      !/[٠-٩]/.test(original) &&
      !/[\u2066\u2067\u2068\u2069\u200E\u200F]/.test(
        original
      )
    ) {
      return null;
    }

    let converted =
      convertToEnglishNumerals(original);

    converted =
      removeBidiControls(converted);

    if (converted !== original) {
      return converted;
    }

    return null;
  }


  return null;
}


// ============================================================
// COMPONENT
// ============================================================

export default function NumberTranslator() {

  useEffect(() => {

    let destroyed = false;
    let applying = false;

    let currentLanguage =
      document.documentElement.lang || "en";


    // ========================================================
    // APPLY TO COMPLETE PAGE
    // ========================================================

    const processEntirePage = () => {

      if (destroyed || applying) {
        return;
      }

      currentLanguage =
        document.documentElement.lang || "en";

      const walker =
        document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT
        );

      const updates = [];

      let node;

      while ((node = walker.nextNode())) {

        const newText =
          processTextNode(
            node,
            currentLanguage
          );

        if (
          newText !== null &&
          newText !== node.nodeValue
        ) {
          updates.push({
            node,
            newText,
          });
        }
      }


      if (!updates.length) {
        return;
      }


      applying = true;

      updates.forEach(
        ({ node, newText }) => {

          if (
            node &&
            node.isConnected
          ) {
            node.nodeValue = newText;
          }

        }
      );

      applying = false;
    };


    // ========================================================
    // PROCESS NEW DOM SUBTREE
    // ========================================================

    const processAddedNode = (addedNode) => {

      if (destroyed || applying) {
        return;
      }


      // ------------------------------------------------------
      // TEXT NODE
      // ------------------------------------------------------

      if (
        addedNode.nodeType === Node.TEXT_NODE
      ) {

        const newText =
          processTextNode(
            addedNode,
            currentLanguage
          );

        if (
          newText !== null &&
          newText !== addedNode.nodeValue
        ) {

          applying = true;

          addedNode.nodeValue =
            newText;

          applying = false;
        }

        return;
      }


      // ------------------------------------------------------
      // ELEMENT NODE
      // ------------------------------------------------------

      if (
        addedNode.nodeType !==
        Node.ELEMENT_NODE
      ) {
        return;
      }


      const walker =
        document.createTreeWalker(
          addedNode,
          NodeFilter.SHOW_TEXT
        );

      const updates = [];

      let node;

      while ((node = walker.nextNode())) {

        const newText =
          processTextNode(
            node,
            currentLanguage
          );

        if (
          newText !== null &&
          newText !== node.nodeValue
        ) {

          updates.push({
            node,
            newText,
          });
        }
      }


      if (!updates.length) {
        return;
      }


      applying = true;

      updates.forEach(
        ({ node, newText }) => {

          if (
            node &&
            node.isConnected
          ) {
            node.nodeValue = newText;
          }

        }
      );

      applying = false;
    };


    // ========================================================
    // MUTATION OBSERVER
    // ========================================================

    const observer =
      new MutationObserver(
        (mutations) => {

          if (
            destroyed ||
            applying
          ) {
            return;
          }


          let languageChanged = false;


          mutations.forEach(
            (mutation) => {

              // ------------------------------------------------
              // HTML LANG CHANGED
              // ------------------------------------------------

              if (
                mutation.type ===
                "attributes" &&
                mutation.target ===
                document.documentElement &&
                mutation.attributeName ===
                "lang"
              ) {

                currentLanguage =
                  document.documentElement.lang ||
                  "en";

                languageChanged = true;

                return;
              }


              // ------------------------------------------------
              // NEW REACT CONTENT
              // ------------------------------------------------

              if (
                mutation.type ===
                "childList"
              ) {

                mutation.addedNodes.forEach(
                  (node) => {
                    processAddedNode(node);
                  }
                );

                return;
              }


              // ------------------------------------------------
              // GTRANSLATE CHANGED TEXT
              // ------------------------------------------------

              if (
                mutation.type ===
                "characterData"
              ) {

                const target =
                  mutation.target;

                const newText =
                  processTextNode(
                    target,
                    currentLanguage
                  );

                if (
                  newText !== null &&
                  newText !== target.nodeValue
                ) {

                  applying = true;

                  target.nodeValue =
                    newText;

                  applying = false;
                }
              }

            }
          );


          // ----------------------------------------------------
          // REPROCESS ENTIRE PAGE WHEN LANGUAGE CHANGES
          // ----------------------------------------------------

          if (languageChanged) {

            requestAnimationFrame(() => {

              if (!destroyed) {
                processEntirePage();
              }

            });


            setTimeout(() => {

              if (!destroyed) {
                processEntirePage();
              }

            }, 300);


            setTimeout(() => {

              if (!destroyed) {
                processEntirePage();
              }

            }, 1000);
          }

        }
      );


    // ========================================================
    // START OBSERVER
    // ========================================================

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true,
        characterData: true,
      }
    );


    observer.observe(
      document.documentElement,
      {
        attributes: true,
        attributeFilter: ["lang"],
      }
    );


    // ========================================================
    // INITIAL RUN
    // ========================================================

    processEntirePage();


    requestAnimationFrame(() => {
      processEntirePage();
    });


    setTimeout(() => {
      processEntirePage();
    }, 500);


    setTimeout(() => {
      processEntirePage();
    }, 1500);


    // ========================================================
    // CLEANUP
    // ========================================================

    return () => {

      destroyed = true;

      observer.disconnect();

    };

  }, []);


  return null;
}