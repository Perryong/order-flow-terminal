# Profile Confirmation Implementation Plan

User authorization: add POC/VAH/VAL confirmation to the setup scanner; keep notifications disabled. Execute inline using the existing application and tests.

## Design
- Default scanner view: Profile confirmed. All order flow remains available in a separate selector.
- Uses selected 15/30/60-minute profile, even when overlay hidden. Requires complete selected history, at least three traded price rows, no known gap, and fresh provider-timed trade/depth (1.5 seconds).
- A trade within one price row of POC/VAH/VAL starts a candidate; freeze all three levels, range, row size, touch time and approach side then. Candidate expires after 60 seconds or movement beyond three rows.
- Confirm only on a subsequent existing absorption/sweep/exhaustion/iceberg signal in the direction price has moved at least one row from that level, no farther than three rows, with matching 60-second classified delta and no unclassified volume. Signal must follow touch and be <=5 seconds old. This is a rule-based conjunction, not a win-rate estimate or a retest guarantee.
- One entry per level/direction/range per 60 seconds. Capture current execution price and both confirmation time and original flow trigger. Historical cards never change with later levels.
- Replay computes causally from recorded events, labeled replay. No future data, backfill confirmations or notification calls. Live reconnects record gaps. Resets on market, range or configuration changes; recording rollover preserves state. Existing raw scanner and notifications untouched.

## Tasks
- [x] Add core/profile-confirmation.js and regression tests first: long/short at all levels, opposing/unknown delta, stale or receipt-only data, incomplete/gapped profiles, frozen values, expiry, duplicate signals, out-of-order events.
- [x] Integrate event processing, scanner filter/status/cards, static route/script; preserve rollover and reset/rebuild behavior. Document exact rules in README.
- [x] Run Node/Python suites; deterministic browser check for confirmed/replay cards, range/reset/rollover, notifications off, screenshots and local server route. Independent read-only review and fix significant issues.

## Verification and review
- 49 Node tests and 14 Python tests pass.
- Deterministic browser fixture confirmed a POC long from actual engine sweep output; verified frozen card details, raw view, seek/replay, range warm-up, rollover, reset, overlay independence and mobile layout. Prior overlay browser regression also passes.
- Independent review identified late-volume omission and false coverage after long reconnects. Regression tests failed first; fixes record late volume without moving price and track continuous coverage through recovery. Full suites pass afterward.
- Live BTCUSDT: trade age 0.2s and depth age 0.0s; incomplete profile correctly blocked confirmation. No claim of a live confirmed trade during the short check.
- Desktop=false, phone topic empty, LaunchAgent disabled, no watcher process. No remote publish.
