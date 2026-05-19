import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("sidebar.css", () => {
  test("keeps the capture overlay visually transparent until preview or flash states render", () => {
    const css = readFileSync("extension/sidebar.css", "utf8");
    const overlayBlock = css.match(/\.tsp-capture-overlay\s*\{([^}]+)\}/);

    expect(overlayBlock).not.toBeNull();
    expect(overlayBlock[1]).toContain("background: transparent;");
    expect(overlayBlock[1]).toContain("border: none;");
    expect(overlayBlock[1]).toContain("overflow: hidden;");
    expect(overlayBlock[1]).toContain("pointer-events: none;");
  });

  test("keeps pointer capture on per-column strips only", () => {
    const css = readFileSync("extension/sidebar.css", "utf8");
    const columnBlock = css.match(/\.tsp-capture-column\s*\{([^}]+)\}/);

    expect(columnBlock).not.toBeNull();
    expect(columnBlock[1]).toContain("pointer-events: auto;");
    expect(columnBlock[1]).toContain("cursor: crosshair;");
    expect(columnBlock[1]).not.toContain("repeating-linear-gradient");
    expect(columnBlock[1]).not.toContain("--tsp-quarter-px");
  });

  test("keeps snap feedback local to the active preview box", () => {
    const css = readFileSync("extension/sidebar.css", "utf8");
    const previewBlock = css.match(/\.tsp-preview\s*\{([^}]+)\}/);
    const centerGuideBlock = css.match(/\.tsp-preview::after\s*\{([^}]+)\}/);

    expect(previewBlock).not.toBeNull();
    expect(previewBlock[1]).toContain("border:");
    expect(centerGuideBlock).not.toBeNull();
    expect(centerGuideBlock[1]).toContain("top: 50%;");
    expect(centerGuideBlock[1]).toContain("pointer-events: none;");
  });
});
