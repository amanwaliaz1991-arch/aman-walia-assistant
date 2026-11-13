// ══════════════════════════════════════════════════════════
// TEAM TASKS — assign work to Deevanshu / Yash / Raman / Aman,
// track completion, and score staff efficiency week by week.
//
// Storage: Firestore doc aman_assistant/teamTasks
//   { tasks: { <id>: task }, people: { <name>: { phone } } }
// Each task is written as its own map entry (set + merge), so two
// phones updating different tasks at the same time never overwrite
// each other. Tasks are never hard-deleted (deleted:true instead).
// ══════════════════════════════════════════════════════════
(function () {
  "use strict";

  const PEOPLE = ["Deevanshu", "Yash", "Raman", "Aman"];
  const STAFF = ["Deevanshu", "Yash"];          // scored on the scorecard
  const OWNERS = ["Aman", "Raman"];             // can assign, no scorecard
  const CATS = {
    Yash: ["Handle Stock", "Cane Stock", "Handle Packing", "Production", "Transport Pickup", "Dispatch", "Packing", "Other"],
    Deevanshu: ["Orders", "Accounts", "Quality Control", "Other"],
    Raman: ["General", "Purchase", "Sales", "Accounts", "Production", "Other"],
    Aman: ["General", "Purchase", "Sales", "Accounts", "Production", "Other"],
  };
  const DEFAULT_PHONES = { Aman: "9464516478", Raman: "9463634678" };
  const LS_KEY = "tt_cache_v1";

  const TT = {
    tasks: {},
    people: {},
    tab: "board",          // board | score | history
    filter: "All",
    weekOffset: 0,
    histSearch: "",
    unsub: null,
    loaded: false,
    knownIds: null,
  };
  window.TeamTasks = TT;

  // ── helpers ────────────────────────────────────────────
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = () => ymd(new Date());
  const parse = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000); // a - b
  const fmtDate = (s) => parse(s).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const nowIso = () => new Date().toISOString();
  const me = () => (typeof currentPerson !== "undefined" ? currentPerson : "");
  const isOwner = () => typeof currentRole !== "undefined" && currentRole === "owner";
  const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const live = () => Object.values(TT.tasks).filter((t) => t && !t.deleted);
  const isOpen = (t) => t.status !== "done";
  const needsCheck = (t) => t.status === "done" && !t.review && STAFF.includes(t.to);

  function weekStart(offset) {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow + offset * 7);
    return ymd(d);
  }

  function dueLabel(t) {
    if (t.status === "done") return { txt: "Done " + (t.doneDate ? fmtDate(t.doneDate) : ""), cls: "ok" };
    const d = diffDays(t.due, today());
    if (d < 0) return { txt: "Overdue " + -d + (d === -1 ? " day" : " days"), cls: "late" };
    if (d === 0) return { txt: "Due today", cls: "today" };
    if (d === 1) return { txt: "Due tomorrow", cls: "" };
    return { txt: "Due " + fmtDate(t.due), cls: "" };
  }

  function sortOpen(a, b) {
    const ad = a.due || "9999", bd = b.due || "9999";
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (a.pri !== b.pri) return a.pri === "urgent" ? -1 : 1;
    return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
  }

  // ── storage ────────────────────────────────────────────
  function docRef() {
    return db.collection("aman_assistant").doc("teamTasks");
  }

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (c && c.tasks) { TT.tasks = c.tasks; TT.people = c.people || {}; }
    } catch (e) {}
  }
  function saveCache() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ tasks: TT.tasks, people: TT.people })); } catch (e) {}
  }

  function startSync() {
    if (TT.unsub) return;
    if (typeof firebaseReady === "undefined" || !firebaseReady || typeof db === "undefined" || !db) {
      setTimeout(startSync, 1000);
      return;
    }
    TT.unsub = docRef().onSnapshot(
      (snap) => {
        const data = snap.exists ? snap.data() : {};
        const incoming = data.tasks || {};
        // notify about tasks newly assigned to me (after first load only)
        if (TT.knownIds) {
          Object.values(incoming).forEach((t) => {
            if (t && !t.deleted && !TT.knownIds.has(t.id) && t.to === me() && t.by !== me()) {
              notify("📋 New task from " + t.by + ": " + t.title);
            }
          });
        }
        TT.knownIds = new Set(Object.keys(incoming));
        TT.tasks = incoming;
        TT.people = data.people || {};
        TT.loaded = true;
        saveCache();
        refresh();
      },
      (err) => console.warn("Team tasks sync error:", err)
    );
  }

  function putTask(t) {
    TT.tasks[t.id] = t;
    saveCache();
    refresh();
    if (typeof firebaseReady === "undefined" || !firebaseReady || !db) {
      alert("⚠️ Not connected to cloud — this change is only on this phone until the connection is back. Please reload when online.");
      return;
    }
    docRef()
      .set({ tasks: { [t.id]: t }, updatedAt: nowIso() }, { merge: true })
      .catch((e) => { console.error(e); alert("❌ Could not save task: " + e.message); });
  }

  function putPeople(people) {
    TT.people = people;
    saveCache();
    if (typeof firebaseReady !== "undefined" && firebaseReady && db) {
      docRef().set({ people: people, updatedAt: nowIso() }, { merge: true }).catch((e) => alert("❌ Could not save: " + e.message));
    }
  }

  function log(t, action, note) {
    t.history = (t.history || []).concat([{ at: nowIso(), by: me() || "Owner", a: action, n: note || "" }]);
  }

  function notify(msg) {
    try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) {}
    let el = document.getElementById("tt-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "tt-toast";
      el.style.cssText = "position:fixed;top:64px;left:50%;transform:translateX(-50%);max-width:92vw;background:#1e293b;color:#fff;padding:12px 16px;border-radius:12px;font-size:14px;font-weight:600;z-index:10060;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer";
      el.onclick = () => { el.style.display = "none"; go("tasks"); };
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = "none"), 6000);
  }

  // ── actions ────────────────────────────────────────────
  function canTouch(t) {
    return isOwner() || t.to === me();
  }

  function act(action, id) {
    const t = TT.tasks[id];
    if (!t || !canTouch(t)) return;
    const c = JSON.parse(JSON.stringify(t));
    if (action === "start") {
      c.status = "progress"; c.startedAt = c.startedAt || nowIso(); log(c, "started");
      putTask(c);
    } else if (action === "done") {
      c.status = "done"; c.doneAt = nowIso(); c.doneDate = today(); c.stuckReason = null; log(c, "done");
      putTask(c);
    } else if (action === "stuck") {
      askText("⛔ Why is it stuck? / क्यों अटका है?", "e.g. Transport not available, waiting for payment…", "", (txt) => {
        c.status = "stuck"; c.stuckReason = txt; log(c, "stuck", txt); putTask(c);
      });
    } else if (action === "ok") {
      c.review = "ok"; c.reviewAt = nowIso(); c.reviewBy = me(); log(c, "ok"); putTask(c);
    } else if (action === "redo") {
      askText("↩ What needs to be redone?", "Tell them what is wrong", "", (txt) => {
        c.review = null; c.status = "pending"; c.doneAt = null; c.doneDate = null;
        c.redoCount = (c.redoCount || 0) + 1; c.redoNote = txt; log(c, "redo", txt); putTask(c);
      });
    } else if (action === "reopen") {
      c.status = "pending"; c.doneAt = null; c.doneDate = null; c.review = null; log(c, "reopened"); putTask(c);
    } else if (action === "delete") {
      if (!isOwner()) return;
      if (!confirm("Delete this task?\n\n" + t.title)) return;
      c.deleted = true; log(c, "deleted"); putTask(c);
    } else if (action === "edit") {
      if (isOwner()) openForm(c);
    } else if (action === "wa") {
      sendWhatsApp(c);
    } else if (action === "hist") {
      showHistory(c);
    }
  }

  function waText(t) {
    const lines = [
      "📋 *Task for " + t.to + "*",
      t.title,
      t.notes ? "Note: " + t.notes : "",
      "Due: " + fmtDate(t.due) + (t.pri === "urgent" ? "  🔴 *URGENT*" : ""),
      "From: " + t.by,
      "",
      "Update in app ➜ " + location.origin + "/",
    ];
    return lines.filter((l, i) => l !== "" || i === 5).join("\n");
  }

  function sendWhatsApp(t) {
    const ph = String((TT.people[t.to] && TT.people[t.to].phone) || DEFAULT_PHONES[t.to] || "").replace(/\D/g, "");
    const num = ph ? (ph.length === 10 ? "91" + ph : ph) : "";
    window.open("https://wa.me/" + num + "?text=" + encodeURIComponent(waText(t)), "_blank");
  }

  // ── modal plumbing ─────────────────────────────────────
  function modal(html) {
    let m = document.getElementById("tt-modal");
    if (!m) {
      m = document.createElement("div");
      m.id = "tt-modal";
      m.className = "tt-ov";
      m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
      document.body.appendChild(m);
    }
    m.innerHTML = '<div class="tt-sheet" role="dialog" aria-modal="true">' + html + "</div>";
    m.style.display = "flex";
    return m;
  }
  function closeModal() {
    const m = document.getElementById("tt-modal");
    if (m) m.style.display = "none";
  }

  function askText(title, placeholder, value, cb) {
    const m = modal(
      '<div class="tt-mh">' + esc(title) + "</div>" +
      '<textarea class="inp tt-ta" id="tt-ask" rows="3" placeholder="' + esc(placeholder) + '">' + esc(value) + "</textarea>" +
      '<div class="tt-row"><button class="btn" id="tt-ask-cancel">Cancel</button><button class="btn btn-p" id="tt-ask-ok">Save</button></div>'
    );
    const ta = m.querySelector("#tt-ask");
    setTimeout(() => ta.focus(), 50);
    m.querySelector("#tt-ask-cancel").onclick = closeModal;
    m.querySelector("#tt-ask-ok").onclick = () => {
      const v = ta.value.trim();
      if (!v) { ta.focus(); return; }
      closeModal(); cb(v);
    };
  }

  function showHistory(t) {
    const names = { assigned: "Assigned", started: "Started", done: "Marked done", stuck: "Stuck", ok: "Checked OK", redo: "Sent back for redo", reopened: "Reopened", edited: "Edited", deleted: "Deleted" };
    const rows = (t.history || []).slice().reverse().map((h) =>
      '<div class="tt-hrow"><b>' + esc(names[h.a] || h.a) + "</b> · " + esc(h.by) + ' <span class="tt-dim">' +
      esc(new Date(h.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + "</span>" +
      (h.n ? '<div class="tt-dim">' + esc(h.n) + "</div>" : "") + "</div>"
    ).join("");
    const m = modal('<div class="tt-mh">' + esc(t.title) + "</div>" + (rows || '<div class="tt-dim">No history</div>') +
      '<div class="tt-row"><button class="btn" id="tt-h-close">Close</button></div>');
    m.querySelector("#tt-h-close").onclick = closeModal;
  }

  // ── assign / edit form ─────────────────────────────────
  function openForm(existing) {
    if (!isOwner()) return;
    const t = existing || { to: TT.filter !== "All" ? TT.filter : "Yash", pri: "normal", due: today(), cat: "", title: "", notes: "" };
    const people = PEOPLE.filter((p) => p !== me() || (existing && existing.to === p));
    const opts = people.map((p) => '<option value="' + p + '"' + (p === t.to ? " selected" : "") + ">" + p + "</option>").join("");
    const m = modal(
      '<div class="tt-mh">' + (existing ? "✏️ Edit task" : "➕ Assign task") + "</div>" +
      '<label class="tt-lbl">Task</label><textarea class="inp tt-ta" id="tt-f-title" rows="2" placeholder="e.g. Dispatch Sareen order by Gati">' + esc(t.title) + "</textarea>" +
      '<div class="tt-2"><div><label class="tt-lbl">Assign to</label><select class="sel tt-w" id="tt-f-to">' + opts + "</select></div>" +
      '<div><label class="tt-lbl">Category</label><select class="sel tt-w" id="tt-f-cat"></select></div></div>' +
      '<label class="tt-lbl">Due</label><div class="tt-chips" id="tt-f-quick">' +
      '<button type="button" class="tt-chip" data-d="0">Today</button><button type="button" class="tt-chip" data-d="1">Tomorrow</button>' +
      '<button type="button" class="tt-chip" data-d="3">In 3 days</button><button type="button" class="tt-chip" data-d="7">In a week</button>' +
      '<input type="date" class="inp" id="tt-f-due" value="' + esc(t.due) + '" style="padding:6px 8px"></div>' +
      '<label class="tt-lbl">Priority</label><div class="tt-chips"><button type="button" class="tt-chip" data-p="normal">Normal</button><button type="button" class="tt-chip tt-urg" data-p="urgent">🔴 Urgent</button></div>' +
      '<label class="tt-lbl">Note (optional)</label><input class="inp tt-w" id="tt-f-notes" value="' + esc(t.notes) + '" placeholder="Party name, quantity, any detail">' +
      '<div class="tt-row">' + (existing ? "" : '<label class="tt-wa"><input type="checkbox" id="tt-f-wa" checked> Send on WhatsApp</label>') +
      '<button class="btn" id="tt-f-cancel">Cancel</button><button class="btn btn-p" id="tt-f-save">' + (existing ? "Save" : "Assign") + "</button></div>"
    );
    let pri = t.pri || "normal";
    const toSel = m.querySelector("#tt-f-to"), catSel = m.querySelector("#tt-f-cat"), dueInp = m.querySelector("#tt-f-due");
    const fillCats = () => {
      const list = CATS[toSel.value] || ["Other"];
      catSel.innerHTML = list.map((c) => '<option' + (c === t.cat ? " selected" : "") + ">" + esc(c) + "</option>").join("");
    };
    const paintPri = () => m.querySelectorAll("[data-p]").forEach((b) => b.classList.toggle("on", b.dataset.p === pri));
    const paintDue = () => m.querySelectorAll("[data-d]").forEach((b) => b.classList.toggle("on", addDays(today(), +b.dataset.d) === dueInp.value));
    fillCats(); paintPri(); paintDue();
    toSel.onchange = fillCats;
    dueInp.onchange = paintDue;
    m.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => { dueInp.value = addDays(today(), +b.dataset.d); paintDue(); }));
    m.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { pri = b.dataset.p; paintPri(); }));
    setTimeout(() => m.querySelector("#tt-f-title").focus(), 50);
    m.querySelector("#tt-f-cancel").onclick = closeModal;
    m.querySelector("#tt-f-save").onclick = () => {
      const title = m.querySelector("#tt-f-title").value.trim();
      if (!title) { m.querySelector("#tt-f-title").focus(); return; }
      if (!dueInp.value) { dueInp.focus(); return; }
      const sendWa = !existing && m.querySelector("#tt-f-wa").checked;
      let task;
      if (existing) {
        task = existing;
        task.title = title; task.to = toSel.value; task.cat = catSel.value; task.pri = pri;
        task.due = dueInp.value; task.notes = m.querySelector("#tt-f-notes").value.trim();
        log(task, "edited");
      } else {
        task = {
          id: uid(), title, to: toSel.value, by: me() || "Aman", cat: catSel.value, pri, due: dueInp.value,
          notes: m.querySelector("#tt-f-notes").value.trim(), status: "pending", createdAt: nowIso(), createdDate: today(),
          startedAt: null, doneAt: null, doneDate: null, stuckReason: null, review: null, redoCount: 0, redoNote: null, deleted: false, history: [],
        };
        log(task, "assigned");
      }
      closeModal();
      putTask(task);
      if (sendWa) sendWhatsApp(task);
    };
  }

  function openPhones() {
    const rows = PEOPLE.map((p) => {
      const v = (TT.people[p] && TT.people[p].phone) || DEFAULT_PHONES[p] || "";
      return '<label class="tt-lbl">' + p + '</label><input class="inp tt-w" type="tel" data-ph="' + p + '" value="' + esc(v) + '" placeholder="10-digit mobile">';
    }).join("");
    const m = modal('<div class="tt-mh">📱 WhatsApp numbers</div>' + rows +
      '<div class="tt-row"><button class="btn" id="tt-p-cancel">Cancel</button><button class="btn btn-p" id="tt-p-save">Save</button></div>');
    m.querySelector("#tt-p-cancel").onclick = closeModal;
    m.querySelector("#tt-p-save").onclick = () => {
      const people = Object.assign({}, TT.people);
      m.querySelectorAll("[data-ph]").forEach((i) => { people[i.dataset.ph] = Object.assign({}, people[i.dataset.ph], { phone: i.value.replace(/\D/g, "") }); });
      closeModal(); putPeople(people);
    };
  }

  // ── rendering ──────────────────────────────────────────
  function card(t, opts) {
    opts = opts || {};
    const dl = dueLabel(t);
    const mine = t.to === me();
    const btns = [];
    if (t.status !== "done" && mine) {
      if (t.status !== "progress") btns.push('<button class="tt-b tt-b-start" data-act="start" data-id="' + t.id + '">▶ Start</button>');
      btns.push('<button class="tt-b tt-b-done" data-act="done" data-id="' + t.id + '">✅ Done <small>हो गया</small></button>');
      if (t.status !== "stuck") btns.push('<button class="tt-b tt-b-stuck" data-act="stuck" data-id="' + t.id + '">⛔ Stuck <small>अटका</small></button>');
    }
    if (isOwner() && needsCheck(t)) {
      btns.push('<button class="tt-b tt-b-ok" data-act="ok" data-id="' + t.id + '">✔ OK</button>');
      btns.push('<button class="tt-b tt-b-redo" data-act="redo" data-id="' + t.id + '">↩ Redo</button>');
    }
    if (isOwner() && t.status === "done" && !needsCheck(t) && opts.reopen) btns.push('<button class="tt-b" data-act="reopen" data-id="' + t.id + '">Reopen</button>');
    const tools = [];
    if (isOwner()) {
      tools.push('<button class="tt-ic" title="WhatsApp" data-act="wa" data-id="' + t.id + '">💬</button>');
      tools.push('<button class="tt-ic" title="Edit" data-act="edit" data-id="' + t.id + '">✏️</button>');
      tools.push('<button class="tt-ic" title="Delete" data-act="delete" data-id="' + t.id + '">🗑</button>');
    }
    tools.push('<button class="tt-ic" title="History" data-act="hist" data-id="' + t.id + '">🕘</button>');
    const statusTxt = { pending: "", progress: '<span class="tt-tag tt-prog">In progress</span>', stuck: '<span class="tt-tag tt-stk">Stuck</span>', done: "" }[t.status] || "";
    const reviewTxt = t.review === "ok" ? '<span class="tt-tag tt-okt">✔ Checked</span>' : needsCheck(t) ? '<span class="tt-tag tt-wait">Waiting for check</span>' : "";
    return (
      '<div class="tt-card' + (t.pri === "urgent" && t.status !== "done" ? " tt-urgent" : "") + (dl.cls === "late" ? " tt-late" : "") + '">' +
      '<div class="tt-top"><div class="tt-title">' + esc(t.title) + "</div><div class=\"tt-tools\">" + tools.join("") + "</div></div>" +
      (t.notes ? '<div class="tt-notes">' + esc(t.notes) + "</div>" : "") +
      (t.status === "stuck" && t.stuckReason ? '<div class="tt-reason">⛔ ' + esc(t.stuckReason) + "</div>" : "") +
      (t.redoNote && t.status !== "done" ? '<div class="tt-reason tt-redo-r">↩ Redo: ' + esc(t.redoNote) + "</div>" : "") +
      '<div class="tt-meta">' +
      (t.pri === "urgent" && t.status !== "done" ? '<span class="tt-tag tt-u">URGENT</span>' : "") +
      '<span class="tt-tag tt-due ' + dl.cls + '">' + esc(dl.txt) + "</span>" + statusTxt + reviewTxt +
      (t.cat ? '<span class="tt-tag">' + esc(t.cat) + "</span>" : "") +
      (opts.showTo ? '<span class="tt-tag tt-to">→ ' + esc(t.to) + "</span>" : "") +
      (t.by && t.by !== me() ? '<span class="tt-dim"> from ' + esc(t.by) + "</span>" : "") +
      "</div>" +
      (btns.length ? '<div class="tt-btns">' + btns.join("") + "</div>" : "") +
      "</div>"
    );
  }

  function section(title, list, opts, emptyTxt) {
    if (!list.length && !emptyTxt) return "";
    return '<div class="tt-sec"><div class="tt-sh">' + title + ' <span class="tt-cnt">' + list.length + "</span></div>" +
      (list.length ? list.map((t) => card(t, opts)).join("") : '<div class="tt-empty">' + emptyTxt + "</div>") + "</div>";
  }

  function myTasksHTML(person) {
    const mine = live().filter((t) => t.to === person);
    const td = today();
    const open = mine.filter(isOpen).sort(sortOpen);
    const overdue = open.filter((t) => t.due < td && t.status !== "stuck");
    const redo = open.filter((t) => t.redoNote && t.status !== "stuck" && t.due >= td);
    const todayL = open.filter((t) => t.due === td && t.status !== "stuck" && !redo.includes(t));
    const stuck = open.filter((t) => t.status === "stuck");
    const upcoming = open.filter((t) => t.due > td && t.status !== "stuck" && !redo.includes(t));
    const done = mine.filter((t) => t.status === "done" && t.doneDate && diffDays(td, t.doneDate) <= 7).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));
    return (
      section("⚠️ Overdue / देर हो गई", overdue) +
      section("↩ Sent back — redo", redo) +
      section("📅 Today / आज", todayL, null, overdue.length || redo.length ? "" : "Nothing due today 👍") +
      section("⛔ Stuck", stuck) +
      section("🗓 Coming up", upcoming) +
      section("✅ Done in last 7 days", done)
    );
  }

  function statsHTML(list) {
    const td = today();
    const open = list.filter(isOpen);
    const s = [
      ["Open", open.length, ""],
      ["Overdue", open.filter((t) => t.due < td).length, "red"],
      ["Stuck", open.filter((t) => t.status === "stuck").length, "orange"],
      ["Waiting check", list.filter(needsCheck).length, "blue"],
    ];
    return '<div class="tt-stats">' + s.map((x) => '<div class="tt-stat ' + x[2] + '"><div class="v">' + x[1] + '</div><div class="l">' + x[0] + "</div></div>").join("") + "</div>";
  }

  function boardHTML() {
    const all = live();
    const td = today();
    const others = PEOPLE.filter((p) => p !== me());
    const chips = ["All"].concat(others).map((p) => '<button class="tt-chip' + (TT.filter === p ? " on" : "") + '" data-filter="' + p + '">' + p +
      (p !== "All" ? ' <b>' + all.filter((t) => t.to === p && isOpen(t)).length + "</b>" : "") + "</button>").join("");
    const scope = TT.filter === "All" ? all : all.filter((t) => t.to === TT.filter);
    let html = statsHTML(scope.filter((t) => t.to !== me())) + '<div class="tt-chips tt-filter">' + chips + "</div>";

    const attention = scope.filter((t) => t.to !== me() && (t.status === "stuck" || needsCheck(t)))
      .sort((a, b) => (a.status === "stuck" ? 0 : 1) - (b.status === "stuck" ? 0 : 1) || sortOpen(a, b));
    html += section("👀 Needs your attention", attention, { showTo: true });

    if (TT.filter === "All") {
      const mine = all.filter((t) => t.to === me() && isOpen(t)).sort(sortOpen);
      if (mine.length) html += section("🙋 Assigned to you (" + esc(me()) + ")", mine);
    }

    const people = TT.filter === "All" ? others : [TT.filter];
    people.forEach((p) => {
      const open = all.filter((t) => t.to === p && isOpen(t) && t.status !== "stuck").sort(sortOpen);
      const late = open.filter((t) => t.due < td).length;
      html += section("👤 " + esc(p) + (late ? ' <span class="tt-late-n">' + late + " overdue</span>" : ""), open, null, "No open tasks");
    });
    return html;
  }

  function scoreFor(person, ws) {
    const we = addDays(ws, 6), td = today();
    const list = live().filter((t) => t.to === person);
    const dueWeek = list.filter((t) => t.due >= ws && t.due <= we);
    const evaluable = dueWeek.filter((t) => t.status === "done" || t.due < td);
    const onTime = evaluable.filter((t) => t.status === "done" && t.doneDate && t.doneDate <= t.due);
    const late = evaluable.filter((t) => !onTime.includes(t));
    const delays = late.map((t) => diffDays(t.status === "done" && t.doneDate ? t.doneDate : td, t.due)).filter((d) => d > 0);
    const completed = list.filter((t) => t.status === "done" && t.doneDate && t.doneDate >= ws && t.doneDate <= we);
    const redone = completed.filter((t) => (t.redoCount || 0) > 0);
    const assigned = list.filter((t) => t.createdDate >= ws && t.createdDate <= we);
    return {
      assigned: assigned.length,
      due: dueWeek.length,
      evaluable: evaluable.length,
      onTimePct: evaluable.length ? Math.round((onTime.length / evaluable.length) * 100) : null,
      lateCount: late.length,
      avgDelay: delays.length ? (delays.reduce((a, b) => a + b, 0) / delays.length).toFixed(1) : null,
      completed: completed.length,
      redoPct: completed.length ? Math.round((redone.length / completed.length) * 100) : null,
      late,
    };
  }

  function scoreHTML() {
    const ws = weekStart(TT.weekOffset), we = addDays(ws, 6), td = today();
    const label = TT.weekOffset === 0 ? "This week" : TT.weekOffset === -1 ? "Last week" : fmtDate(ws) + " – " + fmtDate(we);
    let html = '<div class="tt-wk"><button class="btn btn-sm" data-week="-1">◀</button><div><b>' + label + '</b><div class="tt-dim">' +
      fmtDate(ws) + " – " + fmtDate(we) + '</div></div><button class="btn btn-sm" data-week="1"' + (TT.weekOffset >= 0 ? " disabled" : "") + ">▶</button></div>";
    const pct = (v) => (v == null ? "—" : v + "%");
    const tone = (v, good, bad, invert) => {
      if (v == null) return "";
      const n = Number(v);
      if (!invert) return n >= good ? "g" : n < bad ? "r" : "o";
      return n <= good ? "g" : n > bad ? "r" : "o";
    };
    STAFF.forEach((p) => {
      const s = scoreFor(p, ws);
      const open = live().filter((t) => t.to === p && isOpen(t));
      const overdueNow = open.filter((t) => t.due < td).length;
      const stuckNow = open.filter((t) => t.status === "stuck").length;
      const trend = [-3, -2, -1, 0].map((o) => {
        const w = weekStart(TT.weekOffset + o);
        const v = scoreFor(p, w).onTimePct;
        return '<div class="tt-bar"><div class="tt-bar-f ' + tone(v, 85, 60) + '" style="height:' + (v == null ? 0 : Math.max(4, v)) + '%"></div><span>' +
          (v == null ? "–" : v) + "</span></div>";
      }).join("");
      html +=
        '<div class="card tt-score"><div class="card-hdr">👤 ' + esc(p) + '<span class="tt-dim">' + s.assigned + " assigned · " + s.completed + " completed</span></div>" +
        '<div class="tt-sgrid">' +
        '<div class="tt-m ' + tone(s.onTimePct, 85, 60) + '"><div class="v">' + pct(s.onTimePct) + '</div><div class="l">On time</div><div class="tt-dim">' + (s.evaluable - s.lateCount) + " of " + s.evaluable + "</div></div>" +
        '<div class="tt-m ' + tone(s.avgDelay, 0.5, 2, true) + '"><div class="v">' + (s.avgDelay == null ? "—" : s.avgDelay + "d") + '</div><div class="l">Avg delay (late ones)</div></div>' +
        '<div class="tt-m ' + tone(s.redoPct, 5, 20, true) + '"><div class="v">' + pct(s.redoPct) + '</div><div class="l">Redo rate</div></div>' +
        '<div class="tt-m ' + (overdueNow ? "r" : "g") + '"><div class="v">' + overdueNow + '</div><div class="l">Overdue now</div><div class="tt-dim">' + stuckNow + " stuck</div></div>" +
        "</div>" +
        '<div class="tt-trend"><div class="tt-dim">On-time % · last 4 weeks</div><div class="tt-bars">' + trend + "</div></div>" +
        (s.late.length ? '<details class="tt-late-list"><summary>Late tasks this week (' + s.late.length + ")</summary>" +
          s.late.map((t) => "<div>• " + esc(t.title) + ' <span class="tt-dim">— due ' + fmtDate(t.due) + (t.doneDate ? ", done " + fmtDate(t.doneDate) : ", still open") + "</span></div>").join("") + "</details>" : "") +
        "</div>";
    });
    html += '<div class="tt-dim tt-note">On time = done on or before the due date. Only tasks whose due date has passed (or are done) are counted. Raman and Aman have no scorecard.</div>';
    return html;
  }

  function historyHTML() {
    const q = TT.histSearch.toLowerCase();
    const done = live().filter((t) => t.status === "done" && (TT.filter === "All" || t.to === TT.filter))
      .filter((t) => !q || (t.title + " " + t.notes + " " + t.to + " " + t.cat).toLowerCase().includes(q))
      .sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1)).slice(0, 150);
    return '<input class="inp tt-w" id="tt-hsearch" placeholder="🔍 Search done tasks…" value="' + esc(TT.histSearch) + '" style="margin-bottom:12px">' +
      section("✅ Completed", done, { showTo: true, reopen: true }, "No completed tasks yet");
  }

  function render() {
    const root = document.getElementById("tt-root");
    if (!root) return;
    const person = me();
    if (!person) {
      root.innerHTML = '<div class="tt-empty">Team Tasks needs a personal PIN. Please logout and login with your own PIN.</div>';
      return;
    }
    let html;
    if (!isOwner()) {
      html =
        '<div class="ph"><div><div class="pt">MY <span>TASKS</span></div><div class="pt-sub">' + esc(person) + " · tap Done when finished / काम पूरा होते ही Done दबाएँ</div></div></div>" +
        statsHTML(live().filter((t) => t.to === person)) + myTasksHTML(person);
    } else {
      const tabs = [["board", "📋 Board"], ["score", "📊 Scorecard"], ["history", "✅ Done"]]
        .map((x) => '<button class="tt-tab' + (TT.tab === x[0] ? " on" : "") + '" data-tab="' + x[0] + '">' + x[1] + "</button>").join("");
      html =
        '<div class="ph"><div><div class="pt">TEAM <span>TASKS</span></div><div class="pt-sub">Assign work · track completion · weekly efficiency</div></div>' +
        '<div style="display:flex;gap:8px"><button class="btn" data-act2="phones" title="WhatsApp numbers">📱</button><button class="btn btn-p" data-act2="new">+ Assign Task</button></div></div>' +
        '<div class="tt-tabs">' + tabs + "</div>" +
        (TT.tab === "board" ? boardHTML() : TT.tab === "score" ? scoreHTML() : historyHTML());
    }
    if (!TT.loaded) html = '<div class="tt-dim" style="margin-bottom:8px">🔄 Syncing…</div>' + html;
    const hs = document.activeElement && document.activeElement.id === "tt-hsearch" ? document.activeElement.selectionStart : null;
    root.innerHTML = html;
    if (hs != null) { const i = document.getElementById("tt-hsearch"); if (i) { i.focus(); i.setSelectionRange(hs, hs); } }
  }

  function badge() {
    const b = document.getElementById("b-tasks");
    if (!b) return;
    const person = me(), td = today();
    let n = 0;
    if (!person) n = 0;
    else if (isOwner()) n = live().filter((t) => (t.to !== person && (t.status === "stuck" || needsCheck(t))) || (t.to === person && isOpen(t) && t.due <= td)).length;
    else n = live().filter((t) => t.to === person && isOpen(t) && t.due <= td).length;
    b.textContent = n || "";
    b.style.display = n ? "" : "none";
  }

  function refresh() {
    badge();
    const mod = document.getElementById("mod-tasks");
    if (mod && mod.classList.contains("on") && !(document.getElementById("tt-modal") && document.getElementById("tt-modal").style.display === "flex")) render();
  }
  TT.render = render;
  TT.refresh = refresh;

  // ── mount into the app ─────────────────────────────────
  function mount() {
    // sidebar entry (Home group, next to Stock)
    if (!document.getElementById("n-tasks")) {
      const stock = document.getElementById("n-stock");
      const item = document.createElement("div");
      item.className = "sb-item";
      item.id = "n-tasks";
      item.setAttribute("onclick", "go('tasks')");
      item.innerHTML = '<span class="sb-ico">📋</span>Team Tasks<span class="sb-bdg o" id="b-tasks" style="display:none"></span>';
      if (stock && stock.parentElement) stock.parentElement.insertBefore(item, stock);
    }
    if (typeof MENU_META !== "undefined" && !MENU_META.tasks) MENU_META.tasks = { label: "Team Tasks", icon: "📋", group: "Home" };

    // module container
    if (!document.getElementById("mod-tasks")) {
      const mc = document.getElementById("mc");
      const mod = document.createElement("div");
      mod.className = "mod";
      mod.id = "mod-tasks";
      mod.innerHTML = '<div id="tt-root"></div>';
      if (mc) mc.appendChild(mod);
    }

    const root = document.getElementById("tt-root");
    root.addEventListener("click", (e) => {
      const a = e.target.closest("[data-act]");
      if (a) { act(a.dataset.act, a.dataset.id); return; }
      const a2 = e.target.closest("[data-act2]");
      if (a2) { if (a2.dataset.act2 === "new") openForm(); else if (a2.dataset.act2 === "phones") openPhones(); return; }
      const tab = e.target.closest("[data-tab]");
      if (tab) { TT.tab = tab.dataset.tab; render(); return; }
      const f = e.target.closest("[data-filter]");
      if (f) { TT.filter = f.dataset.filter; render(); return; }
      const w = e.target.closest("[data-week]");
      if (w && !w.disabled) { TT.weekOffset = Math.min(0, TT.weekOffset + Number(w.dataset.week)); render(); }
    });
    root.addEventListener("input", (e) => {
      if (e.target.id === "tt-hsearch") { TT.histSearch = e.target.value; render(); }
    });

    // render whenever the module is opened
    if (typeof window.go === "function" && !window.go.__tt) {
      const origGo = window.go;
      window.go = function (id) {
        const r = origGo.apply(this, arguments);
        staffNav();
        if (document.getElementById("mod-tasks").classList.contains("on")) render();
        return r;
      };
      window.go.__tt = true;
    }

    // re-apply sidebar visibility for the current role (applyRole may have run before we existed)
    const item = document.getElementById("n-tasks");
    if (item && typeof currentRole !== "undefined" && currentRole === "employee" && typeof empAllowed === "function") {
      item.style.display = empAllowed("tasks") ? "" : "none";
    }
    if (typeof applyMenuOrder === "function") { try { applyMenuOrder(); } catch (e) {} }

    loadCache();
    badge();
    if (document.getElementById("mod-tasks").classList.contains("on")) render();
    startSync();
    // day rollover / overdue labels stay current
    setInterval(refresh, 5 * 60 * 1000);
  }

  // Staff tab bar — Deevanshu / Yash switch between Tasks and Stock in one tap
  function staffNav() {
    let bar = document.getElementById("tt-empnav");
    const show = typeof currentRole !== "undefined" && currentRole === "employee" && !!me();
    if (!bar) {
      const mc = document.getElementById("mc");
      if (!mc) return;
      bar = document.createElement("div");
      bar.id = "tt-empnav";
      bar.innerHTML = [["tasks", "📋 My Tasks"], ["stock", "📦 Stock"], ["production", "🏭 Production"], ["attendance", "🕐 Attendance"]]
        .map((x) => '<button data-nav="' + x[0] + '">' + x[1] + "</button>").join("");
      bar.addEventListener("click", (e) => { const b = e.target.closest("[data-nav]"); if (b) go(b.dataset.nav); });
      mc.insertBefore(bar, mc.firstChild);
    }
    bar.style.display = show ? "flex" : "none";
    const on = document.querySelector(".mod.on");
    const cur = on ? on.id.replace("mod-", "") : "";
    bar.querySelectorAll("[data-nav]").forEach((b) => b.classList.toggle("on", b.dataset.nav === cur));
  }
  TT.staffNav = staffNav;

  // employees with a personal PIN land on Tasks — if login finished before we mounted, move them there now
  function landEmployee() {
    if (typeof currentRole !== "undefined" && currentRole === "employee" && me() &&
        document.getElementById("login-screen") && document.getElementById("login-screen").style.display === "none" &&
        (!document.querySelector(".mod.on") || document.querySelector(".mod.on").id === "mod-stock") &&
        location.search.indexOf("kiosk") < 0 && location.hash.indexOf("attendance") < 0) {
      go("tasks");
    }
  }

  const css = `
  #tt-empnav{display:none;gap:6px;overflow-x:auto;margin:0 0 14px;padding-bottom:2px;-webkit-overflow-scrolling:touch}
  #tt-empnav button{flex:1 0 auto;background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:10px 12px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit;white-space:nowrap}
  #tt-empnav button.on{background:var(--ac,#2563eb);border-color:var(--ac,#2563eb);color:#fff}
  .tt-tabs{display:flex;gap:6px;margin-bottom:12px;border-bottom:1px solid var(--b1)}
  .tt-tab{background:none;border:none;border-bottom:3px solid transparent;padding:9px 12px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;font-family:inherit}
  .tt-tab.on{color:var(--ac);border-bottom-color:var(--ac)}
  .tt-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
  .tt-stat{background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:10px;text-align:center}
  .tt-stat .v{font-size:22px;font-weight:800}.tt-stat .l{font-size:11px;color:var(--muted);font-weight:600}
  .tt-stat.red .v{color:var(--red,#dc2626)}.tt-stat.orange .v{color:var(--orange,#ea580c)}.tt-stat.blue .v{color:var(--ac,#2563eb)}
  .tt-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
  .tt-chip{background:var(--s2);border:1px solid var(--b1);border-radius:20px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit;color:var(--tx)}
  .tt-chip.on{background:var(--ac,#2563eb);border-color:var(--ac,#2563eb);color:#fff}
  .tt-chip.tt-urg.on{background:#dc2626;border-color:#dc2626}
  .tt-filter{margin-bottom:14px}
  .tt-sec{margin-bottom:16px}
  .tt-sh{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:4px 0 8px;display:flex;align-items:center;gap:8px}
  .tt-cnt{background:var(--s2);border:1px solid var(--b1);border-radius:10px;padding:0 7px;font-size:11px}
  .tt-late-n{background:#fee2e2;color:#b91c1c;border-radius:10px;padding:1px 8px;font-size:11px;text-transform:none}
  .tt-card{background:var(--s1);border:1px solid var(--b1);border-left:4px solid var(--b1);border-radius:10px;padding:11px 12px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .tt-card.tt-urgent{border-left-color:#dc2626}.tt-card.tt-late{background:#fff7f7}
  .tt-top{display:flex;gap:8px;align-items:flex-start}
  .tt-title{flex:1;font-size:15px;font-weight:700;line-height:1.35;word-break:break-word}
  .tt-tools{display:flex;gap:2px;flex-shrink:0}
  .tt-ic{background:none;border:none;font-size:15px;cursor:pointer;padding:2px 4px;opacity:.7}.tt-ic:hover{opacity:1}
  .tt-notes{font-size:13px;color:var(--muted);margin-top:3px}
  .tt-reason{font-size:13px;color:#b91c1c;background:#fef2f2;border-radius:6px;padding:5px 8px;margin-top:6px}
  .tt-redo-r{color:#92400e;background:#fffbeb}
  .tt-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:7px;font-size:12px}
  .tt-tag{background:var(--s2);border:1px solid var(--b1);border-radius:6px;padding:2px 7px;font-size:11.5px;font-weight:600;color:var(--muted)}
  .tt-tag.tt-u{background:#dc2626;border-color:#dc2626;color:#fff}
  .tt-tag.late{background:#fee2e2;border-color:#fecaca;color:#b91c1c}.tt-tag.today{background:#fef3c7;border-color:#fde68a;color:#92400e}.tt-tag.ok{background:#dcfce7;border-color:#bbf7d0;color:#166534}
  .tt-tag.tt-prog{background:#dbeafe;border-color:#bfdbfe;color:#1d4ed8}.tt-tag.tt-stk{background:#ffedd5;border-color:#fed7aa;color:#c2410c}
  .tt-tag.tt-wait{background:#ede9fe;border-color:#ddd6fe;color:#6d28d9}.tt-tag.tt-okt{background:#dcfce7;border-color:#bbf7d0;color:#166534}
  .tt-tag.tt-to{color:var(--tx)}
  .tt-dim{color:var(--muted);font-size:12px;font-weight:400}
  .tt-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
  .tt-b{flex:1;min-width:90px;border:1px solid var(--b1);background:var(--s2);border-radius:8px;padding:10px 8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:var(--tx)}
  .tt-b small{font-weight:500;opacity:.8;font-size:11px}
  .tt-b-done{background:#16a34a;border-color:#16a34a;color:#fff}.tt-b-stuck{background:#fff7ed;border-color:#fed7aa;color:#c2410c}
  .tt-b-start{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
  .tt-b-ok{background:#16a34a;border-color:#16a34a;color:#fff}.tt-b-redo{background:#fffbeb;border-color:#fde68a;color:#92400e}
  .tt-empty{color:var(--muted);font-size:13px;padding:12px;text-align:center;background:var(--s2);border-radius:10px}
  .tt-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10050;display:none;align-items:flex-end;justify-content:center}
  .tt-sheet{background:var(--s1,#fff);width:100%;max-width:520px;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}
  @media(min-width:700px){.tt-ov{align-items:center}.tt-sheet{border-radius:16px}}
  .tt-mh{font-size:17px;font-weight:800;margin-bottom:12px}
  .tt-lbl{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin:10px 0 5px}
  .tt-w{width:100%;box-sizing:border-box}.tt-ta{width:100%;box-sizing:border-box;resize:vertical}
  .tt-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .tt-row{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:16px;flex-wrap:wrap}
  .tt-wa{margin-right:auto;font-size:13px;display:flex;align-items:center;gap:6px}
  .tt-hrow{padding:8px 0;border-bottom:1px solid var(--b1);font-size:13px}
  .tt-wk{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:12px;text-align:center}
  .tt-score .card-hdr{gap:8px}
  .tt-sgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--b1)}
  .tt-m{background:var(--s1);padding:12px 8px;text-align:center}
  .tt-m .v{font-size:24px;font-weight:800}.tt-m .l{font-size:11px;color:var(--muted);font-weight:700}
  .tt-m.g .v{color:#16a34a}.tt-m.o .v{color:#d97706}.tt-m.r .v{color:#dc2626}
  .tt-trend{padding:10px 14px}
  .tt-bars{display:flex;gap:10px;align-items:flex-end;height:70px;margin-top:6px}
  .tt-bar{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;font-size:11px;color:var(--muted)}
  .tt-bar-f{width:100%;max-width:40px;border-radius:4px 4px 0 0;background:#cbd5e1}
  .tt-bar-f.g{background:#16a34a}.tt-bar-f.o{background:#f59e0b}.tt-bar-f.r{background:#dc2626}
  .tt-late-list{padding:0 14px 12px;font-size:13px}.tt-late-list summary{cursor:pointer;font-weight:600;margin-bottom:6px}
  .tt-note{margin-top:6px}
  @media(max-width:600px){.tt-stats,.tt-sgrid{grid-template-columns:repeat(2,1fr)}.tt-2{grid-template-columns:1fr}}
  `;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  function boot() { mount(); landEmployee(); staffNav(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
