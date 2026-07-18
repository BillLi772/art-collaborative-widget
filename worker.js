// The Art Collaborative — "Next Gathering" widget
// Cloudflare Worker: serves the widget page and a JSON API backed by Eventbrite.

const CACHE_TTL_SECONDS = 15 * 60;
const EVENTBRITE_API = 'https://www.eventbriteapi.com/v3';

const DEMO_EVENTS = [
  {
    title: 'The Show Behind the Show',
    url: 'https://www.eventbrite.com/e/the-show-behind-the-show-tickets-000000000000',
    summary: 'A behind-the-curtain look at how a Muny production comes together, from first read to opening night.',
    start: '2026-07-23T15:00:00',
    end: '2026-07-23T16:30:00',
    timezone: 'America/Chicago',
    venueName: 'St. Louis Muny Theater',
    address: '1 Theatre Drive, St. Louis, MO 63112',
  },
  {
    title: 'Clay & Conversation',
    url: 'https://www.eventbrite.com/e/clay-and-conversation-tickets-000000000001',
    summary: 'A relaxed evening of hand-building pottery and gallery talk.',
    start: '2026-09-12T18:00:00',
    end: '2026-09-12T20:00:00',
    timezone: 'America/Chicago',
    venueName: 'Third Degree Glass Factory',
    address: '5200 Delmar Blvd, St. Louis, MO 63108',
  },
  {
    title: 'Winter Salon: Small Works',
    url: 'https://www.eventbrite.com/e/winter-salon-small-works-tickets-000000000002',
    summary: '',
    start: '2026-12-05T17:00:00',
    end: '2026-12-05T19:00:00',
    timezone: 'America/Chicago',
    venueName: 'The Luminary',
    address: '2701 Cherokee St, St. Louis, MO 63118',
  },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isDemo = url.searchParams.get('demo') === '1';

    if (url.pathname === '/api/next') {
      return handleApiNext(request, env, ctx, isDemo);
    }

    if (url.pathname === '/') {
      return new Response(renderPage(isDemo), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

async function handleApiNext(request, env, ctx, isDemo) {
  if (isDemo) {
    return jsonResponse({ ok: true, events: DEMO_EVENTS });
  }

  if (!env.EVENTBRITE_TOKEN) {
    return jsonResponse({ ok: false, message: 'Setup is incomplete: the Eventbrite token has not been configured yet.' });
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/next', request.url).toString(), request);

  try {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch (err) {
    // Cache API is unavailable in local dev — fall through and fetch live.
  }

  let result;
  try {
    result = await fetchNextEvents(env);
  } catch (err) {
    return jsonResponse({ ok: false, message: 'Could not load events right now. Please try again later.' });
  }

  const response = jsonResponse(result, result.ok ? CACHE_TTL_SECONDS : 0);

  if (result.ok) {
    try {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    } catch (err) {
      // Cache API is unavailable in local dev — safe to ignore.
    }
  }

  return response;
}

function jsonResponse(body, cacheSeconds) {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (cacheSeconds) {
    headers['cache-control'] = `public, max-age=${cacheSeconds}`;
  } else {
    headers['cache-control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { headers });
}

async function fetchNextEvents(env) {
  const orgId = env.EVENTBRITE_ORG_ID || (await resolveOrganizationId(env.EVENTBRITE_TOKEN));

  if (!orgId) {
    return { ok: false, message: 'Setup is incomplete: no Eventbrite organization was found for this token.' };
  }

  const eventsUrl = `${EVENTBRITE_API}/organizations/${orgId}/events/?status=live&order_by=start_asc&expand=venue&page_size=6`;
  const res = await fetch(eventsUrl, {
    headers: { Authorization: `Bearer ${env.EVENTBRITE_TOKEN}` },
  });

  if (!res.ok) {
    return { ok: false, message: 'Could not load events right now. Please try again later.' };
  }

  const data = await res.json();
  const events = (data.events || []).map(mapEvent);

  return { ok: true, events };
}

async function resolveOrganizationId(token) {
  const res = await fetch(`${EVENTBRITE_API}/users/me/organizations/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const orgs = data.organizations || [];
  return orgs.length ? orgs[0].id : null;
}

function mapEvent(event) {
  const venue = event.venue || {};
  const address = venue.address || {};
  return {
    title: event.name?.text || '',
    url: event.url || '',
    summary: event.summary || '',
    start: event.start?.local || '',
    end: event.end?.local || '',
    timezone: event.start?.timezone || '',
    venueName: venue.name || '',
    address: address.localized_address_display || '',
  };
}

// ---------------------------------------------------------------------------
// HTML page
// ---------------------------------------------------------------------------

function renderPage(isDemo) {
  const apiUrl = isDemo ? '/api/next?demo=1' : '/api/next';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Next Gathering — The Art Collaborative</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
${CSS}
</style>
</head>
<body>
<div id="root">
  <div class="card" id="card">
    <span class="skeleton" style="width:38%;margin-bottom:14px;"></span>
    <span class="skeleton" style="width:80%;height:16px;margin-bottom:10px;"></span>
    <span class="skeleton" style="width:60%;margin-bottom:20px;"></span>
    <span class="skeleton" style="width:70%;margin-bottom:8px;"></span>
    <span class="skeleton" style="width:45%;"></span>
  </div>
</div>
<script>
${CLIENT_JS.replace('__API_URL__', apiUrl)}
</script>
</body>
</html>`;
}

const CSS = `
:root {
  --paper: #FBFBFB;
  --ink: #1A1918;
  --muted: #5E5858;
  --line: #E7E5E3;
  --accent: #5E5858;
  --accent-dark: #3B3737;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: transparent;
}

body {
  font-family: 'Poppins', sans-serif;
  font-weight: 300;
  color: var(--ink);
  display: flex;
  justify-content: center;
  padding: 14px 10px;
}

#root {
  width: 100%;
  max-width: 380px;
}

.card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 2px rgba(26, 25, 24, 0.03), 0 10px 24px -12px rgba(26, 25, 24, 0.10);
  opacity: 0;
  transform: translateY(8px);
  animation: rise 450ms ease-out forwards;
}

@media (prefers-reduced-motion: reduce) {
  .card { animation: none; opacity: 1; transform: none; }
}

@keyframes rise {
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 420px) {
  .card { padding: 18px; }
}

.error-line {
  font-size: 13px;
  color: var(--muted);
  margin: 0;
}

.skeleton {
  display: block;
  height: 10px;
  border-radius: 5px;
  background: linear-gradient(90deg, var(--line) 25%, #F1EFED 37%, var(--line) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.6s ease infinite;
}

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
}

@keyframes shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 12px;
}

.eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
  box-shadow: 0 0 0 3px rgba(94, 88, 88, 0.10);
}

.title {
  font-family: 'Poppins', sans-serif;
  font-style: normal;
  font-weight: 500;
  font-size: clamp(18px, 4.5vw, 21px);
  line-height: 1.35;
  letter-spacing: -0.01em;
  margin: 0 0 7px;
}

.title a {
  color: var(--ink);
  text-decoration: none;
  background-image: linear-gradient(var(--accent-dark), var(--accent-dark));
  background-position: 0 100%;
  background-repeat: no-repeat;
  background-size: 0 1px;
  transition: background-size 200ms ease, color 150ms ease;
}

.title a:hover {
  color: var(--accent-dark);
  background-size: 100% 1px;
}

.summary {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--muted);
  margin: 0 0 16px;
}

.rule {
  width: 28px;
  height: 1px;
  background: var(--line);
  border: none;
  margin: 0 0 16px;
}

.meta-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 8px;
}

.meta-row:last-of-type { margin-bottom: 18px; }

.meta-icon {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 1px;
  color: var(--muted);
}

.date-line {
  font-size: 13px;
  font-weight: 500;
  margin: 0;
}

.venue-block { line-height: 1.5; }

.venue-name {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0 0 2px;
}

.address {
  font-size: 12.5px;
  color: var(--muted);
  margin: 0;
}

.address a {
  color: var(--muted);
  text-decoration: underline;
  text-decoration-color: var(--line);
  text-underline-offset: 2px;
}

.address a:hover {
  color: var(--ink);
  text-decoration-color: currentColor;
}

.actions {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.rsvp-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: transparent;
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0.02em;
  padding: 10px 20px;
  border: 1px solid var(--muted);
  border-radius: 8px;
  transition: background 150ms ease, color 150ms ease, transform 150ms ease;
}

.rsvp-btn:hover {
  background: var(--muted);
  color: var(--paper);
  transform: translateY(-1px);
}

.rsvp-btn:active {
  transform: translateY(0);
}

.rsvp-btn svg {
  transition: transform 150ms ease;
}

.rsvp-btn:hover svg {
  transform: translateX(2px);
}

.cal-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  text-decoration: underline;
  text-decoration-color: var(--line);
  text-underline-offset: 2px;
  font-size: 11.5px;
  font-weight: 400;
  transition: color 150ms ease;
}

.cal-link:hover {
  color: var(--accent-dark);
  text-decoration-color: currentColor;
}

a:focus-visible, button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 3px;
}

.empty-line {
  font-family: 'Poppins', sans-serif;
  font-weight: 500;
  font-size: 15px;
  margin: 0 0 8px;
}

.empty-sub {
  font-size: 12.5px;
  color: var(--muted);
  margin: 0;
}
`;

const CLIENT_JS = `
(function () {
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function parseLocal(str) {
    // "2026-07-23T15:00:00" — never run through Date's timezone math.
    var m = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/.exec(str || '');
    if (!m) return null;
    return {
      year: parseInt(m[1], 10),
      month: parseInt(m[2], 10),
      day: parseInt(m[3], 10),
      hour: parseInt(m[4], 10),
      minute: parseInt(m[5], 10),
    };
  }

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function weekdayFromDate(y, m, d) {
    // Zeller-independent: use Date only for the day-of-week lookup on a
    // date-only value, which has no timezone ambiguity at UTC noon.
    var dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return DAY_NAMES[dt.getUTCDay()];
  }

  function formatDateLong(p) {
    return weekdayFromDate(p.year, p.month, p.day) + ', ' + MONTH_NAMES[p.month - 1] + ' ' + p.day + ', ' + p.year;
  }

  function formatTime(p) {
    var h = p.hour % 12;
    if (h === 0) h = 12;
    var ampm = p.hour < 12 ? 'AM' : 'PM';
    var minute = p.minute < 10 ? '0' + p.minute : String(p.minute);
    return { hour: h, minute: minute, ampm: ampm };
  }

  function formatTimeRange(startP, endP) {
    var start = formatTime(startP);
    var end = formatTime(endP);
    var startStr = start.hour + (start.minute !== '00' ? ':' + start.minute : '');
    var endStr = end.hour + (end.minute !== '00' ? ':' + end.minute : '');
    if (start.ampm === end.ampm) {
      return startStr + '\\u2013' + endStr + ' ' + end.ampm;
    }
    return startStr + ' ' + start.ampm + '\\u2013' + endStr + ' ' + end.ampm;
  }

  function mapsUrl(venueName, address) {
    var q = encodeURIComponent([venueName, address].filter(Boolean).join(', '));
    return 'https://www.google.com/maps/search/?api=1&query=' + q;
  }

  function gcalUrl(ev, startP, endP) {
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function stamp(p) {
      return p.year + pad(p.month) + pad(p.day) + 'T' + pad(p.hour) + pad(p.minute) + '00';
    }
    var params = new URLSearchParams({
      action: 'TEMPLATE',
      text: ev.title || '',
      dates: stamp(startP) + '/' + stamp(endP),
      details: ev.summary || '',
      location: [ev.venueName, ev.address].filter(Boolean).join(', '),
      ctz: ev.timezone || '',
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function renderEmpty() {
    return '' +
      '<p class="empty-line">The next gathering has not been announced yet.</p>' +
      '<p class="empty-sub">Join the mailing list to hear the moment it is.</p>';
  }

  function renderError(message) {
    return '<p class="error-line">' + escapeHtml(message || 'The next gathering could not be loaded right now.') + '</p>';
  }

  var ICON_CALENDAR = '<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><line x1="16" y1="3" x2="16" y2="7"></line><line x1="8" y1="3" x2="8" y2="7"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
  var ICON_PIN = '<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
  var ICON_ARROW = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
  var ICON_CAL_PLUS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><line x1="12" y1="13" x2="12" y2="18"></line><line x1="9.5" y1="15.5" x2="14.5" y2="15.5"></line></svg>';

  function renderNext(ev) {
    var startP = parseLocal(ev.start);
    var endP = parseLocal(ev.end);
    var dateLine = startP && endP
      ? formatDateLong(startP) + ' \\u00b7 ' + formatTimeRange(startP, endP)
      : '';

    var summaryHtml = ev.summary
      ? '<p class="summary">' + escapeHtml(ev.summary) + '</p>'
      : '';

    var addressHtml = ev.address
      ? '<a href="' + mapsUrl(ev.venueName, ev.address) + '" target="_blank" rel="noopener">' + escapeHtml(ev.address) + '</a>'
      : escapeHtml(ev.address);

    var calHtml = (startP && endP)
      ? '<a class="cal-link" href="' + gcalUrl(ev, startP, endP) + '" target="_blank" rel="noopener">' + ICON_CAL_PLUS + 'Add to calendar</a>'
      : '';

    return '' +
      '<p class="eyebrow"><span class="dot"></span>Next Gathering</p>' +
      '<h2 class="title"><a href="' + escapeHtml(ev.url) + '" target="_blank" rel="noopener">' + escapeHtml(ev.title) + '</a></h2>' +
      summaryHtml +
      '<hr class="rule">' +
      '<div class="meta-row">' + ICON_CALENDAR + '<p class="date-line">' + escapeHtml(dateLine) + '</p></div>' +
      '<div class="meta-row">' + ICON_PIN + '<div class="venue-block"><p class="venue-name">' + escapeHtml(ev.venueName) + '</p><p class="address">' + addressHtml + '</p></div></div>' +
      '<div class="actions">' +
        '<a class="rsvp-btn" href="' + escapeHtml(ev.url) + '" target="_blank" rel="noopener">RSVP on Eventbrite' + ICON_ARROW + '</a>' +
        calHtml +
      '</div>';
  }

  function render(html) {
    document.getElementById('card').innerHTML = html;
  }

  fetch('__API_URL__')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.ok) {
        render(renderError(data.message));
        return;
      }
      var events = data.events || [];
      if (!events.length) {
        render(renderEmpty());
        return;
      }
      render(renderNext(events[0]));
    })
    .catch(function () {
      render(renderError('The next gathering could not be loaded right now.'));
    });
})();
`;
