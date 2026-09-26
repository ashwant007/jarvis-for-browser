// In-page snapshot of interactive elements.
// Produces a compact array [{id, tag, role, label, href, visible}] plus a
// hidden data-jv-id attribute we can look up later to execute an action.
//
// The point of this file: JEV never invents selectors. It only picks
// among the ids we hand it, drawn from what the page actually shows.

(function () {
  const MAX_ELEMENTS = 200; // JEV Choice hard-limits at 255

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return false;
    // In viewport-ish (allow a screen of scroll above/below)
    const vh = window.innerHeight || 800;
    if (rect.bottom < -vh || rect.top > vh * 2) return false;
    return true;
  }

  function labelOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (el.tagName === "INPUT") {
      const ph = el.getAttribute("placeholder");
      const nm = el.getAttribute("name");
      const tp = el.getAttribute("type") || "text";
      return `[input ${tp}${ph ? " — " + ph : nm ? " — " + nm : ""}]`;
    }
    if (el.tagName === "IMG") return `[img ${el.getAttribute("alt") || ""}]`;
    const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    return text.slice(0, 120);
  }

  function roleOf(el) {
    const r = el.getAttribute("role");
    if (r) return r;
    switch (el.tagName) {
      case "A": return "link";
      case "BUTTON": return "button";
      case "INPUT": {
        const t = (el.getAttribute("type") || "text").toLowerCase();
        return t === "submit" ? "button" : "input";
      }
      case "TEXTAREA": return "input";
      case "SELECT": return "select";
      default: return "clickable";
    }
  }

  function snapshot() {
    const selector = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "textarea",
      "select",
      "[role=button]",
      "[role=link]",
      "[role=textbox]",
      "[role=searchbox]",
      "[onclick]",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const raw = Array.from(document.querySelectorAll(selector));
    const out = [];
    let counter = 0;

    for (const el of raw) {
      if (!isVisible(el)) continue;
      const label = labelOf(el);
      if (!label && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") continue;

      const id = "e" + counter++;
      el.setAttribute("data-jv-id", id);
      out.push({
        id,
        tag: el.tagName.toLowerCase(),
        role: roleOf(el),
        label: label.slice(0, 160),
        href: el.tagName === "A" ? (el.href || null) : null,
      });
      if (out.length >= MAX_ELEMENTS) break;
    }
    return {
      url: location.href,
      title: document.title,
      scrollY: window.scrollY,
      scrollMax: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      elements: out,
    };
  }

  self.__jarvisSnapshot = snapshot;
})();
