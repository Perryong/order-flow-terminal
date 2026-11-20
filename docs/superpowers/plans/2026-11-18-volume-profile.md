# Volume Profile Overlay Implementation Plan

> Execute inline using Superpowers executing-plans. User approved the chart overlay, POC/VAH/VAL, 15/30/60-minute ranges and disabled notifications.

**Goal:** Show executed volume by price beside the existing heatmap and footprint.
**Architecture:** A browser/CommonJS rolling profile collects trades independently of candle aggregation and recording rollover. A canvas side panel shares the chart price scale; its value-area lines cross the candles. No new dependencies.
**Spec:** User-approved design in this chat: overlay, POC, VAH, VAL, independent 15/30/60-minute range, notifications disabled.

## Constraints and decisions
- Default 30-minute range; controls also offer 15 and 60 minutes and an off toggle.
- Completed UTC seconds define rolling windows; refresh once per second, include unknown-side executions, exclude book/spot/liquidation events.
- POC uses highest-volume row (lowest price breaks ties). Value area expands from POC to neighboring traded rows by greater volume until at least 70%; lower side breaks ties. VAL/VAH are row edges.
- Preserve up to 60 minutes across live recording rollovers and candle/row-size changes. Reset on instrument/session switch; rebuild from events on replay seek. No future replay data.
- Show coverage times, partial-history and known-gap labels; no invented historical volume.
- Existing notification defaults and disabled LaunchAgent remain disabled. No new signal/notification behavior.

## Review focus
Window endpoints; unknown-side volume; sparse/tied price rows; replay/rollover isolation; chart scaling and small-screen readability.

## Tasks
- [x] Test then implement `core/volume-profile.js`: `createVolumeProfile()` with `trade(t,price,qty)`, `gap(t)`, `read(t,minutes,bucket)`; test windows, expiry, ties, gaps and invalid/empty input.
- [x] Integrate tracker in `web/terminal.js`, route/script in `server.py` and `web/index.html`, controls/styles and shared-scale overlay in `web/chart.js`. Test reset/replay/rollover and interval independence in browser.
- [x] Document ranges and coverage in the single README. Run Node/Python regressions, browser checks/screenshots and notification-state verification. Review full diff.

## Verification and review
- Node suite: 42 passing; Python suite: 14 passing.
- Headless Chrome: 15/30/60 totals, candle independence, backward/forward replay, rollover preservation, instrument reset, overlay toggle, TPO compatibility, desktop/mobile screenshots, no page errors.
- Live BTCUSDT on port 8791: trades 0.1 s old, depth 0.0 s old, profile populated and partial-history label visible. Browser desktop=false and topic empty. LaunchAgent remains disabled; no watcher processes.
- Independent review found one replay-cache issue with late exchange timestamps. Added failing regression, invalidated affected cached windows on trade/gap, then all 42 tests and browser checks passed.
- Current implementation is local on feat/volume-profile-overlay; no remote publish.
