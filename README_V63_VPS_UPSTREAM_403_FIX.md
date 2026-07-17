# v63 – VPS upstream 403 and blank graphics fix

The controller Take operation was working, but the external DJames rally-results server returned HTTP 403 to the VPS. Therefore Preview state changed while the renderer had no rows to display.

Changes:
- Forces scraper outbound requests over IPv4 by default.
- Uses a browser-compatible request session, headers, Referer, cookie warm-up and keep-alive.
- Removes the identifiable RallyGraphics user-agent suffix.
- Adds `SCRAPER_PROXY_BASE` for VPS IP ranges that remain blocked by the results provider.
- Adds `/api/event/:eventId/info` to the public HTTP output API allow-list.
- Preserves session credentials explicitly in controller and renderer fetches.
- Returns a clear diagnostic when the source site blocks the VPS IP.

If direct access is still blocked, set in `.env`:

    SCRAPER_PROXY_BASE=https://your-authorised-relay.example/fetch

The relay receives `?url=<encoded URL>` and must return the requested HTML. Only use a relay or proxy you control or are authorised to use.
