# Time Slot Picker — Chrome Extension Design

**Status:** Draft
**Date:** 2026-05-06

## Summary

A Manifest V3 Chrome extension for picking time slots on Google Calendar without OAuth or any API integration. The user clicks slots on `calendar.google.com`, the extension stores them, and outputs formatted text in a chosen timezone for pasting into emails or messages.

## Problem

The user previously had a Chrome extension that allowed clicking time slots on Google Calendar to generate shareable text with a timezone toggle. That extension is no longer accessible. Their organization disallows direct integration with Google (no OAuth, no Calendar API) but allows browser plugins. They need a replacement that operates as a non-authenticated DOM-overlay extension.

## Constraints

- Manifest V3 (V2 deprecated)
- No OAuth, no Google Calendar API, no third-party calendar APIs
- Only operates on `calendar.google.com` (narrowest possible host permissions)
- No backend; all state local to browser
- Must survive routine Google Calendar UI updates, or fail gracefully and visibly

## Non-Goals (v1)

- Outlook, iCloud, Calendly, or other calendar surfaces
- Recurring availability templates
- Sharing via link / collaboration features
- Calendar event creation
- Mobile (Chrome extensions don't run on mobile)
- Theme matching of Google's calendar theme
- Non-English locale calendars. v1 assumes the user's Google Calendar renders hour labels in English (e.g., "9 AM"), which covers the user's account. Locale-aware label parsing is a future enhancement.

## Architecture

Manifest V3 Chrome extension, content-script-heavy. Auto-injects on `https://calendar.google.com/*`. The sidebar UI lives inside the page (not a popup); a transparent capture overlay activates only when "Select Mode" is on. State persists in `chrome.storage.local`. A service worker exists only to forward toolbar-icon clicks into the active tab.

All Google-Calendar-specific DOM knowledge lives in a single module (`grid-anchor.js`). Every other component takes the grid element or a `Date` as input and stays oblivious to Google's markup.

## Components

1. **`content.js`** — entrypoint and lifecycle. Detects we're on Google Calendar, mounts the sidebar, runs grid detection, listens for view changes, wires storage.
2. **`sidebar/`** — vanilla HTML/CSS/JS panel (no React; tiny bundle, no Shadow DOM friction). Right edge of viewport, ~320 px wide, collapsible. Contains duration buttons (15/30/45/60), Select Mode toggle, timezone dropdown, live output `<pre>` block, Copy and Clear buttons.
3. **`grid-anchor.js`** — the only file coupled to Google's DOM. Priority-ordered selectors and heuristics to find the time-grid container. Falls back through 3–4 strategies before declaring "grid not found." Re-runs on view change and via `MutationObserver` for major DOM updates.
4. **`capture-overlay.js`** — transparent absolutely-positioned `<div>` over the grid. Created when Select Mode is on; removed when off. Captures `pointerdown`, computes pixel-relative coordinates, hands them to time-utils, applies the resulting slot.
5. **`time-utils.js`** — pure time math. No DOM. Functions: `pixelToTime(y, calibration)`, `pixelToDate(x, weekStart, dayCount)`, `snapToIncrement(time, minutes)`, `formatOutput(selections, timezone)`, `groupByDay(selections)`. Times stored and operated on as UTC; conversion to display zone happens only at format time.
6. **`storage.js`** — thin wrapper around `chrome.storage.local`. One read on load, debounced writes on change. Subscribes to `chrome.storage.onChanged` to sync across tabs.

## Data Model

Stored in `chrome.storage.local`:

```json
{
  "selections": [
    { "id": "uuid", "startUTC": "2026-05-07T13:00:00Z", "endUTC": "2026-05-07T13:30:00Z" }
  ],
  "preferredTimezone": "America/New_York",
  "lastDuration": 30,
  "sidebarOpen": true,
  "selectModeOn": false
}
```

All times are stored in UTC ISO-8601. Display-zone conversion happens at format time only.

## Click-to-Storage Pipeline

```
pointerdown on overlay
  → grid-relative (x, y)
  → pixelToTime(y, calibration)        → "9:07 AM"
  → pixelToDate(x, weekStart, dayCount) → "Tue, May 7"
  → snapToIncrement(time, 15)           → "9:00 AM"
  → buildSlot(date, time, duration)     → { startUTC, endUTC }
  → collisionCheck against existing
      ├─ same start as existing slot → remove (toggle off)
      ├─ overlaps a different slot   → red flash, ignore
      └─ free                         → append, persist, re-render
```

### Grid Calibration

Anchor on hour labels in the time gutter (rather than total grid height, which is unstable):

1. Find ≥ 2 hour-label elements via `grid-anchor`
2. Parse their text → hour numbers
3. Read `getBoundingClientRect().top` for each
4. Compute `pixelsPerHour = (label2.top − label1.top) / (hour2 − hour1)`
5. Compute `gridStartTime = label1.hour − (label1.top − gridRect.top) / pixelsPerHour`

Any click `y` then maps to `gridStartTime + (y − gridRect.top + scrollTop) / pixelsPerHour`. Recalibrate on view change, window resize, and grid-internal scroll.

### Date Axis (Week View)

Read `role="columnheader"` elements at the top of the grid (the role is a stable Web standard even when class names change). Each header's bounding rect defines a column's left/right bounds; the click X falls into exactly one.

In day view, the date is the single visible day.

### Selection Rules

- Clicked time snaps to the nearest 15-minute increment.
- Click that lands **anywhere inside the time range of an existing slot** → remove that slot (toggle off). Not just at the snapped start — anywhere within `[startUTC, endUTC)`.
- New slot overlapping a *different* existing slot → red flash on the conflicting block, no add. (No auto-merge — keeps the data model simple. User clears and re-picks if needed.)
- Slot that would cross midnight (e.g., 11:45 PM + 60 min) → clamp `endUTC` to end-of-day, show brief tooltip "Clamped to 12:00 AM."

## Output Format

Grouped by day, single timezone, live-updating in the sidebar's output panel:

```
Tue, May 7
  9:00 AM – 10:00 AM ET
  2:00 PM – 3:00 PM ET

Wed, May 8
  10:00 AM – 11:00 AM ET
```

Implementation:

- `groupByDay` keyed on `dateInZone(slot.startUTC, displayZone)`
- Sort within each group by `startUTC`
- Render header and lines via `Intl.DateTimeFormat` with the IANA zone
- Friendly zone abbreviation (`ET`, `PT`, etc.) via a small ~12-entry lookup map; fallback is GMT offset

## Timezone Behavior

- Default zone: `Intl.DateTimeFormat().resolvedOptions().timeZone` (browser's local).
- Dropdown options: detected zone (marked default) + ET / PT / CT / MT / UTC / GMT / CET / JST.
- "Add zone…" opens a search input over `Intl.supportedValuesOf('timeZone')` (~600 IANA zones in modern browsers).
- Toggling the zone re-renders the output only. Stored UTC is never mutated.

## Edge Cases & Failure Modes

| Scenario | Behavior |
|---|---|
| Grid detection fails (Google rewrote DOM) | Sidebar shows red banner: "Time grid not detected — extension paused." Select Mode disables. Output still works on previously stored selections. |
| Hour labels unparseable (locale change, etc.) | Same banner; calibration aborts cleanly, no garbage data. |
| Month view active | Sidebar message: "Switch to Week or Day view to select slots." Existing selections still display in output. |
| User scrolls the day vertically | Capture overlay sticky-positioned to grid; selection blocks reposition via grid scroll listener. |
| Window resize / zoom change | Recompute calibration on `resize`; re-render selection blocks. |
| DST transition week | Stored UTC unaffected. `Intl.DateTimeFormat` with the IANA zone handles DST correctly at format time. Tested explicitly. |
| Slot crosses midnight | Clamp `endUTC` to end-of-day; tooltip notification. |
| SPA navigation within calendar.google.com | Content script stays loaded; re-runs grid detection on URL change via `History API` polling. |
| Different account paths (`/u/0/`, `/u/1/`) | Match pattern is `https://calendar.google.com/*`, covers all account paths. |
| Storage quota | Each slot is ~120 bytes; 5 MB quota = ~40K slots. Non-issue. |
| Multiple Google Calendar tabs open | Each tab has its own content-script instance; selections sync via `chrome.storage.onChanged`. |

## Manifest

```json
{
  "manifest_version": 3,
  "name": "Time Slot Picker",
  "version": "0.1.0",
  "description": "Click time slots in Google Calendar, copy as text.",
  "host_permissions": ["https://calendar.google.com/*"],
  "permissions": ["storage"],
  "content_scripts": [{
    "matches": ["https://calendar.google.com/*"],
    "js": ["content.js"],
    "css": ["sidebar.css"],
    "run_at": "document_idle"
  }],
  "background": { "service_worker": "sw.js" },
  "action": { "default_icon": { "16": "icons/16.png", "48": "icons/48.png" } },
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

What's deliberately absent:

- **No `clipboardWrite`** — `navigator.clipboard.writeText()` works without it on user gesture.
- **No `tabs`** — `chrome.action.onClicked` provides the tab automatically.
- **No `<all_urls>`** — extension only ever runs on `calendar.google.com`.
- **No popup** — sidebar lives in the page.

## Testing Strategy

### Unit (Vitest)
Pure functions in `time-utils.js`:

- `pixelToTime` across calibrations including degenerate inputs (negative y, zero `pixelsPerHour`)
- `snapToIncrement` at boundaries (9:07 → 9:00; 9:08 → 9:15)
- `groupByDay` and `formatOutput` across:
  - DST spring-forward week (slot at 2:30 AM on the spring-forward day — should not exist; formatter handles gracefully)
  - DST fall-back week (slot at 1:30 AM on fall-back day is ambiguous — wall-clock 1:30 AM occurs twice). v1 chooses the **second occurrence** (standard time, after the clock rolls back). Pin this in a test.
  - Timezone roundtrip: UTC → display zone → reparse → equals original UTC
  - Multi-day spans, sort stability across equal-start slots

### Integration (jsdom)
- `grid-anchor` against `fixtures/calendar-week-view.html`, a saved snapshot of `calendar.google.com`
- Assert it finds the grid container and at least 2 hour labels
- When this fails, that's the canary for "Google changed their DOM" — re-record fixture, fix selectors

### Manual Checklist (`docs/MANUAL_TESTS.md`)
Things jsdom can't fake:

- Load unpacked → calendar.google.com
- Place slot → reload page → still there
- Toggle timezone → output text updates correctly
- Switch week ↔ day view → selections still aligned
- Click already-selected slot → it disappears
- Click overlapping slot → red flash, no add
- Sidebar collapse / expand persists across reloads
- DST week (next spring-forward / fall-back date)

No CI. Personal-use tool; manual checklist run before each release is appropriate scope.

## Distribution

Personal-use unpacked extension. Loaded via `chrome://extensions/` developer mode. Not published to Chrome Web Store.

## Future Considerations (out of scope for v1)

- ICS import to grey out busy slots in the overlay
- Outlook Web / Calendly / iCloud surfaces
- Recurring availability templates
- Multi-zone simultaneous output (e.g., "9-10 AM ET / 6-7 AM PT" on each line)
- Drag-to-define ranges (currently fixed-duration click placement)
- Optional Google-theme-matched dark mode (currently uses `prefers-color-scheme` only)
