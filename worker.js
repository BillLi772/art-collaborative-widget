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
  --ink: #5E5858;
  --muted: #817A7A;
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
  padding: 0;
}

#root {
  width: 100%;
}

.card {
  background: transparent;
  padding: 0;
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

.error-line {
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink);
  margin: 0;
}

.skeleton {
  display: block;
  height: 12px;
  border-radius: 3px;
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
  font-size: 16px;
  font-weight: 300;
  line-height: 1.6;
  color: var(--muted);
  margin: 0 0 16px;
}

.title {
  font-family: 'Poppins', sans-serif;
  font-weight: 300;
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink);
  margin: 0 0 10px;
}

.title a {
  color: var(--ink);
  text-decoration: none;
}

.title a:hover {
  color: var(--accent-dark);
  text-decoration: underline;
}

.summary {
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink);
  margin: 0 0 16px;
}

.rule {
  width: 100%;
  height: 1px;
  background: var(--line);
  border: none;
  margin: 0 0 16px;
}

.date-line {
  font-size: 16px;
  line-height: 1.6;
  margin: 0 0 4px;
}

.venue-name {
  font-size: 16px;
  line-height: 1.6;
  margin: 0;
}

.address {
  font-size: 16px;
  line-height: 1.6;
  color: var(--muted);
  margin: 0 0 32px;
}

.address a {
  color: var(--muted);
  text-decoration: underline;
}

.address a:hover {
  color: var(--ink);
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.rsvp-btn {
  display: inline-block;
  background: transparent;
  color: var(--ink);
  text-decoration: none;
  font-size: 16px;
  font-weight: 300;
  letter-spacing: 0.32px;
  padding: 20px 28px;
  border: 1px solid var(--ink);
  border-radius: 6.4px;
  transition: background 150ms ease, color 150ms ease;
}

.rsvp-btn:hover {
  background: var(--ink);
  color: var(--paper);
}

.cal-link {
  color: var(--muted);
  text-decoration: underline;
  font-size: 16px;
  font-weight: 300;
  transition: color 150ms ease;
}

.cal-link:hover {
  color: var(--ink);
}

a:focus-visible, button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 3px;
}

.empty-line {
  font-family: 'Poppins', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink);
  margin: 0 0 6px;
}

.empty-sub {
  font-size: 14px;
  line-height: 1.6;
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
      ? '<a class="cal-link" href="' + gcalUrl(ev, startP, endP) + '" target="_blank" rel="noopener">Add to calendar</a>'
      : '';

    return '' +
      '<p class="eyebrow">Next Gathering</p>' +
      '<h2 class="title"><a href="' + escapeHtml(ev.url) + '" target="_blank" rel="noopener">' + escapeHtml(ev.title) + '</a></h2>' +
      summaryHtml +
      '<hr class="rule">' +
      '<p class="date-line">' + escapeHtml(dateLine) + '</p>' +
      '<p class="venue-name">' + escapeHtml(ev.venueName) + '</p>' +
      '<p class="address">' + addressHtml + '</p>' +
      '<div class="actions">' +
        '<a class="rsvp-btn" href="' + escapeHtml(ev.url) + '" target="_blank" rel="noopener">RSVP on Eventbrite</a>' +
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
