// IndiaMart personal-name review. Suggestions never select or delete a lead.
function imPersonalReason(contact, archive) {
  if (contact.source !== 'indiamart' && !String(contact.id).startsWith('im_')) return '';
  const qid = String(contact.qid || String(contact.id).replace(/^im_/, ''));
  const lead = (archive || []).find(l => String(l.qid) === qid) || {};
  const name = String(contact.name || '').trim();
  const businessWord = /\b(?:sports?|sporting|traders?|trading|enterprises?|industr(?:y|ies|ial)|pvt|private|ltd|limited|llp|llc|inc|corp(?:oration)?|co|company|store|shop|mart|agency|agencies|distributors?|suppliers?|wholesal\w*|retail\w*|manufactur\w*|exports?|imports?|international|global|overseas|impex|works|factory|fabrics?|textiles?|garments?|footwear|fashion|collection|boutique|jewel\w*|hardware|electricals?|electronics?|technolog\w*|solutions?|services?|systems?|construction|builders?|engineering|rubber|plastic|packaging|printing|press|furniture|furnish\w*|fittings?|medical|pharma\w*|hospital|clinic|school|college|academy|club|association|foundation|trust|cricket|fitness|gym|bat|bats|grips?|handles?|equipment|goods|products?|emporium|bazar|bazaar|udyog|udhyog|kendra|centre|center|depot|sons|brothers|bros)\b/i;
  // Prefer a separate supplied business name, when present, over a person's display name.
  const names = [name, contact.company, contact.companyName, contact.businessName, lead.name, lead.company, lead.SENDER_COMPANY].filter(Boolean);
  if (names.some(n => businessWord.test(String(n)) || /[&@/\\\d]/.test(String(n)) || /\bm\s*\/\s*s\b/i.test(String(n)))) return '';
  if (!name || /^(?:unknown|buyer|customer|test|na|n\/a|none|null|india\s*mart)$/i.test(name)) return '';
  // A short name made of letters/initials is a suggestion, not proof of buyer quality.
  const words = name.replace(/^(?:mr|mrs|ms|dr|shri|smt)\.?\s+/i, '').split(/\s+/);
  if (words.length > 5 || !words.every(w => /^[\p{L}\p{M}.'’\-]+$/u.test(w)) || !/\p{L}{2}/u.test(name)) return '';
  return 'Likely personal name — no business wording in the supplied name; please verify';
}

const IM_PERSONAL_REVIEW = { selected: new Set(), busy: false };
function imReviewEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function imReviewContacts() {
  return (D.crm || []).filter(c => c.source === 'indiamart' || String(c.id).startsWith('im_'));
}
function openImPersonalReview() {
  if (currentRole !== 'owner') return;
  IM_PERSONAL_REVIEW.selected.clear();
  let modal = document.getElementById('im-personal-review');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'im-personal-review';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);padding:16px;overflow:auto';
    modal.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="im-review-title" style="background:var(--bg,#fff);color:var(--text,inherit);max-width:900px;margin:20px auto;padding:20px;border-radius:16px">
      <h2 id="im-review-title">Review personal-name IndiaMart leads</h2>
      <p>Suggestions flag names that look like a person rather than a business. Business names containing words such as Sports, Traders or Enterprises are excluded. A personal name may still belong to a genuine business buyer — review before selecting.</p>
      <label>Show <select id="im-review-mode" class="sel"><option value="suggested">Likely personal names</option><option value="all">All IndiaMart contacts</option></select></label>
      <label>Search <input id="im-review-search" class="inp" placeholder="Name, phone or enquiry"></label>
      <p id="im-review-count" aria-live="polite"></p><div id="im-review-list"></div>
      <p id="im-review-status" role="status"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><button id="im-review-delete" class="btn">Delete selected leads</button><button id="im-review-close" class="btn">Close</button></div>
      <p style="font-size:12px">Deletion removes selected contacts and matching archived/inbox enquiries, and blocks those query IDs from re-importing. A backup of the selected records downloads before deletion.</p>
    </section>`;
    document.body.appendChild(modal);
    document.getElementById('im-review-mode').onchange = renderImPersonalReview;
    document.getElementById('im-review-search').oninput = renderImPersonalReview;
    document.getElementById('im-review-delete').onclick = deleteImPersonalSelection;
    document.getElementById('im-review-close').onclick = () => {
      if (!IM_PERSONAL_REVIEW.busy) { modal.style.display = 'none'; document.getElementById('im-review-open')?.focus(); }
    };
  }
  modal.style.display = 'block';
  document.getElementById('im-review-status').textContent = '';
  renderImPersonalReview();
  document.getElementById('im-review-mode').focus();
}
function renderImPersonalReview() {
  const mode = document.getElementById('im-review-mode').value;
  const search = document.getElementById('im-review-search').value.toLowerCase().trim();
  const contacts = imReviewContacts().filter(c => (mode === 'all' || imPersonalReason(c, D.imLeads)) &&
    (!search || [c.name,c.phone,c.note,c.userNotes].join(' ').toLowerCase().includes(search)));
  const list = document.getElementById('im-review-list');
  list.replaceChildren();
  contacts.slice(0, 200).forEach(c => {
    const lead = (D.imLeads || []).find(l => String(l.qid) === String(c.qid || String(c.id).replace(/^im_/, '')));
    const row = document.createElement('label');
    row.style.cssText = 'display:block;border:1px solid var(--b1,#ccc);border-radius:10px;padding:12px;margin:8px 0;overflow-wrap:anywhere';
    row.innerHTML = `<input type="checkbox"> <strong>${imReviewEsc(c.name)}</strong> · ${imReviewEsc(c.phone)} · ${imReviewEsc(c.city)}
      <div>${imReviewEsc(imPersonalReason(c,D.imLeads) || 'Business-style or unclear name — review manually')}</div>
      <div style="white-space:pre-wrap;margin-top:8px">${imReviewEsc(c.note || lead?.message || 'No enquiry text available')}</div>
      <div style="white-space:pre-wrap">${imReviewEsc(c.userNotes || '')}</div>`;
    const box = row.querySelector('input');
    box.checked = IM_PERSONAL_REVIEW.selected.has(c.id);
    box.disabled = IM_PERSONAL_REVIEW.busy;
    box.onchange = () => { box.checked ? IM_PERSONAL_REVIEW.selected.add(c.id) : IM_PERSONAL_REVIEW.selected.delete(c.id); updateImReviewCount(contacts.length); };
    list.appendChild(row);
  });
  if (!contacts.length) list.textContent = 'No matching leads. Choose All IndiaMart contacts to review other enquiries.';
  if (contacts.length > 200) list.append('Showing the first 200 matches. Use search to narrow the list.');
  updateImReviewCount(contacts.length);
}
function updateImReviewCount(matches) {
  document.getElementById('im-review-count').textContent = `${matches} matches · ${IM_PERSONAL_REVIEW.selected.size} selected (including selections hidden by filters)`;
  document.getElementById('im-review-delete').disabled = IM_PERSONAL_REVIEW.busy || !IM_PERSONAL_REVIEW.selected.size;
}
function imReviewDeletionPlan(contacts, archive, inbox, blocked, selected) {
  const removed = contacts.filter(c => selected.has(c.id) && (c.source === 'indiamart' || String(c.id).startsWith('im_')));
  const ids = new Set(removed.map(c => c.id));
  const qids = new Set(removed.map(c => String(c.qid || (String(c.id).startsWith('im_') ? String(c.id).slice(3) : ''))).filter(Boolean));
  return { removed, contacts: contacts.filter(c => !ids.has(c.id)), archive: archive.filter(l => !qids.has(String(l.qid))),
    inbox: inbox.filter(l => !qids.has(String(l.qid))), blocked: [...new Set(blocked.map(String).concat([...qids]))] };
}
async function deleteImPersonalSelection() {
  if (IM_PERSONAL_REVIEW.busy || currentRole !== 'owner') return;
  const status = document.getElementById('im-review-status');
  if (!firebaseReady || !db || !window.__fbInitialLoadDone) { status.textContent = 'Wait for cloud data to finish loading before deleting.'; return; }
  const plan = imReviewDeletionPlan(D.crm || [], D.imLeads || [], D.imInbox || [], D.imBlocked || [], IM_PERSONAL_REVIEW.selected);
  if (!plan.removed.length) return;
  if (!confirm(`Delete these ${plan.removed.length} selected IndiaMart contacts and their matching enquiries? Their query IDs will be blocked from re-importing.`)) return;
  IM_PERSONAL_REVIEW.busy = true;
  renderImPersonalReview();
  try {
    // Complete pending edits first; deletion writes every related document atomically.
    await flushNow();
    if (pendingSaves.size) throw new Error('Some edits have not synced. Retry after sync completes.');
    const fresh = imReviewDeletionPlan(D.crm || [], D.imLeads || [], D.imInbox || [], D.imBlocked || [], IM_PERSONAL_REVIEW.selected);
    if (fresh.contacts.length > CHUNK_SIZE * MAX_CRM_CHUNKS || fresh.archive.length > CHUNK_SIZE * MAX_IML_CHUNKS) throw new Error('Storage capacity exceeded. No leads were deleted.');
    const backup = { _app:'aman-walia-assistant-personal-lead-backup', exportedAt:new Date().toISOString(), contacts:fresh.removed,
      leads:(D.imLeads || []).filter(l => !fresh.archive.includes(l)), inbox:(D.imInbox || []).filter(l => !fresh.inbox.includes(l)) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href=url; link.download='indiamart-deleted-leads-'+todayStr()+'.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),10000);
    const batch = db.batch();
    const put = (name,data) => batch.set(db.collection('aman_assistant').doc(name), {data:JSON.stringify(data),updatedAt:new Date().toISOString()});
    const crmChunks = {}, leadChunks = {};
    for(let i=0;i<MAX_CRM_CHUNKS;i++){ const key='crm_'+(i+1); crmChunks[key]=fresh.contacts.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE); put(key,crmChunks[key]); }
    for(let i=0;i<MAX_IML_CHUNKS;i++){ const key='imLeads_'+(i+1); leadChunks[key]=fresh.archive.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE); put(key,leadChunks[key]); }
    const meta = {...D.crmMeta,total:fresh.contacts.length,updatedAt:todayStr()};
    put('crmMeta',meta); put('imBlocked',fresh.blocked); put('imInbox',fresh.inbox);
    // Clear legacy storage too, so migration cannot resurrect deleted enquiries.
    put('imLeads',[]);
    status.textContent='Saving deletion…';
    await batch.commit();
    D.crm=fresh.contacts; D.imLeads=fresh.archive; D.imInbox=fresh.inbox; D.imBlocked=fresh.blocked; D.crmMeta=meta;
    window.__crmChunks=crmChunks; window.__imlChunks=leadChunks;
    IM_PERSONAL_REVIEW.selected.clear();
    status.textContent=`Deleted ${fresh.removed.length} selected leads. Matching query IDs are blocked from re-importing.`;
    R.crm();
  } catch(e) { status.textContent='Deletion was not confirmed: '+e.message; }
  finally { IM_PERSONAL_REVIEW.busy=false; renderImPersonalReview(); }
}
