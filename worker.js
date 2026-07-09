// ══════════════════════════════════════════════════════════
// Aman Walia Assistant — Cloudflare Worker
//   1. Serves the static PWA (index.html)
//   2. /api/indiamart  → server-side proxy (no CORS, no 3rd-party proxy)
//   3. Daily cron      → auto-fetches new IndiaMart leads into Firestore
// ══════════════════════════════════════════════════════════

const FB_PROJECT = "aman-walia-assistant";
const FB_KEY = "AIzaSyDv2i5hTYz_9gie-Ia3MtBFk1O4guer3dU";
const IM_BASE = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/";

const fbUrl = (doc) =>
  `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/aman_assistant/${doc}?key=${FB_KEY}`;

async function fbGet(doc) {
  const r = await fetch(fbUrl(doc));
  if (!r.ok) return null;
  const j = await r.json();
  const s = j?.fields?.data?.stringValue;
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

async function fbSet(doc, value) {
  const body = {
    fields: {
      data: { stringValue: JSON.stringify(value) },
      updatedAt: { stringValue: new Date().toISOString() },
    },
  };
  const r = await fetch(fbUrl(doc), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.ok;
}

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (d, endOfDay) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
  (endOfDay ? " 23:59:59" : " 00:00:00");

// Fetch every page of leads for a window (IndiaMart caps window at 7 days)
async function fetchAllLeads(key, from, to) {
  const base =
    `${IM_BASE}?glusr_crm_key=${encodeURIComponent(key)}` +
    `&start_time=${encodeURIComponent(fmtTime(from))}` +
    `&end_time=${encodeURIComponent(fmtTime(to, true))}`;

  const all = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`${base}&page_no=${page}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!r.ok) break;
    const d = await r.json();
    if (d.CODE !== 200) {
      if (page === 1) throw new Error(d.MESSAGE || "IndiaMart error");
      break;
    }
    const leads = d.RESPONSE || [];
    all.push(...leads);
    if (leads.length < 100) break;
  }
  return all;
}

function normPhone(l) {
  const raw = l.SENDER_MOBILE || l.SENDER_MOBILE_ALT || l.SENDER_PHONE || "";
  let d = String(raw).replace(/\D/g, "");
  if (!d) return "";
  if (d.length > 10) d = d.slice(-10);
  return d.length === 10 ? "91" + d : "";
}

function toLead(l) {
  return {
    qid: String(l.UNIQUE_QUERY_ID || l.QUERY_ID || ""),
    name: l.SENDER_COMPANY || l.SENDER_NAME || "Unknown",
    person: l.SENDER_NAME || "",
    phone: normPhone(l),
    rawPhone: l.SENDER_MOBILE || "",
    email: l.SENDER_EMAIL || l.SENDER_EMAIL_ALT || "",
    city: l.SENDER_CITY || "",
    state: l.SENDER_STATE || "",
    country: l.SENDER_COUNTRY_ISO || "IN",
    address: [l.SENDER_ADDRESS, l.SENDER_CITY, l.SENDER_STATE, l.SENDER_PINCODE]
      .filter(Boolean).join(", "),
    product: l.QUERY_PRODUCT_NAME || "",
    mcat: l.QUERY_MCAT_NAME || "",
    message: String(l.QUERY_MESSAGE || "").trim(),
    subject: l.SUBJECT || "",
    callDuration: l.CALL_DURATION || "",
    queryTime: l.QUERY_TIME || "",
    queryType: l.QUERY_TYPE || "",
    fetchedAt: new Date().toISOString().slice(0, 10),
    imported: false,
  };
}

// ── Daily cron: fetch yesterday+today, drop into the inbox for the app to merge ──
async function runDailyFetch() {
  const cfg = await fbGet("imConfig");
  if (!cfg || !cfg.key || cfg.enabled === false) {
    return { skipped: "auto-fetch disabled or no key saved" };
  }

  const to = new Date();
  const from = new Date(Date.now() - 2 * 86400000); // 2-day overlap = no gaps
  const leads = await fetchAllLeads(cfg.key, from, to);

  const inbox = (await fbGet("imInbox")) || [];
  const seen = new Set(inbox.map((l) => String(l.qid)));
  let added = 0;
  for (const raw of leads) {
    const lead = toLead(raw);
    if (!lead.qid || seen.has(lead.qid)) continue;
    inbox.push(lead);
    seen.add(lead.qid);
    added++;
  }
  // Inbox is a staging area; the app drains it. Cap as a safety valve.
  const trimmed = inbox.slice(-2000);
  await fbSet("imInbox", trimmed);
  await fbSet("imConfig", {
    ...cfg,
    lastRun: new Date().toISOString(),
    lastCount: added,
    lastTotal: leads.length,
  });
  return { fetched: leads.length, added, inbox: trimmed.length };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS preflight ──
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // ── IndiaMart proxy ──
    if (url.pathname === "/api/indiamart") {
      const key = url.searchParams.get("key");
      if (!key) {
        return Response.json({ CODE: 400, MESSAGE: "Missing key" }, { status: 400 });
      }
      const start = url.searchParams.get("start_time");
      const end = url.searchParams.get("end_time");
      const page = url.searchParams.get("page_no") || "1";

      const target =
        `${IM_BASE}?glusr_crm_key=${encodeURIComponent(key)}` +
        `&start_time=${encodeURIComponent(start)}` +
        `&end_time=${encodeURIComponent(end)}&page_no=${page}`;

      try {
        const r = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0" } });
        const body = await r.text();
        return new Response(body, {
          status: r.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        return Response.json(
          { CODE: 500, MESSAGE: "Proxy error: " + e.message },
          { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    // ── Manual trigger of the daily job (for testing) ──
    if (url.pathname === "/api/cron-test") {
      try {
        const result = await runDailyFetch();
        return Response.json(result, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    // ── Everything else: static assets ──
    return env.ASSETS.fetch(request);
  },

  // ── Cloudflare Cron Trigger ──
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runDailyFetch().catch((e) => console.error("Daily fetch failed:", e.message))
    );
  },
};
