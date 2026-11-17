/* AURA Player Sponsorship — simple checklist.
   One player = one row with three ticks: Sent → Delivered → Post shared.
   Data: aman_assistant/auraChecklist, field `players` (map id → player).
   Each change writes only that player's key, so Aman and Juhi editing at the
   same time never overwrite each other, and it works offline (Firestore queue). */
(function(root){
  'use strict';
  const DOC_COL='aman_assistant', DOC_ID='auraChecklist';
  const STEPS=[['sent','Sent','📦'],['delivered','Delivered','✅'],['posted','Post shared','📱']];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fmt=d=>{if(!d)return '';const [y,m,dd]=d.split('-');return dd+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1];};
  const daysSince=d=>d?Math.floor((Date.parse(today())-Date.parse(d))/864e5):0;
  const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  const who=()=>typeof currentPerson!=='undefined'&&currentPerson?currentPerson:'Aman';
  const wa=p=>{let d=String(p||'').replace(/\D/g,'');if(d.length===10)d='91'+d;return d;};
  const stage=p=>p.posted?'done':p.delivered?'delivered':p.sent?'sent':'tosend';

  const UI={root:null,players:{},ready:false,unsub:null,filter:'all',query:'',
    ref(){return root.firebase.firestore().collection(DOC_COL).doc(DOC_ID);},
    allowed(){return typeof root.auraCanAccess==='function'&&root.auraCanAccess()&&document.getElementById('login-screen')?.style.display==='none';},
    mount(){
      if(this.root)return;
      this.root=document.createElement('section');this.root.id='mod-aura';this.root.className='mod';
      document.getElementById('mc').append(this.root);
      this.root.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(b)this.act(b.dataset.a,b.dataset.id,b.dataset.s);});
      this.root.addEventListener('input',e=>{if(e.target.id==='ac-q'){this.query=e.target.value;this.drawList();}});
      this.render();
    },
    listen(){
      if(this.unsub||!root.firebase?.apps?.length)return;
      this.unsub=this.ref().onSnapshot(snap=>{
        this.players=(snap.exists&&snap.data().players)||{};this.ready=true;
        if(!snap.exists)this.migrate();
        if(!document.getElementById('aura-dialog'))this.render();
      },err=>{this.ready=true;this.error=err.message;this.render();});
    },
    lock(){this.unsub?.();this.unsub=null;this.players={};this.ready=false;document.getElementById('aura-dialog')?.remove();if(this.root)this.root.replaceChildren();},
    async save(id,p){await this.ref().set({players:{[id]:p},updatedAt:new Date().toISOString()},{merge:true});},
    async remove(id){await this.ref().update({['players.'+id]:root.firebase.firestore.FieldValue.delete()});},

    // One-time carry-over of players saved in the old detailed tracker.
    async migrate(){
      try{
        const read=async c=>{const d=await root.firebase.firestore().collection(DOC_COL).doc(c).get();return d.exists?JSON.parse(d.data().data||'{}'):{};};
        const [pl,sh,pr]=await Promise.all([read('auraPlayers'),read('auraShipments'),read('auraPromotions')]);
        const out={};
        for(const p of Object.values(pl)){
          const ships=Object.values(sh).filter(s=>s.playerId===p.id).sort((a,b)=>(b.dispatchDate||'').localeCompare(a.dispatchDate||''));
          const s=ships[0]||{},posts=Object.values(pr).filter(x=>x.playerId===p.id&&(x.link||x.verifiedAt));
          out[p.id]={id:p.id,name:p.name||'',phone:p.phone||'',instagram:p.instagram||'',notes:p.notes||'',
            sent:s.dispatchDate||'',delivered:s.deliveredAt||'',posted:posts[0]?.publishedDate||(posts[0]?today():''),postLink:posts[0]?.link||'',
            createdAt:p.createdAt||new Date().toISOString(),by:'Aman'};
        }
        await this.ref().set({players:out,migratedAt:new Date().toISOString()},{merge:true});
      }catch(e){console.warn('AURA migrate',e);}
    },

    render(){
      if(!this.root||!this.allowed())return;
      if(!this.ready){this.root.innerHTML='<div class="ac-head"><h1>🏏 AURA Player Sponsorship</h1></div><p class="ac-muted">Loading…</p>';this.listen();return;}
      const all=Object.values(this.players),n=k=>all.filter(p=>stage(p)===k).length;
      const tabs=[['all','All',all.length],['tosend','To send',n('tosend')],['sent','Sent',n('sent')],['delivered','Delivered',n('delivered')],['done','Post shared',n('done')]];
      this.root.innerHTML=`
        <div class="ac-head"><div><h1>🏏 AURA Player Sponsorship</h1><p class="ac-muted">Sent → Delivered → Post shared</p></div>
          <button class="ac-btn ac-primary" data-a="add">＋ Add player</button></div>
        ${this.error?`<p class="ac-alert">${esc(this.error)}</p>`:''}
        <div class="ac-tabs">${tabs.map(([k,l,c])=>`<button class="ac-tab${this.filter===k?' on':''}" data-a="filter" data-id="${k}">${l} <b>${c}</b></button>`).join('')}</div>
        <input id="ac-q" class="ac-search" type="search" placeholder="Search player…" value="${esc(this.query)}">
        <div id="ac-list"></div>`;
      this.drawList();
    },
    drawList(){
      const box=document.getElementById('ac-list');if(!box)return;
      const q=this.query.trim().toLowerCase();
      const order={tosend:0,sent:1,delivered:2,done:3};
      const list=Object.values(this.players)
        .filter(p=>this.filter==='all'||stage(p)===this.filter)
        .filter(p=>!q||[p.name,p.phone,p.instagram,p.notes].join(' ').toLowerCase().includes(q))
        .sort((a,b)=>order[stage(a)]-order[stage(b)]||(a.name||'').localeCompare(b.name||''));
      if(!list.length){box.innerHTML=`<div class="ac-empty">${Object.keys(this.players).length?'No players here.':'No players yet — tap <b>＋ Add player</b>.'}</div>`;return;}
      box.innerHTML=list.map(p=>this.card(p)).join('');
    },
    card(p){
      const st=stage(p);
      const steps=STEPS.map(([k,l,ic],i)=>{
        const done=!!p[k],prevDone=i===0||!!p[STEPS[i-1][0]];
        return `<button class="ac-step${done?' done':''}" data-a="tick" data-id="${esc(p.id)}" data-s="${k}" ${!done&&!prevDone?'disabled':''}>
          <span class="ac-box">${done?'✓':''}</span><span><b>${ic} ${l}</b><small>${done?fmt(p[k]):'—'}</small></span></button>`;
      }).join('');
      let hint='';
      if(st==='sent'&&daysSince(p.sent)>=7)hint=`Sent ${daysSince(p.sent)} days ago — check delivery`;
      if(st==='delivered'&&daysSince(p.delivered)>=7)hint=`Delivered ${daysSince(p.delivered)} days ago — no post yet`;
      const phone=wa(p.phone);
      const msg=st==='delivered'?`Hi ${p.name}, hope you're enjoying your AURA gear! 🏏 Please share a post/reel with it and tag @aurabykri. Thanks! — Team AURA`
        :st==='sent'?`Hi ${p.name}, your AURA parcel is on its way. Please let us know once you receive it. — Team AURA`:'';
      return `<div class="ac-card ac-${st}">
        <div class="ac-top"><div><div class="ac-name">${esc(p.name)}</div>
          <div class="ac-muted">${[p.phone,p.instagram?`<a href="${esc(p.instagram.startsWith('http')?p.instagram:'https://instagram.com/'+p.instagram.replace('@',''))}" target="_blank" rel="noopener">Instagram</a>`:'',p.notes?esc(p.notes):''].filter(Boolean).join(' · ')}</div></div>
          <button class="ac-icon" data-a="edit" data-id="${esc(p.id)}" aria-label="Edit">✏️</button></div>
        <div class="ac-steps">${steps}</div>
        ${p.postLink?`<div class="ac-muted">Post: <a href="${esc(p.postLink)}" target="_blank" rel="noopener">open link</a></div>`:''}
        ${hint?`<div class="ac-hint">⏰ ${hint}</div>`:''}
        ${phone&&msg?`<a class="ac-wa" href="https://wa.me/${phone}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">💬 WhatsApp reminder</a>`:''}
      </div>`;
    },
    async act(a,id,s){
      try{
        if(a==='filter'){this.filter=id;this.render();return;}
        if(a==='add'||a==='edit')return this.form(id);
        if(a==='tick'){
          const p={...this.players[id]};const i=STEPS.findIndex(x=>x[0]===s);
          if(p[s]){
            if(!confirm(`Untick "${STEPS[i][1]}" for ${p.name}?`))return;
            STEPS.slice(i).forEach(([k])=>p[k]='');if(s==='posted'||i<2)p.postLink='';
          }else{
            p[s]=today();
            if(s==='posted'){const link=prompt('Paste the post link (optional):','');if(link===null){return;}p.postLink=link.trim();}
          }
          p.by=who();p.updatedAt=new Date().toISOString();
          this.players[id]=p;this.drawList();await this.save(id,p);
        }
      }catch(e){alert('Could not save: '+e.message);}
    },
    form(id){
      const p=id?this.players[id]:{};
      document.getElementById('aura-dialog')?.remove();
      const d=document.createElement('dialog');d.id='aura-dialog';
      d.innerHTML=`<form method="dialog"><h2>${id?'Edit player':'Add player'}</h2>
        <label>Player name<input name="name" required value="${esc(p.name)}"></label>
        <label>WhatsApp number <small>(optional)</small><input name="phone" type="tel" value="${esc(p.phone)}"></label>
        <label>Instagram <small>(optional)</small><input name="instagram" placeholder="@handle or link" value="${esc(p.instagram)}"></label>
        <label>Note <small>(optional — e.g. what was sent)</small><input name="notes" value="${esc(p.notes)}"></label>
        ${id?'':'<label class="ac-chk"><input type="checkbox" name="sentNow"> Already sent today</label>'}
        <div class="ac-actions">${id?'<button type="button" class="ac-btn ac-del" data-del>Delete</button>':''}<span style="flex:1"></span>
          <button type="button" class="ac-btn" data-cancel>Cancel</button><button class="ac-btn ac-primary" type="submit">Save</button></div></form>`;
      document.body.append(d);d.showModal();
      const close=()=>{d.close();d.remove();this.render();};
      d.querySelector('[data-cancel]').onclick=close;
      d.querySelector('[data-del]')?.addEventListener('click',async()=>{if(!confirm('Delete '+p.name+'?'))return;delete this.players[id];close();try{await this.remove(id);}catch(e){alert('Could not delete: '+e.message);}});
      d.querySelector('form').onsubmit=async e=>{
        e.preventDefault();const f=new FormData(e.target);const name=String(f.get('name')||'').trim();if(!name)return;
        const pid=id||uid();
        const np={...(p||{}),id:pid,name,phone:String(f.get('phone')||'').trim(),instagram:String(f.get('instagram')||'').trim(),notes:String(f.get('notes')||'').trim(),
          sent:p.sent||(f.get('sentNow')?today():''),delivered:p.delivered||'',posted:p.posted||'',postLink:p.postLink||'',
          createdAt:p.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),by:who()};
        this.players[pid]=np;close();
        try{await this.save(pid,np);}catch(err){alert('Could not save: '+err.message);}
      };
    }
  };
  root.AuraUI=UI;
})(window);
