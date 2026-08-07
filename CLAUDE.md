# Art Collaborative widgets

A single Cloudflare Worker serving two cards embedded in judithshaw.com
(Squarespace) via iframes.

- `/` — **Next Gathering**, built from the soonest live Eventbrite event.
- `/past` — **Past Adventures**, the three most recent finished events plus a
  boxed "See Overview" link to the organizer page.
- `/api/next`, `/api/past` — the JSON behind those cards.
- `?demo=1` on any route returns hardcoded sample data.

Live: https://art-collab-widget.liwenruixxx.workers.dev
(Worker name is `art-collab-widget` — an older placeholder called it
`art-collab-next`; that host does not exist.)

The client is Judith Shaw, an artist who is not technical. She never touches
this repo or the site's event listings — she publishes on Eventbrite, and both
cards follow along within about 15 minutes.

## Rules

- **Never put the Eventbrite token, or any credential, in a file.** It is a
  Cloudflare secret read only as `env.EVENTBRITE_TOKEN`. If one ever gets
  committed, say so immediately: it must be regenerated on Eventbrite, not
  just deleted, because git keeps history.
- **Don't run `wrangler deploy`.** Pushing to `main` deploys automatically via
  Cloudflare's Git integration. Anything on `main` is live on a client site
  within minutes, so prefer a branch and a PR for anything non-trivial.
- The empty-state wording in `renderNext()` (marked `EMPTY STATE`) is
  **client-approved copy**. Don't reword it without asking.
- **Match the host site, don't invent a look.** judithshaw.com is Poppins
  throughout, on white, with thin outlined buttons. The widget deliberately has
  no card, no border, no background fill and no max-width — it runs full width
  so it lines up with the page's own paragraphs. Don't reintroduce card chrome.
- Keep the two cards visually identical. They share one stylesheet on purpose.
- Plain JavaScript, no framework, no build step, no dependencies. Cloudflare
  builds this repo with an empty build command.
- Colors and fonts live in the `:root` CSS variables. Change them there.
- Escape every string from Eventbrite before injecting it into HTML (`esc()`).
- Format dates by slicing the `start.local` / `end.local` strings, never with
  `Date` timezone math. Eventbrite already returns local time.

## Gotchas learned the hard way

- The events query must include `expand=venue,logo`. With `expand=venue` alone,
  every event comes back with the organization's default graphic, so all the
  past thumbnails render identically. `slim()` prefers `logo.original.url`.
- Iframe heights are fixed in Squarespace (`390` for `/`, `620` for `/past`)
  because an iframe can't size itself. **If a layout change makes a card
  taller, say so explicitly** — the embed code has to be updated by hand in
  Squarespace, which is a manual step outside this repo.
- Responses carry a 5-minute cache header and events are cached at the edge for
  15 minutes, so after deploying, test with a cache-busting query string
  (`/api/next?t=1`) rather than trusting a browser reload.
- An empty `events` array is usually correct, not a bug — it means nothing
  upcoming is published yet, and the empty state is what should show.

## Verifying a change

```
node --check worker.js
```

Then load `/?demo=1` and `/past?demo=1`. Check the empty state too — it's what
shows most of the year, between quarterly gatherings.

## Context

- Eventbrite organization: `42441313023` (hardcoded as `ORG_ID`; public info).
- Organizer page: https://www.eventbrite.com/o/the-art-collaborative-42441313023
- Page the widgets live on: https://www.judithshaw.com/the-art-collaborative
