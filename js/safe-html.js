const BLOCKED_ELEMENTS = "script,iframe,object,embed,base,meta,link,svg,math";
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "xlink:href"]);
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isSafeUrl(value, attributeName) {
  const normalized = String(value).trim().replace(/[\u0000-\u001f\u007f-\u009f\s]/g, "");
  if (!normalized || normalized.startsWith("#")) return true;
  try {
    const parsed = new URL(normalized, window.location.href);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return false;
    return !["src", "poster"].includes(attributeName) || parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function createSafeFragment(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html ?? "");
  template.content.querySelectorAll(BLOCKED_ELEMENTS).forEach(element => element.remove());

  template.content.querySelectorAll("*").forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value, name))) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  template.content.querySelectorAll("img:not([src]),source:not([src])").forEach(element => element.remove());

  return template.content;
}

export function setSafeHTML(element, html) {
  element.replaceChildren(createSafeFragment(html));
}
