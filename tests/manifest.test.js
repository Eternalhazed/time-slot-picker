import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("manifest", () => {
  test("uses narrow MV3 permissions and loads content scripts in dependency order", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "extension", "manifest.json"), "utf8")
    );

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toEqual(["https://calendar.google.com/*"]);
    expect(manifest.permissions).toEqual(["storage", "scripting"]);
    expect(manifest.content_scripts[0].js).toEqual([
      "time-utils.js",
      "storage.js",
      "grid-anchor.js",
      "capture-overlay.js",
      "content.js"
    ]);
  });
});
