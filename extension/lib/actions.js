// In-page executor. Runs inside the content script's isolated world.
// Actions are the ONLY things code performs; JEV picked which one and
// on which element, but never writes selectors or URLs itself.

(function () {
  function findById(jvId) {
    return document.querySelector(`[data-jv-id="${jvId}"]`);
  }

  async function click(jvId) {
    const el = findById(jvId);
    if (!el) throw new Error("element not found: " + jvId);
    el.scrollIntoView({ block: "center", behavior: "instant" });
    el.click();
    return { ok: true };
  }

  async function type(jvId, text, submit) {
    const el = findById(jvId);
    if (!el) throw new Error("element not found: " + jvId);
    el.focus();
    if ("value" in el) {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el),
        "value"
      )?.set;
      setter ? setter.call(el, text) : (el.value = text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else {
      throw new Error("target is not typeable: " + el.tagName);
    }
    if (submit) {
      const form = el.form;
      if (form && typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
      }
    }
    return { ok: true };
  }

  async function pressEnter(jvId) {
    const el = jvId ? findById(jvId) : document.activeElement || document.body;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    return { ok: true };
  }

  async function scroll(direction) {
    const amount = window.innerHeight * 0.85;
    const dy = direction === "up" ? -amount : amount;
    window.scrollBy({ top: dy, behavior: "smooth" });
    return { ok: true };
  }

  async function readPage() {
    const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
    return { ok: true, text: text.slice(0, 20000), title: document.title, url: location.href };
  }

  async function getDownloadHref(jvId) {
    const el = findById(jvId);
    if (!el) throw new Error("element not found: " + jvId);
    if (el.tagName === "A" && el.href) return { ok: true, url: el.href };
    const parentA = el.closest("a[href]");
    if (parentA) return { ok: true, url: parentA.href };
    throw new Error("no downloadable link found on element");
  }

  self.__jarvisExecute = async function (action) {
    switch (action.intent) {
      case "CLICK":       return click(action.jvId);
      case "TYPE":        return type(action.jvId, action.text || "", !!action.submit);
      case "PRESS_ENTER": return pressEnter(action.jvId);
      case "SCROLL":      return scroll(action.direction || "down");
      case "READ_PAGE":   return readPage();
      case "DOWNLOAD":    return getDownloadHref(action.jvId);
      default: throw new Error("in-page executor cannot handle intent: " + action.intent);
    }
  };
})();
