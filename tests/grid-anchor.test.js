import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const gridAnchor = require("../extension/grid-anchor.js");
const utils = require("../extension/time-utils.js");

function rect(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  };
}

function rootWithUrl(href, language) {
  return {
    location: { href },
    navigator: language ? { language } : undefined,
    querySelector: document.querySelector.bind(document),
    querySelectorAll: document.querySelectorAll.bind(document)
  };
}

describe("grid-anchor", () => {
  test("finds a usable week grid from semantic calendar markup", () => {
    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label>8 AM</div>
          <div data-tsp-hour-label>9 AM</div>
        </div>
      </div>
      <div role="columnheader" data-date="2026-05-04">Mon 4</div>
      <div role="columnheader" data-date="2026-05-05">Tue 5</div>
      <div role="columnheader" data-date="2026-05-06">Wed 6</div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const headers = document.querySelectorAll("[role='columnheader']");

    grid.getBoundingClientRect = () => rect(100, 100, 300, 600);
    scroll.scrollTop = 120;
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);
    headers[0].getBoundingClientRect = () => rect(100, 50, 100, 40);
    headers[1].getBoundingClientRect = () => rect(200, 50, 100, 40);
    headers[2].getBoundingClientRect = () => rect(300, 50, 100, 40);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(anchor.calibration).toEqual({
      gridRectTop: 100,
      scrollTop: 0,
      pixelsPerHour: 60,
      gridStartHour: 7
    });
    expect(anchor.columns).toEqual([
      { left: 100, right: 200, date: { year: 2026, month: 5, day: 4 } },
      { left: 200, right: 300, date: { year: 2026, month: 5, day: 5 } },
      { left: 300, right: 400, date: { year: 2026, month: 5, day: 6 } }
    ]);
  });

  test("ignores tiny calendar grid candidates in favor of a usable week grid", () => {
    document.body.innerHTML = `
      <div role="grid" aria-label="Calendar">
        <div data-tsp-hour-label>8 AM</div>
        <div data-tsp-hour-label>9 AM</div>
      </div>
      <div data-viewkey>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label>8 AM</div>
          <div data-tsp-hour-label>9 AM</div>
        </div>
      </div>
      <div role="columnheader" data-date="2026-05-13">Wed 13</div>
      <div role="columnheader" data-date="2026-05-14">Thu 14</div>
    `;

    const tinyGrid = document.querySelector("[role='grid']");
    const largeGrid = document.querySelector("[data-viewkey]");
    const largeScroll = document.querySelector("[data-tsp-scroll]");
    const tinyLabels = tinyGrid.querySelectorAll("[data-tsp-hour-label]");
    const largeLabels = largeGrid.querySelectorAll("[data-tsp-hour-label]");
    const headers = document.querySelectorAll("[role='columnheader']");

    tinyGrid.getBoundingClientRect = () => rect(256, 64, 32, 726);
    tinyLabels[0].getBoundingClientRect = () => rect(260, 300, 28, 20);
    tinyLabels[1].getBoundingClientRect = () => rect(260, 360, 28, 20);
    largeGrid.getBoundingClientRect = () => rect(100, 100, 700, 600);
    largeScroll.scrollTop = 0;
    largeLabels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    largeLabels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);
    headers[0].getBoundingClientRect = () => rect(100, 80, 350, 40);
    headers[1].getBoundingClientRect = () => rect(450, 80, 350, 40);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(anchor.grid).toBe(largeGrid);
    expect(anchor.bounds.left).toBe(100);
    expect(anchor.bounds.right).toBe(800);
  });

  test("fails visibly when hour labels cannot be parsed", () => {
    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div data-tsp-hour-label>matin</div>
        <div data-tsp-hour-label>soir</div>
      </div>
    `;

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor).toEqual({
      ok: false,
      reason: "Hour labels could not be parsed."
    });
  });

  test("calibrates from page-level hour labels when the selected grid has no hour labels", () => {
    document.body.innerHTML = `
      <div data-tsp-hour-label>7 AM</div>
      <div data-tsp-hour-label>8 AM</div>
      <div data-tsp-hour-label>9 AM</div>
      <div data-viewkey>
        <div data-tsp-scroll style="height: 700px; overflow: auto"></div>
      </div>
      <div role="columnheader" data-date="2026-05-11">Mon 11</div>
      <div role="columnheader" data-date="2026-05-12">Tue 12</div>
      <div role="columnheader" data-date="2026-05-13">Wed 13</div>
    `;

    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const grid = document.querySelector("[data-viewkey]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const headers = document.querySelectorAll("[role='columnheader']");

    labels[0].getBoundingClientRect = () => rect(60, 280, 50, 20);
    labels[1].getBoundingClientRect = () => rect(60, 340, 50, 20);
    labels[2].getBoundingClientRect = () => rect(60, 400, 50, 20);
    grid.getBoundingClientRect = () => rect(256, 220, 956, 700);
    scroll.scrollTop = 0;
    headers[0].getBoundingClientRect = () => rect(300, 160, 180, 40);
    headers[1].getBoundingClientRect = () => rect(480, 160, 180, 40);
    headers[2].getBoundingClientRect = () => rect(660, 160, 180, 40);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(anchor.calibration.pixelsPerHour).toBe(60);
    expect(anchor.calibration.gridStartHour).toBe(6);
    expect(anchor.bounds).toEqual({
      left: 300,
      top: 220,
      right: 840,
      bottom: 920,
      width: 540,
      height: 700
    });
  });

  test("does not double-count scroll when visible hour labels are already in viewport coordinates", () => {
    document.body.innerHTML = `
      <div data-tsp-hour-label>7 AM</div>
      <div data-tsp-hour-label>8 AM</div>
      <div data-tsp-hour-label>9 AM</div>
      <div data-viewkey>
        <div data-tsp-scroll style="height: 700px; overflow: auto"></div>
      </div>
      <div role="columnheader" data-date="2026-05-15">Fri 15</div>
    `;

    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const grid = document.querySelector("[data-viewkey]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const header = document.querySelector("[role='columnheader']");

    labels[0].getBoundingClientRect = () => rect(60, 280, 50, 20);
    labels[1].getBoundingClientRect = () => rect(60, 340, 50, 20);
    labels[2].getBoundingClientRect = () => rect(60, 400, 50, 20);
    grid.getBoundingClientRect = () => rect(256, 220, 956, 700);
    scroll.scrollTop = 900;
    header.getBoundingClientRect = () => rect(712, 160, 180, 40);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(utils.clientPointToTime(280, anchor.calibration)).toEqual({
      hour: 7,
      minute: 0,
      totalMinutes: 420
    });
  });

  test("calibrates transformed hour labels from their visual center line", () => {
    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 700px; overflow: auto">
          <div data-tsp-hour-label style="transform: translateY(-50%)">7 AM</div>
          <div data-tsp-hour-label style="transform: translateY(-50%)">8 AM</div>
          <div data-tsp-hour-label style="transform: translateY(-50%)">9 AM</div>
        </div>
      </div>
      <div role="columnheader" data-date="2026-05-15">Fri 15</div>
    `;

    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const grid = document.querySelector("[data-tsp-time-grid]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const header = document.querySelector("[role='columnheader']");

    grid.getBoundingClientRect = () => rect(256, 220, 956, 700);
    scroll.scrollTop = 0;
    labels[0].getBoundingClientRect = () => rect(60, 280, 50, 60);
    labels[1].getBoundingClientRect = () => rect(60, 340, 50, 60);
    labels[2].getBoundingClientRect = () => rect(60, 400, 50, 60);
    header.getBoundingClientRect = () => rect(712, 160, 180, 40);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(anchor.calibration.pixelsPerHour).toBe(60);
    expect(utils.clientPointToTime(310, anchor.calibration)).toEqual({
      hour: 7,
      minute: 0,
      totalMinutes: 420
    });
    expect(utils.clientPointToTime(430, anchor.calibration)).toEqual({
      hour: 9,
      minute: 0,
      totalMinutes: 540
    });

    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 520px; overflow: auto">
          <div data-tsp-hour-label style="transform: translateY(-50%)">7 AM</div>
          <div data-tsp-hour-label style="transform: translateY(-50%)">8 AM</div>
          <div data-tsp-hour-label style="transform: translateY(-50%)">9 AM</div>
        </div>
      </div>
      <div role="columnheader" data-date="2026-05-15">Fri 15</div>
    `;

    const compactLabels = document.querySelectorAll("[data-tsp-hour-label]");
    const compactGrid = document.querySelector("[data-tsp-time-grid]");
    const compactScroll = document.querySelector("[data-tsp-scroll]");
    const compactHeader = document.querySelector("[role='columnheader']");

    compactGrid.getBoundingClientRect = () => rect(256, 140, 720, 520);
    compactScroll.scrollTop = 0;
    compactLabels[0].getBoundingClientRect = () => rect(60, 176, 50, 24);
    compactLabels[1].getBoundingClientRect = () => rect(60, 224, 50, 24);
    compactLabels[2].getBoundingClientRect = () => rect(60, 272, 50, 24);
    compactHeader.getBoundingClientRect = () => rect(520, 96, 160, 36);

    const compactAnchor = gridAnchor.findGridAnchor(document);

    expect(compactAnchor.ok).toBe(true);
    expect(compactAnchor.calibration.pixelsPerHour).toBe(48);
    expect(utils.clientPointToTime(236, compactAnchor.calibration)).toEqual({
      hour: 8,
      minute: 0,
      totalMinutes: 480
    });
  });

  test("ignores implausibly compressed hour-label pairs when calibrating the time scale", () => {
    document.body.innerHTML = `
      <div data-tsp-hour-label>7 AM</div>
      <div data-tsp-hour-label>8 AM</div>
      <div data-tsp-hour-label>7 AM</div>
      <div data-tsp-hour-label>8 AM</div>
      <div data-tsp-hour-label>9 AM</div>
      <div data-viewkey>
        <div data-tsp-scroll style="height: 700px; overflow: auto"></div>
      </div>
      <div role="columnheader" data-date="2026-05-15">Fri 15</div>
    `;

    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const grid = document.querySelector("[data-viewkey]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const header = document.querySelector("[role='columnheader']");

    labels[0].getBoundingClientRect = () => rect(60, 280, 50, 20);
    labels[1].getBoundingClientRect = () => rect(60, 320, 50, 20);
    labels[2].getBoundingClientRect = () => rect(60, 360, 50, 20);
    labels[3].getBoundingClientRect = () => rect(60, 440, 50, 20);
    labels[4].getBoundingClientRect = () => rect(60, 520, 50, 20);
    grid.getBoundingClientRect = () => rect(256, 220, 956, 700);
    scroll.scrollTop = 0;
    header.getBoundingClientRect = () => rect(712, 160, 180, 40);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(anchor.calibration.pixelsPerHour).toBe(80);
    expect(utils.clientPointToTime(520, anchor.calibration)).toEqual({
      hour: 9,
      minute: 0,
      totalMinutes: 540
    });
  });

  test("calibrates pixelsPerHour correctly when Google Calendar layers two hour-row labels per hour at ~6px offset", () => {
    // Reproduces the live-page calibration drift surfaced by the diagnostic
    // snapshot: Google Calendar emits two DOM elements per hour-row label, a
    // ~16px visible text node and a ~40px row container, with rect.top offset
    // by ~6px. Adjacent-only pair scanning interleaves the layer groups in
    // sorted-Y order and consistently yields pixelsPerHour=34 instead of the
    // true 40. The all-pairs scan in buildCalibration must let median
    // rejection ignore the cross-layer outliers.
    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div data-tsp-hour-label>7 AM</div>
        <div data-tsp-hour-label>7 AM</div>
        <div data-tsp-hour-label>8 AM</div>
        <div data-tsp-hour-label>8 AM</div>
        <div data-tsp-hour-label>9 AM</div>
        <div data-tsp-hour-label>9 AM</div>
      </div>
      <div role="columnheader" data-date="2026-05-15">Fri 15</div>
    `;

    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const grid = document.querySelector("[data-tsp-time-grid]");
    const header = document.querySelector("[role='columnheader']");

    labels[0].getBoundingClientRect = () => rect(60, 180, 50, 16);
    labels[1].getBoundingClientRect = () => rect(60, 186, 50, 40);
    labels[2].getBoundingClientRect = () => rect(60, 220, 50, 16);
    labels[3].getBoundingClientRect = () => rect(60, 226, 50, 40);
    labels[4].getBoundingClientRect = () => rect(60, 260, 50, 16);
    labels[5].getBoundingClientRect = () => rect(60, 266, 50, 40);
    grid.getBoundingClientRect = () => rect(0, 64, 700, 600);
    header.getBoundingClientRect = () => rect(120, 40, 100, 24);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(anchor.calibration.pixelsPerHour).toBe(40);
  });

  test("infers week columns from Google-style visible day headers when semantic dates are absent", () => {
    document.body.innerHTML = `
      <div data-tsp-visible-header>
        <div>SUN 10</div>
        <div>MON 11</div>
        <div>TUE 12</div>
        <div>WED 13</div>
        <div>THU 14</div>
        <div>FRI 15</div>
        <div>SAT 16</div>
      </div>
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label>8 AM</div>
          <div data-tsp-hour-label>9 AM</div>
        </div>
      </div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const headers = document.querySelectorAll("[data-tsp-visible-header] > div");

    grid.getBoundingClientRect = () => rect(100, 100, 700, 600);
    scroll.scrollTop = 0;
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);
    headers.forEach((header, index) => {
      header.getBoundingClientRect = () => rect(120 + index * 90, 120, 90, 40);
    });

    const anchor = gridAnchor.findGridAnchor(rootWithUrl("https://calendar.google.com/calendar/u/0/r/week/2026/5/13"));

    expect(anchor.ok).toBe(true);
    expect(anchor.columns).toHaveLength(7);
    expect(anchor.columns[0]).toEqual({ left: 120, right: 210, date: { year: 2026, month: 5, day: 10 } });
    expect(anchor.columns[3]).toEqual({ left: 390, right: 480, date: { year: 2026, month: 5, day: 13 } });
    expect(anchor.columns[6]).toEqual({ left: 660, right: 750, date: { year: 2026, month: 5, day: 16 } });
  });

  test("infers week columns when weekday names and day numbers are split across elements", () => {
    document.body.innerHTML = `
      <span>MON</span><span>11</span>
      <span>TUE</span><span>12</span>
      <span>WED</span><span>13</span>
      <span>THU</span><span>14</span>
      <span>FRI</span><span>15</span>
      <span>SAT</span><span>16</span>
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label>8 AM</div>
          <div data-tsp-hour-label>9 AM</div>
        </div>
      </div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const spans = document.querySelectorAll("span");

    grid.getBoundingClientRect = () => rect(100, 100, 700, 600);
    scroll.scrollTop = 0;
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);
    spans.forEach((span, index) => {
      const columnIndex = Math.floor(index / 2);
      const isNumber = index % 2 === 1;
      span.getBoundingClientRect = () => rect(145 + columnIndex * 100, isNumber ? 135 : 112, 10, 20);
    });

    const anchor = gridAnchor.findGridAnchor(rootWithUrl("https://calendar.google.com/calendar/u/0/r/week/2026/5/13"));

    expect(anchor.ok).toBe(true);
    expect(anchor.columns).toEqual([
      { left: 100, right: 200, date: { year: 2026, month: 5, day: 11 } },
      { left: 200, right: 300, date: { year: 2026, month: 5, day: 12 } },
      { left: 300, right: 400, date: { year: 2026, month: 5, day: 13 } },
      { left: 400, right: 500, date: { year: 2026, month: 5, day: 14 } },
      { left: 500, right: 600, date: { year: 2026, month: 5, day: 15 } },
      { left: 600, right: 700, date: { year: 2026, month: 5, day: 16 } }
    ]);
  });

  test("infers split week columns from the visible month title when the URL has no date", () => {
    document.body.innerHTML = `
      <div>May 2026</div>
      <span>SUN</span><span>10</span>
      <span>MON</span><span>11</span>
      <span>TUE</span><span>12</span>
      <span>WED</span><span>13</span>
      <span>THU</span><span>14</span>
      <span>FRI</span><span>15</span>
      <span>SAT</span><span>16</span>
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label>8 AM</div>
          <div data-tsp-hour-label>9 AM</div>
        </div>
      </div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const spans = document.querySelectorAll("span");

    grid.getBoundingClientRect = () => rect(100, 100, 700, 600);
    scroll.scrollTop = 0;
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);
    spans.forEach((span, index) => {
      const columnIndex = Math.floor(index / 2);
      const isNumber = index % 2 === 1;
      span.getBoundingClientRect = () => rect(145 + columnIndex * 100, isNumber ? 135 : 112, 10, 20);
    });

    const anchor = gridAnchor.findGridAnchor(rootWithUrl("https://calendar.google.com/calendar/u/0/r/week"));

    expect(anchor.ok).toBe(true);
    expect(anchor.columns[0]).toEqual({ left: 100, right: 200, date: { year: 2026, month: 5, day: 10 } });
    expect(anchor.columns[3]).toEqual({ left: 400, right: 500, date: { year: 2026, month: 5, day: 13 } });
    expect(anchor.columnSource).toBe("split-header");
  });

  test("exposes a compact debug snapshot for live Google Calendar DOM probing", () => {
    document.body.innerHTML = `
      <div>May 2026</div>
      <span>WED</span><span>13</span>
      <div role="columnheader" data-date="2026-05-13">Wed 13</div>
      <div data-tsp-time-grid>
        <div data-tsp-hour-label>8 AM</div>
        <div data-tsp-hour-label>9 AM</div>
      </div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const spans = document.querySelectorAll("span");
    const header = document.querySelector("[role='columnheader']");

    grid.getBoundingClientRect = () => rect(100, 100, 700, 600);
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);
    spans[0].getBoundingClientRect = () => rect(445, 112, 10, 20);
    spans[1].getBoundingClientRect = () => rect(445, 135, 10, 20);
    header.getBoundingClientRect = () => rect(400, 80, 100, 40);

    const snapshot = gridAnchor.debugSnapshot(rootWithUrl("https://calendar.google.com/calendar/u/0/r/week"));

    expect(snapshot.href).toBe("https://calendar.google.com/calendar/u/0/r/week");
    expect(snapshot.monthYear).toEqual({ year: 2026, month: 5 });
    expect(snapshot.gridRect).toEqual({ left: 100, top: 100, right: 800, bottom: 700, width: 700, height: 600 });
    expect(snapshot.anchor.calibration).toEqual({
      gridRectTop: 100,
      scrollTop: 0,
      pixelsPerHour: 60,
      gridStartHour: 7
    });
    expect(snapshot.anchor.columnCount).toBe(1);
    expect(snapshot.gridCandidates[0].rect).toEqual({ left: 100, top: 100, right: 800, bottom: 700, width: 700, height: 600 });
    expect(snapshot.hourCandidates.map((candidate) => candidate.hour)).toEqual([8, 9]);
    expect(snapshot.headerCandidates.some((candidate) => candidate.text === "13")).toBe(true);
  });

  test("ignores implausible month-year text while probing visible calendar title", () => {
    document.body.innerHTML = `
      <div>May 1612</div>
      <div>May 2026</div>
      <div data-tsp-time-grid>
        <div data-tsp-hour-label>8 AM</div>
        <div data-tsp-hour-label>9 AM</div>
      </div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");

    grid.getBoundingClientRect = () => rect(100, 100, 700, 600);
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);

    const snapshot = gridAnchor.debugSnapshot(rootWithUrl("https://calendar.google.com/calendar/u/0/r/week?pli=1"));

    expect(snapshot.monthYear).toEqual({ year: 2026, month: 5 });
  });

  test("uses a single day column from the Google Calendar day URL when headers are absent", () => {
    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label>8 AM</div>
          <div data-tsp-hour-label>9 AM</div>
        </div>
      </div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");

    grid.getBoundingClientRect = () => rect(100, 100, 300, 600);
    scroll.scrollTop = 0;
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);

    const anchor = gridAnchor.findGridAnchor(rootWithUrl("https://calendar.google.com/calendar/u/0/r/day/2026/5/13"));

    expect(anchor.ok).toBe(true);
    expect(anchor.columns).toEqual([
      { left: 100, right: 400, date: { year: 2026, month: 5, day: 13 } }
    ]);
  });

  test("uses locale week start for week URL fallback when visible headers are absent", () => {
    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label>8 AM</div>
          <div data-tsp-hour-label>9 AM</div>
        </div>
      </div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");

    grid.getBoundingClientRect = () => rect(100, 100, 700, 600);
    scroll.scrollTop = 0;
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);

    const anchor = gridAnchor.findGridAnchor(rootWithUrl("https://calendar.google.com/calendar/u/0/r/week/2026/5/13", "en-GB"));

    expect(anchor.ok).toBe(true);
    expect(anchor.columns[0]).toEqual({ left: 100, right: 200, date: { year: 2026, month: 5, day: 11 } });
    expect(anchor.columns[6]).toEqual({ left: 700, right: 800, date: { year: 2026, month: 5, day: 17 } });
  });

  test("ignores event titles that contain times when calibrating hour labels", () => {
    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div>Prep call 7 AM</div>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label>8 AM</div>
          <div data-tsp-hour-label>9 AM</div>
        </div>
      </div>
      <div role="columnheader" data-date="2026-05-13">Wed 13</div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const event = document.querySelector("[data-tsp-time-grid] > div");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const header = document.querySelector("[role='columnheader']");

    grid.getBoundingClientRect = () => rect(100, 100, 300, 600);
    event.getBoundingClientRect = () => rect(140, 120, 200, 30);
    scroll.scrollTop = 0;
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);
    header.getBoundingClientRect = () => rect(100, 50, 300, 40);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(anchor.calibration.pixelsPerHour).toBe(60);
    expect(anchor.calibration.gridStartHour).toBe(7);
  });

  test("uses aria-label-only hour labels for calibration", () => {
    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label aria-label="8 AM"></div>
          <div data-tsp-hour-label aria-label="9 AM"></div>
        </div>
      </div>
      <div role="columnheader" data-date="2026-05-13">Wed 13</div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const header = document.querySelector("[role='columnheader']");

    grid.getBoundingClientRect = () => rect(100, 100, 300, 600);
    scroll.scrollTop = 0;
    labels[0].getBoundingClientRect = () => rect(40, 160, 40, 20);
    labels[1].getBoundingClientRect = () => rect(40, 220, 40, 20);
    header.getBoundingClientRect = () => rect(100, 50, 300, 40);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(anchor.calibration.pixelsPerHour).toBe(60);
  });

  test("reports selectable bounds from day columns and calibrated time rows", () => {
    document.body.innerHTML = `
      <div data-tsp-time-grid>
        <div data-tsp-scroll style="height: 600px; overflow: auto">
          <div data-tsp-hour-label>8 AM</div>
          <div data-tsp-hour-label>9 AM</div>
        </div>
      </div>
      <div role="columnheader" data-date="2026-05-13">Wed 13</div>
      <div role="columnheader" data-date="2026-05-14">Thu 14</div>
    `;

    const grid = document.querySelector("[data-tsp-time-grid]");
    const scroll = document.querySelector("[data-tsp-scroll]");
    const labels = document.querySelectorAll("[data-tsp-hour-label]");
    const headers = document.querySelectorAll("[role='columnheader']");

    grid.getBoundingClientRect = () => rect(50, 100, 900, 700);
    scroll.scrollTop = 0;
    labels[0].getBoundingClientRect = () => rect(20, 300, 40, 20);
    labels[1].getBoundingClientRect = () => rect(20, 360, 40, 20);
    headers[0].getBoundingClientRect = () => rect(200, 80, 300, 40);
    headers[1].getBoundingClientRect = () => rect(500, 80, 300, 40);

    const anchor = gridAnchor.findGridAnchor(document);

    expect(anchor.ok).toBe(true);
    expect(anchor.bounds).toEqual({
      left: 200,
      top: 240,
      right: 800,
      bottom: 800,
      width: 600,
      height: 560
    });
  });
});
