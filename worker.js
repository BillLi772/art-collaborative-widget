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
    <p class="loading">Loading next gathering…</p>
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
  max-width: 360px;
}

.card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 20px;
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

@media (max-width: 400px) {
  .card { padding: 16px; }
}

.loading, .error-line {
  font-size: 13px;
  color: var(--muted);
  margin: 0;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 10px;
}

.eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}

.title {
  font-family: 'Poppins', sans-serif;
  font-style: normal;
  font-weight: 500;
  font-size: clamp(17px, 4.5vw, 20px);
  line-height: 1.35;
  margin: 0 0 6px;
}

.title a {
  color: var(--ink);
  text-decoration: none;
}

.title a:hover {
  color: var(--accent-dark);
}

.summary {
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
  margin: 0 0 12px;
}

.rule {
  width: 30px;
  height: 1px;
  background: var(--line);
  border: none;
  margin: 0 0 12px;
}

.date-line {
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 10px;
}

.venue-name {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  margin: 0 0 3px;
}

.address {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 16px;
}

.address a {
  color: var(--muted);
  text-decoration: underline;
}

.actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.rsvp-btn {
  display: inline-block;
  background: var(--accent);
  color: var(--paper);
  text-decoration: none;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 9px 14px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  transition: background 150ms ease, border-color 150ms ease;
}

.rsvp-btn:hover {
  background: var(--accent-dark);
  border-color: var(--accent-dark);
}

.cal-link {
  color: var(--muted);
  text-decoration: underline;
  font-size: 11px;
  font-weight: 400;
}

.cal-link:hover {
  color: var(--accent-dark);
}

a:focus-visible, button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.also-ahead {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.also-ahead h3 {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 8px;
}

.also-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
  margin: 0 0 6px;
}

.also-row:last-child { margin-bottom: 0; }

.also-date {
  color: var(--muted);
  flex: none;
  width: 44px;
}

.also-title {
  font-family: 'Poppins', sans-serif;
  font-weight: 500;
}

.also-title a {
  color: var(--ink);
  text-decoration: none;
}

.also-title a:hover {
  color: var(--accent-dark);
}

.empty-line {
  font-family: 'Poppins', sans-serif;
  font-weight: 500;
  font-size: 15px;
  margin: 0 0 8px;
}

.empty-sub {
  font-size: 12px;
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

  function formatShortDate(p) {
    return MONTH_NAMES[p.month - 1].slice(0, 3) + ' ' + p.day;
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

  function renderAlsoAhead(events) {
    if (!events.length) return '';
    var rows = events.map(function (ev) {
      var p = parseLocal(ev.start);
      var dateStr = p ? formatShortDate(p) : '';
      return '' +
        '<div class="also-row">' +
          '<span class="also-date">' + escapeHtml(dateStr) + '</span>' +
          '<span class="also-title"><a href="' + escapeHtml(ev.url) + '" target="_blank" rel="noopener">' + escapeHtml(ev.title) + '</a></span>' +
        '</div>';
    }).join('');
    return '<div class="also-ahead"><h3>Also Ahead</h3>' + rows + '</div>';
  }

  function renderNext(ev, rest) {
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
      ? '<a class="cal-link" href="' + gcalUrl(ev, startP, endP) + '" target="_blank" rel="noopener">Add to calendar</a>'
      : '';

    return '' +
      '<p class="eyebrow"><span class="dot"></span>Next Gathering</p>' +
      '<h2 class="title"><a href="' + escapeHtml(ev.url) + '" target="_blank" rel="noopener">' + escapeHtml(ev.title) + '</a></h2>' +
      summaryHtml +
      '<hr class="rule">' +
      '<p class="date-line">' + escapeHtml(dateLine) + '</p>' +
      '<p class="venue-name">' + escapeHtml(ev.venueName) + '</p>' +
      '<p class="address">' + addressHtml + '</p>' +
      '<div class="actions">' +
        '<a class="rsvp-btn" href="' + escapeHtml(ev.url) + '" target="_blank" rel="noopener">RSVP on Eventbrite</a>' +
        calHtml +
      '</div>' +
      renderAlsoAhead(rest);
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
      render(renderNext(events[0], events.slice(1, 3)));
    })
    .catch(function () {
      render(renderError('The next gathering could not be loaded right now.'));
    });
})();
`;
