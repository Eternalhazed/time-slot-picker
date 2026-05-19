# Manual Test Checklist

Run these after `npm test` passes and the unpacked extension is loaded from `extension/`.

## Core flow
- Open `https://calendar.google.com/` in Week view.
- Confirm the Time Slot Picker sidebar appears.
- Confirm the sidebar account scope matches the URL path, such as `u/0`.
- Confirm the calendar timezone label matches your browser's detected timezone on first install.
- Select 30 minutes, turn on Select Mode, and click a free slot.
- Confirm the copied text panel shows the expected date and time.
- Click Copy and paste into a scratch email or text field.
- Click inside the same selected slot and confirm it is removed.
- Click a slot that would overlap an existing slot and confirm it is rejected with the error visible for at least a moment (not stomped by Ready).
- Reload Google Calendar and confirm the selected slots are still present.
- Switch between Week and Day view and confirm the extension either remains ready or shows a visible paused message.
- Visit a different account path such as `/u/1/` and confirm prior `/u/0/` selections are not shown.
- Clear selections and reload to confirm they stay cleared.

## Timezone UX
- Open the Calendar timezone dropdown and confirm grouped options appear in order: Detected, United States (ET / CT / MT / MST / PT / AKT / HT), International, then a full alphabetical list.
- Change the Copy timezone and confirm only the output text changes (markers on the grid stay aligned with their original calendar wall time).
- Click "Detect" and confirm both timezone selects snap back to your browser timezone.
- Uncheck "Auto-snap to my timezone", change Calendar timezone manually, reload the tab, and confirm your manual choice persists.
- With "Auto-snap" on, switch to another tab and back; confirm the timezones remain on the detected zone.

## Copy format
- Toggle 12-hour ↔ 24-hour and confirm the Copy preview and (after Copy) the clipboard text both update.
- Uncheck "Include date headers" and confirm the output is a single flat list of time ranges.
- Uncheck "Include timezone label" and confirm the trailing `ET`/`UTC`/etc. disappears.

## Slot management
- Add a slot whose end is in the past (e.g., shift the system clock or use an existing past slot from a prior session) and confirm it appears with a strikethrough.
- Click "Clear past (N)" and confirm only past slots are removed; the count badge resets.
- Confirm Undo restores the cleared past slots.
- Press Escape while in Select Mode and confirm the overlay disappears and the status reads "Select mode off."

## Edge cases
- Open a second Google Calendar tab; change duration in one — confirm the other tab eventually reflects the new duration (via `chrome.storage.onChanged`) without the local change being clobbered if you were mid-edit.
- Open the extension on `/u/0` with 200 slots; confirm the sidebar paints in under a second and Clear all still works.
- Switch the system to a timezone that does not exist anymore (manually tamper localStorage if needed) and confirm the extension falls back to UTC without throwing.

## Compact UI
- Confirm the panel is 268px wide at desktop widths and narrows to 244px at viewports under 1100px wide.
- Confirm the panel anchors near the top of the viewport (76px) at desktop heights and shifts up to 64px at viewports under 720px tall.
- Confirm the Timezones, Format, and Shortcuts sections are collapsible `<details>` blocks with informative summary text (e.g. "PT → ET", "24h · no dates", "12h").
- On first install when calendar zone and output zone differ, the Timezones section should auto-open.
- Toggling a section open/closed should persist across reloads.
- Confirm the slot-list day headers stick to the top of the slot-list as you scroll.
- Confirm past slots in the list render with strikethrough (use the dev console to insert a past slot, or wait for a real one to tick past — the in-app "Past + future mixed" scenario in `docs/visual-harness.html` shows this if you skip the init-prune).

## Performance
- Open the extension, switch to another tab — confirm in DevTools Performance that the periodic timers stop firing while the tab is hidden.
- Return to the tab — confirm one immediate refresh runs and the periodic timers restart.
- With 60+ slots, confirm dragging across the calendar still feels responsive (no frame drops near the markers layer).

## Output quality
- With 5 past + 5 future slots and "Hide past slots in copy" on (default), confirm Copy preview shows only the 5 future ones.
- Uncheck "Hide past slots in copy" and confirm the past slots appear in the preview/clipboard.
- Switch 24-hour and confirm the preview shows 14:30 instead of 2:30 PM.

## Visual harness
- Open `docs/visual-harness.html` via a local server (e.g. `python -m http.server --bind 127.0.0.1`) to exercise the sidebar across pre-built scenarios (fresh, selecting, cross-zone, capacity, error, collapsed) without needing a real Google Calendar tab.
