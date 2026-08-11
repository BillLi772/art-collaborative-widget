/**
 * The Art Collaborative - website widgets
 * One Cloudflare Worker, four routes:
 *
 *   /            "Next Gathering" card   (embed in Squarespace via iframe)
 *   /past        "Past Adventures" card  (embed beside it)
 *   /api/next    JSON: upcoming events
 *   /api/past    JSON: most recent past events
 *
 * Add ?demo=1 to any route to see sample data without the Eventbrite token.
 *
 * Secrets - set these in Cloudflare, never in this file:
 *   EVENTBRITE_TOKEN    required. The Private Token from Judith's Eventbrite
 *                       account (Account Settings > Developer Links > API Keys).
 *                       Set it with:  npx wrangler secret put EVENTBRITE_TOKEN
 *                       or in the dashboard under Settings > Variables and
 *                       Secrets, with the type set to "Secret".
 *   EVENTBRITE_ORG_ID   optional. Overrides ORG_ID below if it ever changes.
 *
 * NOTE: no token belongs in this file. It is safe to commit to GitHub as is.
 *
 * The Art Collaborative organizer page (public):
 *   https://www.eventbrite.com/o/the-art-collaborative-42441313023
 */

const EB_API = "https://www.eventbriteapi.com/v3";
const CACHE_SECONDS = 900; // 15 minutes

