# GitHub Pages with Mac data server

User request: commit and push current code, publish GitHub Pages, and use the MacBook to serve market data. Notifications remain disabled.

## Implementation
- Static allowlisted Pages artifact; relative asset/navigation paths; configurable HTTPS API origin, no credentials in browser config or artifact.
- Same Python backend provides equity SSE, spot/reference JSON and crypto SSE relayed by an existing Node runtime. Crypto history and live streams originate from the Mac for the hosted site. Local browser mode remains supported.
- Explicit backend host and CORS origin allowlists, no wildcard CORS, no arbitrary upstream proxy. Transport/access choice pending user's private Tailscale vs authenticated public endpoint selection.
- Read-only health endpoint verifies Mac availability. Existing disabled notification watcher remains disabled; swing data may remain unavailable without its collector and must be labeled honestly.
- Tests for backend origin configuration, Pages paths/build allowlist, CORS/Host and crypto relay lifecycle. Run existing suites and verify deployed Pages and actual HTTPS data routes.
- Commit audited changes, fast-forward main if safe, push, configure Pages Actions and verify deployment.
