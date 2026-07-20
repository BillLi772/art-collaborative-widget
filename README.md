# Art Collaborative — Next Gathering Widget

A small Cloudflare Worker that serves a "Next Gathering" placard widget for
The Art Collaborative, pulling upcoming events live from Judith Shaw's
Eventbrite account. No framework, no build step — one plain JS module.

## Routes

- `GET /` — the widget HTML page (meant to be embedded in an iframe).
- `GET /api/next` — JSON of upcoming events, shaped for the widget.
- Both accept `?demo=1` to return hardcoded sample data, useful for testing
  before the Eventbrite token is set.

## Setup

1. Install dependencies / confirm Wrangler is available:

   ```bash
   npx wrangler --version
   ```

2. Deploy the Worker:

   ```bash
   npx wrangler deploy
   ```

3. Set the Eventbrite token as a secret (do this yourself — the token should
   never be typed into a file or shared with anyone else, including an
   assistant):

   ```bash
   npx wrangler secret put EVENTBRITE_TOKEN
   ```

   Get the token from Judith's Eventbrite account under
   **Account Settings → Developer Links → API Keys**.

4. Optional: if the token's account belongs to more than one Eventbrite
   organization and the wrong one gets picked, pin it explicitly:

   ```bash
   npx wrangler secret put EVENTBRITE_ORG_ID
   ```

   By default the Worker resolves the organization automatically via
   `GET /v3/users/me/organizations/` and uses the first one returned.

## How it works

- The Worker fetches `GET /v3/organizations/{id}/events/?status=live&order_by=start_asc&expand=venue&page_size=6`
  from the Eventbrite API and maps each event to the fields the widget needs
  (title, url, summary, start/end/timezone, venue name, address).
- Results are cached at the edge for 15 minutes (`caches.default`). Past
  events simply age out of the `status=live` filter, so there is nothing to
  prune manually.
- If the token is missing or a request fails, `/api/next` returns
  `{ ok: false, message: "..." }` and the widget renders a single quiet line
  instead of breaking.
- Publishing a new event on Eventbrite is all that's needed to update the
  widget — nothing else to redeploy or refresh.

## Testing

- `https://<your-worker>.workers.dev/?demo=1` — renders the placard with
  sample data, no token required.
- `https://<your-worker>.workers.dev/api/next?demo=1` — the same sample data
  as JSON.
- Once the token is set, `https://<your-worker>.workers.dev/api/next` should
  return the real upcoming events.

## Embedding on Squarespace

Add a **Code Block** to the page and paste:

```html
<iframe
  src="https://<your-worker>.workers.dev/"
  width="100%"
  height="370"
  style="border: 0;"
  loading="lazy"
  title="The Art Collaborative — Next Gathering">
</iframe>
```

The card has no fixed width — it stretches to fill whatever width the
iframe is given, so `width="100%"` makes it match the surrounding text
column exactly (same left/right margins as the rest of the page content).

Adjust `height` to match how tall the card renders at your column's actual
width — wider columns wrap to fewer lines and need less height, narrower
ones (like mobile) need more. If the code block sits in a multi-column row,
give the widget its own row instead; Squarespace stretches blocks to match
the tallest sibling in a row, which can leave a gap below a short block like
this one.

Replace `<your-worker>.workers.dev` with the actual deployed Worker URL (or a
custom route, if one is set up later).