// The Art Collaborative's Eventbrite organization. Public information, so it
// lives here rather than in a secret. Baking it in also skips a lookup call
// on every cache miss. Override with the EVENTBRITE_ORG_ID secret if needed.
const ORG_ID = "42441313023";
const ORG_PAGE = "https://www.eventbrite.com/o/the-art-collaborative-42441313023";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const demo = url.searchParams.get("demo") === "1";
    // Escape hatch for the 15-minute cache below, e.g. right after a deploy
    // that changes what getEvents() fetches or returns.
    const noCache = url.searchParams.get("nocache") === "1";

    if (url.pathname === "/api/next") {
      return jsonResponse(await getEvents(env, ctx, demo, "upcoming", noCache));
    }
    if (url.pathname === "/api/past") {
      return jsonResponse(await getEvents(env, ctx, demo, "past", noCache));
    }
    if (url.pathname === "/past") {
      return htmlResponse(page("past"));
    }
    if (url.pathname === "/" || url.pathname === "") {
      return htmlResponse(page("next"));
    }
    return new Response("Not found", { status: 404 });
  },
};

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), {
    headers: {
      "content-type": "application/json;charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

/**
 * mode: "upcoming" -> live events, soonest first
 *       "past"     -> finished events, most recent first
 */
async function getEvents(env, ctx, demo, mode, noCache) {
  if (demo) {
    return {
      ok: true,
      demo: true,
      orgUrl: ORG_PAGE,
      events: mode === "past" ? SAMPLE_PAST : SAMPLE_UPCOMING,
    };
  }
  if (!env.EVENTBRITE_TOKEN) {
    return {
      ok: false,
      error: "setup",
      orgUrl: ORG_PAGE,
      message: "Widget setup incomplete: add the EVENTBRITE_TOKEN secret.",
    };
  }

  // caches.default exists on Cloudflare but not in every local runtime,
  // so every use of it is guarded.
  let cache = null;
  const cacheKey = new Request("https://cache.local/art-collab/" + mode);
  try {
    cache = caches.default;
    if (!noCache) {
      const hit = await cache.match(cacheKey);
      if (hit) return await hit.json();
    }
  } catch (e) {
    cache = null; // Cache unavailable. Fall through to a live fetch.
  }

  try {
    const query =
      mode === "past"
        ? "status=ended,completed&order_by=start_desc&expand=venue&page_size=6"
        : "status=live&order_by=start_asc&expand=venue&page_size=6";

    // Try the configured organization first. If the token belongs to a
    // different Eventbrite account, that comes back as a 404 rather than an
    // auth error - so fall back to whatever organization the token can
    // actually see instead of showing an error to visitors.
    let orgId = env.EVENTBRITE_ORG_ID || ORG_ID;
    let res;
    try {
      res = await ebFetch(`/organizations/${orgId}/events/?${query}`, env);
    } catch (err) {
      if (!String(err && err.message).includes("404")) throw err;
      const fallbackId = await firstOrgId(env);
      if (fallbackId === orgId) throw err;
      orgId = fallbackId;
      res = await ebFetch(`/organizations/${orgId}/events/?${query}`, env);
    }
    const events = (res.events || []).map(slim);
    const payload = { ok: true, orgUrl: ORG_PAGE, events };

    try {
      if (cache) ctx.waitUntil(
        cache.put(
          cacheKey,
          new Response(JSON.stringify(payload), {
            headers: {
              "content-type": "application/json",
              "cache-control": `s-maxage=${CACHE_SECONDS}`,
            },
          })
        )
      );
    } catch (e) {
      // Non-fatal: skip caching.
    }
    return payload;
  } catch (err) {
    return {
      ok: false,
      error: "eventbrite",
      orgUrl: ORG_PAGE,
      message: String((err && err.message) || err).includes("404")
        ? "Eventbrite token does not have access to organization " +
          (env.EVENTBRITE_ORG_ID || ORG_ID) +
          ". It likely belongs to a different Eventbrite account."
        : "Could not reach Eventbrite: " + String((err && err.message) || err),
    };
  }
}

async function firstOrgId(env) {
  const res = await ebFetch("/users/me/organizations/", env);
  const org = res.organizations && res.organizations[0];
  if (!org) throw new Error("No Eventbrite organization found for this token.");
  return org.id;
}

async function ebFetch(path, env) {
  const r = await fetch(EB_API + path, {
    headers: { Authorization: `Bearer ${env.EVENTBRITE_TOKEN}` },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Eventbrite API ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

/** Reduce an Eventbrite event to just what the widgets need. */
function slim(e) {
  return {
    title: (e.name && e.name.text) || "Untitled event",
    url: e.url || "",
    summary: e.summary || "",
    start: (e.start && e.start.local) || "",
    end: (e.end && e.end.local) || "",
    timezone: (e.start && e.start.timezone) || "America/Chicago",
    venueName: (e.venue && e.venue.name) || "",
    address:
      (e.venue && e.venue.address && e.venue.address.localized_address_display) || "",
    // No image field: Eventbrite substitutes the org's default banner for
    // any event without its own custom logo, so every past adventure ended
    // up showing the same picture. The past-adventures list is text-only
    // until events have real per-event photos to show instead.
  };
}

const SAMPLE_UPCOMING = [
  {
    title: "The Show Behind the Show",
    url: "https://www.eventbrite.com/e/the-show-behind-the-show-tickets-1993357430735",
    summary:
      "A backstage tour of the Muny: the scene shop, the costume rooms, and how a season gets built.",
    start: "2026-07-23T15:00:00",
    end: "2026-07-23T16:30:00",
    timezone: "America/Chicago",
    venueName: "The Muny",
    address: "1 Theatre Drive, St. Louis, MO 63112",
    image: "",
  },
];

const SAMPLE_PAST = [
  {
    title: "Inside the Conservation Lab",
    url: "https://www.eventbrite.com",
    summary: "How a damaged canvas is brought back, told by the conservators who do it.",
    start: "2026-04-18T13:00:00",
    end: "2026-04-18T15:00:00",
    timezone: "America/Chicago",
    venueName: "Midwest Art Conservation Studio",
    address: "5641 Pershing Avenue, St. Louis, MO 63112",
    image: "",
  },
  {
    title: "A Printmaking Studio Visit",
    url: "https://www.eventbrite.com",
    summary: "An afternoon of process, proofs, and works in progress.",
    start: "2026-01-24T14:00:00",
    end: "2026-01-24T16:00:00",
    timezone: "America/Chicago",
    venueName: "Riverbend Print Studio",
    address: "3214 Cherokee Street, St. Louis, MO 63118",
    image: "",
  },
  {
    title: "A Collectors' Conversation",
    url: "https://www.eventbrite.com",
    summary: "Three collectors on how they started, and what they wish they had known.",
    start: "2025-10-11T15:00:00",
    end: "2025-10-11T17:00:00",
    timezone: "America/Chicago",
    venueName: "The Meridian Room",
    address: "8 N Euclid Avenue, St. Louis, MO 63108",
    image: "",
  },
];

/* ------------------------------------------------------------------ *
 * The widget page. Both cards share one stylesheet so they sit side
 * by side looking like a matched pair. Colors and fonts live in the
 * :root variables; change a hex code and redeploy.
 * ------------------------------------------------------------------ */
function page(mode) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${mode === "past" ? "Past Adventures" : "Next Gathering"} - The Art Collaborative</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  /* ------------------------------------------------------------------
     MATCHING JUDITH'S SITE
     judithshaw.com uses Poppins throughout, so both variables point at it.
     If she ever changes the site font, change it here and redeploy.
     ------------------------------------------------------------------ */
  :root{
    --sans:'Poppins', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    --serif:'Poppins', 'Helvetica Neue', Helvetica, Arial, sans-serif;

    /* Measured directly from judithshaw.com: every piece of visible text on
       the page - nav links, body copy, section labels, button text - is
       Poppins 300 in #5E5858, with #817A7A used for a lighter label. No
       bold weights or uppercase micro-labels appear anywhere on the site. */
    --ink:#5E5858;         /* body text, headings, button border */
    --muted:#817A7A;       /* secondary text */
    --line:#DEDEDE;        /* hairlines */
    --accent:#5E5858;      /* links on hover */
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:transparent}
  /* No card, no border, no fill - the widget is part of the page. */
  body{font-family:var(--sans);font-weight:300;color:var(--ink);-webkit-font-smoothing:antialiased;
       font-size:16px;line-height:1.6}

  /* Full width so it lines up with the paragraph above it. */
  .placard{width:100%;max-width:none;margin:0;padding:0;background:none;border:0}

  .eyebrow{margin:0 0 18px;font-size:16px;font-weight:300;color:var(--muted)}

  .title{font-family:var(--serif);font-weight:400;font-size:26px;line-height:1.3;
         letter-spacing:0;margin:0}
  .title a{color:inherit;text-decoration:none}
  .title a:hover{text-decoration:underline;text-underline-offset:4px}

  .blurb{margin:14px 0 0;font-size:16px;line-height:1.6;color:var(--ink);max-width:60ch}
  .rule{border:0;border-top:1px solid var(--ink);width:100%;margin:26px 0 22px}

  .when{margin:0 0 10px;font-size:16px;font-weight:400}
  .venue{margin:0 0 4px;font-size:13px;font-weight:400;color:var(--muted)}
  .addr{margin:0;font-size:16px;color:var(--muted)}
  .addr a{color:inherit;text-decoration:none;border-bottom:1px solid var(--line)}
  .addr a:hover{color:var(--ink);border-bottom-color:var(--ink)}

  .actions{display:flex;align-items:center;gap:26px;margin-top:28px;flex-wrap:wrap}
  /* Border color, radius, and padding measured from the page's own
     "Registration" button. */
  .btn{display:inline-block;border:1px solid var(--ink);border-radius:6px;background:none;color:var(--ink);
       text-decoration:none;font-size:16px;font-weight:300;padding:22px 34px}
  .btn:hover{background:var(--ink);color:#fff}
  .cal{font-size:15px;color:var(--muted);text-decoration:none;border-bottom:1px solid var(--line)}
  .cal:hover{color:var(--ink);border-bottom-color:var(--ink)}

  /* empty state */
  .msg{font-family:var(--serif);font-weight:400;font-size:26px;line-height:1.3;margin:0}
  .sub{margin:12px 0 0;font-size:16px;line-height:1.6;color:var(--ink);max-width:60ch}
  .subhead{margin:26px 0 8px;font-size:16px;font-weight:300;color:var(--muted)}
  .setup{margin:0;font-size:15px;color:var(--muted)}

  /* past adventures - no thumbnail column, text only (see CLAUDE.md gotcha
     on why there's no reliable per-event photo to show here yet). */
  .past-item{display:block;padding:24px 0;
             border-top:1px solid var(--line);text-decoration:none;color:inherit}
  .past-item:first-of-type{border-top:0;padding-top:6px}
  .past-body{min-width:0}
  .past-title{font-family:var(--serif);font-weight:400;font-size:19px;line-height:1.35;margin:0}
  .past-item:hover .past-title{text-decoration:underline;text-underline-offset:4px}
  /* Venue pinned left, date pinned right, sharing one line. Wraps
     gracefully if the embed is too narrow to fit both. */
  .past-meta{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;
             gap:4px 16px;margin-top:10px}
  .past-where{margin:0;font-size:15px;color:var(--muted)}
  .past-date{margin:0;font-size:13px;color:var(--muted);white-space:nowrap}

  /* boxed live link, same shape as the Registration button */
  /* display:table + margin:auto centers a fit-content element without
     relying on a wrapping container. */
  .boxlink{display:table;margin:26px auto 0;border:1px solid var(--ink);border-radius:6px;padding:22px 34px;
           text-decoration:none;color:var(--ink);font-size:16px;font-weight:300}
  .boxlink:hover{background:var(--ink);color:#fff}

  @media (max-width:600px){
    .title,.msg{font-size:22px}
    .past-title{font-size:17px}
  }

  a:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
</style>
</head>
<body>
<div id="app"></div>
<script>
var MODE=${JSON.stringify(mode)};
var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function parts(s){if(!s||s.length<16)return null;var y=+s.slice(0,4),mo=+s.slice(5,7),da=+s.slice(8,10),h=+s.slice(11,13),mi=+s.slice(14,16);var wd=new Date(Date.UTC(y,mo-1,da)).getUTCDay();return{y:y,mo:mo,da:da,h:h,mi:mi,wd:wd};}
function t12(h,mi){var ap=h>=12?'PM':'AM';var hh=h%12;if(hh===0)hh=12;return hh+':'+(mi<10?'0'+mi:mi)+' '+ap;}
function pad(n){return n<10?'0'+n:''+n;}
function whenLine(ev){var s=parts(ev.start);if(!s)return'';var line=DAYS[s.wd]+', '+MONTHS[s.mo-1]+' '+s.da+', '+s.y;var e=parts(ev.end);var st=t12(s.h,s.mi);if(e&&ev.end.slice(0,10)===ev.start.slice(0,10)){var et=t12(e.h,e.mi);if(st.slice(-2)===et.slice(-2)){st=st.slice(0,-3);}line+=' \\u00B7 '+st+'\\u2013'+et;}else{line+=' \\u00B7 '+st;}return line;}
function monthYear(ev){var s=parts(ev.start);return s?MONTHS[s.mo-1]+' '+s.y:'';}
function gcal(ev){var s=parts(ev.start),e=parts(ev.end)||s;var d1=''+s.y+pad(s.mo)+pad(s.da)+'T'+pad(s.h)+pad(s.mi)+'00';var d2=''+e.y+pad(e.mo)+pad(e.da)+'T'+pad(e.h)+pad(e.mi)+'00';var loc=ev.venueName?ev.venueName+(ev.address?', '+ev.address:''):ev.address;return'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(ev.title)+'&dates='+d1+'/'+d2+'&ctz='+encodeURIComponent(ev.timezone||'America/Chicago')+'&location='+encodeURIComponent(loc||'')+(ev.url?'&details='+encodeURIComponent('RSVP: '+ev.url):'');}
function mapsUrl(ev){var q=(ev.venueName?ev.venueName+', ':'')+(ev.address||'');return'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q);}
function card(inner){return'<div class="placard reveal">'+inner+'</div>';}

/* ---- NEXT GATHERING ---- */
function renderNext(data){
  var evs=(data&&data.events)||[];
  if(!evs.length){
    /* EMPTY STATE - wording approved by Judith. Edit here to change it. */
    return card(
      '<p class="eyebrow">Our Next Adventure</p>'+
      '<p class="msg">Details for our next event are forthcoming.</p>'+
      '<p class="sub">We\u2019ll share the date and location as soon as they\u2019re set \u2014 join the mailing list below to hear first.</p>'+
      '<hr class="rule">'+
      '<p class="subhead">Stay Connected</p>'+
      '<p class="sub">Join the Art Collaborative mailing list to be notified about upcoming events.</p>'
    );
  }
  var ev=evs[0];
  var h='<p class="eyebrow">Our Next Adventure</p>';
  h+='<h1 class="title"><a href="'+esc(ev.url)+'" target="_blank" rel="noopener">'+esc(ev.title)+'</a></h1>';
  if(ev.summary){h+='<p class="blurb">'+esc(ev.summary)+'</p>';}
  h+='<hr class="rule">';
  h+='<p class="when">'+esc(whenLine(ev))+'</p>';
  if(ev.venueName){h+='<p class="venue">'+esc(ev.venueName)+'</p>';}
  if(ev.address){h+='<p class="addr"><a href="'+esc(mapsUrl(ev))+'" target="_blank" rel="noopener">'+esc(ev.address)+'</a></p>';}
  h+='<div class="actions"><a class="btn" href="'+esc(ev.url)+'" target="_blank" rel="noopener">RSVP on Eventbrite</a><a class="cal" href="'+esc(gcal(ev))+'" target="_blank" rel="noopener">Add to calendar</a></div>';
  return card(h);
}

/* ---- PAST ADVENTURES ---- */
function renderPast(data){
  var evs=((data&&data.events)||[]).slice(0,3);
  var org=(data&&data.orgUrl)||'https://www.eventbrite.com';
  var h='<p class="eyebrow">Explore Past Adventures</p>';
  h+='<h1 class="title">Overview of past Collaborative adventures</h1>';
  if(!evs.length){
    h+='<p class="blurb">A look back at where the Collaborative has been.</p>';
  }else{
    h+='<div style="margin-top:18px">';
    for(var i=0;i<evs.length;i++){
      var ev=evs[i];
      h+='<a class="past-item" href="'+esc(ev.url)+'" target="_blank" rel="noopener">';
      h+='<span class="past-body">';
      h+='<p class="past-title">'+esc(ev.title)+'</p>';
      h+='<div class="past-meta">';
      h+=ev.venueName?'<span class="past-where">'+esc(ev.venueName)+'</span>':'<span></span>';
      h+='<span class="past-date">'+esc(monthYear(ev))+'</span>';
      h+='</div>';
      h+='</span></a>';
    }
    h+='</div>';
  }
  h+='<a class="boxlink" href="'+esc(org)+'" target="_blank" rel="noopener">See Overview</a>';
  return card(h);
}

function render(data){
  var app=document.getElementById('app');
  /* If Eventbrite is unreachable or misconfigured, visitors must never see a
     technical error on Judith's site. Fall back to the ordinary placeholder
     and leave the real reason in the console for whoever maintains this. */
  if(data&&data.ok===false){
    if(window.console&&console.warn){console.warn('Art Collaborative widget:',data.message||'unknown error');}
    app.innerHTML=(MODE==='past')?renderPast({ok:true,orgUrl:(data&&data.orgUrl)||'https://www.eventbrite.com/o/the-art-collaborative-42441313023',events:[]})
                                 :renderNext({ok:true,events:[]});
    return;
  }
  app.innerHTML=(MODE==='past')?renderPast(data):renderNext(data);
}

var demo=/(^|[?&])demo=1(&|$)/.test(location.search);
fetch('/api/'+(MODE==='past'?'past':'next')+(demo?'?demo=1':''))
  .then(function(r){return r.json();})
  .then(render)
  .catch(function(){render({ok:false,message:'Could not load the calendar.'});});
</script>
</body>
</html>`;
}
