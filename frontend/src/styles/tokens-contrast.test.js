import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

/** Custom properties declared in the `[data-theme="<name>"]` block.
 * @param {string} name */
function theme(name) {
  const start = css.indexOf(`[data-theme="${name}"]`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  /** @type {Record<string, string>} */
  const vars = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\b/gi)) vars[m[1]] = m[2];
  return vars;
}

/** @param {string} hex */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} a @param {string} b */
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["bg-base", "bg-surface", "bg-subtle"];

for (const name of ["dark", "light"]) {
  describe(`${name} theme tokens meet WCAG AA (4.5:1)`, () => {
    const t = theme(name);

    it.each([
      ["text-on-accent", "accent-primary"],
      ["text-on-accent", "accent-primary-hover"],
      ["text-on-accent", "accent-danger-solid"],
      ["text-on-accent", "accent-danger-solid-hover"],
      ["accent-success-text", "accent-success"],
    ])("%s on %s", (fg, bg) => {
      expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
    });

    it.each(["text-main", "text-muted", "text-dim", "accent-primary-ink", "accent-success", "accent-warn", "accent-danger"])(
      "%s as text on the page surfaces",
      (fg) => {
        for (const bg of SURFACES) {
          expect(ratio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      },
    );
  });
}
