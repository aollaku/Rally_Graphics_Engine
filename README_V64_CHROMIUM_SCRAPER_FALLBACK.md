# V64 – Chromium scraper fallback

When Axios receives a Cloudflare browser-check page from the DJames results site, the scraper now retries the same public page using the Chromium browser already installed in the application container.

The fallback:
- executes page JavaScript;
- waits before dumping the rendered DOM;
- detects whether Cloudflare is still showing its challenge;
- caches successful HTML using the existing scraper cache;
- records clear success/failure messages in `docker compose logs app1`.

Environment options:

```env
SCRAPER_BROWSER_FALLBACK=true
SCRAPER_BROWSER_WAIT_MS=15000
SCRAPER_BROWSER_TIMEOUT_MS=35000
```

This fallback does not guarantee access when the upstream explicitly disallows datacentre IP addresses. In that case, whitelisting or an authorised relay remains necessary.
