(function(root){
  'use strict';
  const C=root.AuraCore;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid=()=>crypto.randomUUID().replace(/-/g,'');
  const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n/100);
  const btn=(label,action,id='',primary=false)=>`<button type="button" ${primary?'class="primary"':''} data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`+(action==='exception'?btn('Edit tracking / costs','amend',id):action==='submit'?btn('Edit commitment','obligation-edit',id):'');
  const link=(href,label)=>{try{return href?`<a href="${esc(C.url(href))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:'';}catch(_){return 'Invalid saved link';}};
  const field=(name,label,value='',type='text',required=false,wide=false)=>`<label ${wide?'class="au-wide"':''}>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${type==='number'?'min="0" step="1"':''}></label>`;
  const area=(name,label,value='')=>`<label class="au-wide">${esc(label)}<textarea name="${name}" maxlength="4000">${esc(value)}</textarea></label>`;
  const select=(name,label,options,value)=>`<label>${esc(label)}<select name="${name}" aria-label="${esc(label)}">${options.map(([v,t])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
  const today=()=>C.day(new Date().toISOString());
  const activityNames={'player.save':'Player profile saved','player.archive':'Player archive status changed','settings.save':'Default commitments updated','shipment.dispatch':'Products dispatched','shipment.deliver':'Delivery confirmed','shipment.exception':'Shipment exception updated','shipment.amend':'Tracking or costs corrected','promotion.add':'Content obligation added','promotion.edit':'Content commitment updated','promotion.submit':'Promotion evidence recorded','promotion.verify':'Promotional content verified','promotion.reopen':'Content verification reopened','followup.save':'Follow-up scheduled','followup.complete':'Follow-up completed','backup.restore':'Sponsorship backup restored'};
  const UI={config:null,store:null,root:null,view:'dashboard',playerId:'',filter:'',query:'',generation:0,auth:null,opening:false,
    mount(config){
      this.config=config;if(this.root)return;
      this.root=document.createElement('section');this.root.id='mod-aura';this.root.className='mod';document.getElementById('mc').append(this.root);
      this.root.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)this.action(b.dataset.action,b.dataset.id).catch(e=>this.notice(e.message));});
      this.root.addEventListener('input',e=>{if(e.target.id==='aura-search'){this.query=e.target.value;const pos=e.target.selectionStart;this.render();const input=document.getElementById('aura-search');input.focus();input.setSelectionRange(pos,pos);}});
      this.render();
    },
    allowed(){return this.config?.enabled&&typeof currentRole!=='undefined'&&currentRole==='owner'&&document.getElementById('login-screen')?.style.display==='none';},
    lock(){this.generation++;this.opening=false;this.authStop?.();this.authStop=null;this.store?.close();this.store=null;document.getElementById('aura-dialog')?.remove();if(this.root)this.root.replaceChildren();},
    notice(message){if(!this.root||!this.allowed())return;const el=document.getElementById('aura-message');if(el){el.textContent=message;el.hidden=false;}},
    async signIn(){
      // No separate Google owner verification: opens with the app's own login.
      if(!this.allowed())throw new Error('Please log in to the app first');
      if(this.opening||this.store)return;this.opening=true;const generation=++this.generation;
      try{
        const store=new root.AuraStore({uid:'owner',db:new root.AuraDocDB(root.firebase.firestore()),onChange:()=>{if(!document.getElementById('aura-dialog'))this.render();}});
        this.store=store;await store.open();
        if(!this.allowed()||generation!==this.generation){store.close();if(this.store===store)this.store=null;return;}
        this.render();
      }catch(e){this.store=null;throw e;}finally{this.opening=false;}
    },
    render(){
      if(!this.root||!this.allowed())return;
      const head=`<div class="au-head"><div><p class="au-muted">AURA · PLAYER PARTNERSHIPS</p><h1>Player sponsorship</h1><p class="au-muted">Dispatched → Delivered → Promoted</p></div></div><div id="aura-message" class="au-alert" role="status" hidden></div>`;
      if(!this.store){this.root.innerHTML=head+'<p role="status">Opening sponsorship records…</p>';this.signIn().catch(e=>{if(this.root)this.root.innerHTML=head+'<p class="au-alert">'+esc(e.message)+'</p>';});return;}
      if(!this.store.ready){this.root.innerHTML=head+'<p role="status">Opening secure local records…</p>';return;}
      const s=this.store.state;
      this.root.innerHTML=head+`<div class="au-alert" role="status">${esc(this.store.message)} · ${this.store.queue.length} pending ${btn('Retry sync','sync')}${this.store.queue.some(x=>x.error)?btn('Resolve pending changes','resolve'):''}</div><div class="au-toolbar">${['dashboard','players','followups','settings','history'].map(v=>`<button data-action="view" data-id="${v}" aria-pressed="${this.view===v}">${({dashboard:'Dashboard',players:'Players',followups:'Follow-ups',settings:'Commitments',history:'Activity'})[v]}</button>`).join('')}</div><div class="au-toolbar">${btn('Add player','player-new','',true)}${btn('Export AURA backup','export')}${btn('Restore AURA backup','import')}</div>`+
        (this.view==='player'?this.player(s):this.view==='players'?this.players(s):this.view==='followups'?this.followups(s):this.view==='settings'?this.settings(s):this.view==='history'?this.history(s):this.dashboard(s));
    },
    dashboard(s){
      const d=C.dashboard(s,today()),cards=[['Pending deliveries',d.deliveries,'deliveries'],['Pending promotions',d.promotions,'promotions'],['Completed promotions',d.completed,'completed']];
      const filtered=this.filter?d[this.filter]:Object.values(s.auraShipments).filter(x=>!['cancelled','returned'].includes(x.exception));
      return `<div class="au-grid">${cards.map(([title,list,key])=>`<div class="au-card"><h3>${title}</h3><strong class="au-metric">${list.length}</strong><p class="au-muted">${new Set(list.map(x=>x.playerId)).size} players</p>${btn('View shipments','filter',key)}</div>`).join('')}</div><div class="au-card"><div class="au-row"><p><b>${d.followUps.length}</b> follow-ups due · <b>${d.exceptions.length}</b> flagged shipments</p>${btn('View exceptions','filter','exceptions')}</div><p>Total committed sponsorship cost: <b>${money(d.totalCost)}</b></p><p class="au-muted">Includes returned and cancelled shipments; costs are recorded commitments, not accounting entries.</p></div><div class="au-head"><h2>${esc(this.filter||'Active shipments')}</h2>${this.filter?btn('Show all active','filter',''):''}</div>${filtered.length?filtered.sort((a,b)=>b.dispatchDate.localeCompare(a.dispatchDate)).map(x=>this.shipment(s,x,false)).join(''):'<div class="au-empty">No shipments in this view.</div>'}`;
    },
    players(s){
      const q=this.query.toLowerCase(),players=Object.values(s.auraPlayers).filter(p=>(p.name+' '+p.phone+' '+p.instagram+' '+p.team).toLowerCase().includes(q));
      return `<input id="aura-search" class="au-search" aria-label="Search players" placeholder="Search name, phone, Instagram or team" value="${esc(this.query)}">${players.length?players.map(p=>{const ships=Object.values(s.auraShipments).filter(x=>x.playerId===p.id);return `<article class="au-card"><h2>${esc(p.name)} ${p.archived?'<span class="au-tag">Archived</span>':''}</h2><p>${esc(p.team)} · ${esc(p.phone)}</p><p>${link(p.instagram,'Instagram profile')}</p><p class="au-muted">${ships.length} shipments · ${money(ships.reduce((n,x)=>n+C.cost(x),0))} committed</p><div class="au-row">${btn('Open profile','player',p.id)}${!p.archived?btn('Dispatch products','dispatch',p.id,true):''}</div></article>`;}).join(''):'<div class="au-empty">No matching players. Add a player to begin.</div>'}`;
    },
    player(s){
      const p=s.auraPlayers[this.playerId];if(!p)return '<p>Player not found.</p>';
      const ships=Object.values(s.auraShipments).filter(x=>x.playerId===p.id).sort((a,b)=>b.dispatchDate.localeCompare(a.dispatchDate));
      return `<div class="au-card"><h2>${esc(p.name)}</h2><p>${esc(p.phone)} · ${esc(p.email)}</p><p>${esc(p.address)}</p><p>${link(p.instagram,'Instagram profile')} · ${esc(p.team)}</p><p>${esc(p.notes)}</p><div class="au-row">${btn('Edit profile','player-edit',p.id)}${btn(p.archived?'Restore player':'Archive player','archive',p.id)}${!p.archived?btn('Dispatch products','dispatch',p.id,true):''}</div></div><h2>Sponsorship history · ${ships.length} shipments</h2>${ships.map(x=>this.shipment(s,x,true)).join('')||'<div class="au-empty">No shipments yet.</div>'}<h2>Player activity</h2>${this.history(s,p.id)}`;
    },
    shipment(s,x,expanded){
      const p=s.auraPlayers[x.playerId],progress=C.progress(s,x.id),stage=C.stage(s,x),promos=C.collections&&Object.values(s.auraPromotions).filter(p=>p.shipmentId===x.id);
      return `<article class="au-card"><div class="au-head"><div><h3>${esc(p?.name||'Player')} · ${esc(x.dispatchDate)}</h3><p class="au-muted">Shipment ${esc(x.id.slice(0,8))} · ${esc(x.courier)} · ${esc(x.trackingNumber)}</p></div><div class="au-row"><span class="au-tag">${stage}</span>${x.exception?`<span class="au-alert">${esc(x.exception)}</span>`:''}</div></div><p>${x.items.map(i=>`${esc(i.name)}${i.variant?' ('+esc(i.variant)+')':''} × ${i.quantity}`).join(' · ')}</p><p>${link(x.trackingUrl,'Track parcel')} · ${money(C.cost(x))}</p><p class="au-muted">Expected: ${esc(x.expectedDelivery||'Not set')} · Delivered: ${esc(x.deliveredAt||'Awaiting confirmation')}</p>${x.exception?`<p class="au-alert">${esc(x.exceptionReason)}</p>`:''}<p><b>${progress.verified}/${progress.total}</b> required content verified · ${progress.submitted} submitted · ${progress.optional} optional</p><progress max="${Math.max(1,progress.total)}" value="${progress.verified}" aria-label="Verified content progress"></progress><div class="au-row">${!expanded?btn('Player & shipment details','player',x.playerId):''}${!x.deliveredAt&&!['cancelled','returned'].includes(x.exception)?btn('Confirm delivery','deliver',x.id,true):''}${btn('Follow up','followup',x.id)}${btn('Exception / resolve','exception',x.id)}</div>${expanded?`<details open><summary>Content obligations</summary>${promos.map(o=>`<div class="au-card"><h3>${esc(o.type)} <span class="au-tag">${o.required?'Required':'Optional'} · ${o.verifiedAt?'Verified':o.link?'Submitted':'Pending'}</span></h3><p>${esc(o.instructions)}</p><p class="au-muted">Due ${esc(o.dueDate||o.daysAfterDelivery+' days after delivery')}${o.publishedDate?' · Published '+esc(o.publishedDate):''}</p><p>${link(o.link,'View promotional content')}</p><div class="au-row">${x.deliveredAt&&!['cancelled','returned'].includes(x.exception)?(!o.verifiedAt?btn(o.link?'Update evidence':'Add promotion link','submit',o.id)+(o.link?btn('Verify content','verify',o.id,true):''):btn('Reopen verification','reopen',o.id)):''}</div></div>`).join('')}${btn('Add content obligation','obligation',x.id)}</details><details><summary>Delivery, costs & follow-ups</summary><p>Delivery address: ${esc(x.deliveryAddress)}</p><p>Confirmed by: ${esc(x.deliverySource||'Pending')} ${link(x.deliveryEvidence,'Delivery evidence')}</p><p>Products: ${money(x.items.reduce((n,i)=>n+i.quantity*i.unitCost,0))} · Courier: ${money(x.courierCost)} · Player fee: ${money(x.playerFee)} · Other: ${money(x.otherCost)}</p><p>${esc(x.costNotes)} ${esc(x.notes)}</p>${this.followups(s,x.id)}</details>`:''}</article>`;
    },
    followups(s,shipmentId){
      const list=Object.values(s.auraFollowUps).filter(f=>shipmentId?f.shipmentId===shipmentId:!f.completedAt).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
      return list.length?list.map(f=>`<div class="au-card"><h3>${esc(f.purpose)} · ${esc(s.auraPlayers[f.playerId]?.name)}</h3><p class="${!f.completedAt&&f.dueDate<today()?'au-alert':'au-muted'}">${esc(f.dueDate)} · ${f.completedAt?'Completed':f.dueDate<=today()?'Due':'Upcoming'}</p><p>${esc(f.notes)}</p><div class="au-row">${!f.completedAt?btn('Complete / log outcome','followup-complete',f.id)+btn('Reschedule','followup-edit',f.id):''}${btn('Player profile','player',f.playerId)}</div></div>`).join(''):'<p class="au-muted">No follow-ups in this view.</p>';
    },
    settings(s){const settings=s.auraSettings.default||C.defaults();return `<div class="au-card"><h2>Default promotional commitments</h2><p>Copied into each new shipment as individual content obligations. Changing defaults preserves existing agreements.</p>${settings.commitments.map(x=>`<p><b>${x.count} × ${esc(x.type)}</b> · ${x.required?'Required':'Optional'} · ${x.daysAfterDelivery} days after delivery<br><span class="au-muted">${esc(x.instructions)}</span></p>`).join('')}<p>Check delivery after ${settings.deliveryCheckDays} days when no expected date is set.</p>${btn('Configure commitments','settings-edit','',true)}</div>`;},
    history(s,playerId){
      const events=Object.values(s.auraHistory).filter(e=>!playerId||e.playerId===playerId).sort((a,b)=>b.at.localeCompare(a.at));
      return events.length?events.map(e=>`<div class="au-history"><b>${esc(activityNames[e.action]||e.action)}</b><p class="au-muted">${esc(new Date(e.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))} IST · ${esc(s.auraPlayers[e.playerId]?.name||'Sponsorship')} · Owner</p>${e.reason?`<p>${esc(e.reason)}</p>`:''}<details><summary>View complete change record</summary><pre>${esc(JSON.stringify(e.changes,null,2))}</pre></details></div>`).join(''):'<p class="au-muted">Activity will appear here after the first change.</p>';
    },
    async save(command){if(!this.allowed()||!this.store)throw new Error('Owner session required');await this.store.enqueue(command);},
    dialog(title,html,onSubmit,setup){
      document.getElementById('aura-dialog')?.remove();const d=document.createElement('dialog');d.id='aura-dialog';
      d.innerHTML=`<form><h2>${esc(title)}</h2>${html}<div class="au-error" role="alert" hidden></div><div class="au-actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">Save</button></div></form>`;document.body.append(d);
      d.querySelector('[data-cancel]').onclick=()=>{d.close();d.remove();this.render();};d.addEventListener('cancel',e=>{e.preventDefault();d.close();d.remove();this.render();});
      d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type=submit]');b.disabled=true;try{if(!this.allowed())throw new Error('Owner session ended');await onSubmit(new FormData(e.target),e.target);d.close();d.remove();this.render();}catch(error){const el=d.querySelector('[role=alert]');el.textContent=error.message;el.hidden=false;b.disabled=false;}};
      setup?.(d);d.showModal();return d;
    },
    download(backup,prefix='aura-backup'){const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=prefix+'-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),10000);},
    async action(action,id){
      if(!this.allowed())throw new Error('Owner access required');
      if(action==='signin')return this.signIn();if(action==='lock'){this.lock();this.render();return;}
      if(!this.store?.ready)throw new Error('Sponsorship storage is not ready');
      const s=this.store.state;
      if(action==='view'){this.view=id;this.render();return;}if(action==='filter'){this.filter=id;this.view='dashboard';this.render();return;}if(action==='player'){this.playerId=id;this.view='player';this.render();return;}
      if(action==='sync'){await this.store.retry();this.render();return;}
      if(action==='export'){this.download(this.store.export());return;}
      if(action==='resolve'){
        this.dialog('Resolve pending changes','<p>Pending changes are preserved until you choose otherwise. Download the recovery backup first. Using the cloud version discards all pending changes on this device; the file keeps them for manual recovery.</p><label>Type USE CLOUD to discard pending changes<input name="confirm" required></label>',async f=>{if(f.get('confirm')!=='USE CLOUD')throw new Error('Type USE CLOUD to continue');this.download(this.store.export(),'aura-pending-recovery');await this.store.discardPending();});return;
      }
      if(action==='import'){
        this.dialog('Restore AURA backup','<p>Only missing records are restored. Existing records and activity are never overwritten. Download a current backup before proceeding.</p><label>Backup JSON<input name="backup" type="file" accept="application/json,.json" required></label>',async f=>{const file=f.get('backup');if(file.size>25000000)throw new Error('Backup exceeds 25 MB');const backup=JSON.parse(await file.text());C.validateBackup(backup,this.store.uid);this.download(this.store.export(),'aura-before-restore');await this.store.restore(backup);});return;
      }
      if(action==='player-new'||action==='player-edit'){
        const p=s.auraPlayers[id]||{name:'',phone:'',email:'',address:'',instagram:'',team:'',notes:''};
        this.dialog(id?'Edit player':'Add player',`<div class="au-form-grid">${field('name','Player name',p.name,'text',true)}${field('phone','Phone / WhatsApp',p.phone,'tel')}${field('email','Email',p.email,'email')}${field('instagram','Instagram profile HTTPS link',p.instagram,'url')}${field('team','Team / academy',p.team)}${area('address','Shipping address',p.address)}${area('notes','Notes',p.notes)}</div>`,async f=>{const playerId=id||uid();await this.save({type:'player.save',id:playerId,data:Object.fromEntries(f)});this.playerId=playerId;this.view='player';});return;
      }
      if(action==='archive'){const p=s.auraPlayers[id];this.dialog(p.archived?'Restore player':'Archive player',`<p>${p.archived?'Allow new shipments again.':'Keep all sponsorship history and outstanding follow-ups. New shipments will be disabled.'}</p>`,()=>this.save({type:'player.archive',id,archived:!p.archived}));return;}
      if(action==='dispatch')return this.dispatchForm(s,id);
      if(action==='amend'){
        const ship=s.auraShipments[id];const amount=(name,label)=>`<label>${esc(label)} ₹<input name="${name}" type="number" min="0" step="0.01" value="${ship[name]/100}" required></label>`;
        this.dialog('Amend tracking and costs',`<div class="au-form-grid">${field('courier','Courier',ship.courier,'text',true)}${field('trackingNumber','Tracking number',ship.trackingNumber,'text',true)}${field('trackingUrl','Tracking HTTPS link',ship.trackingUrl,'url')}${field('expectedDelivery','Expected delivery',ship.expectedDelivery,'date')}${area('deliveryAddress','Delivery address',ship.deliveryAddress)}${amount('courierCost','Courier cost')}${amount('playerFee','Player fee')}${amount('otherCost','Other cost')}${area('costNotes','Cost notes',ship.costNotes)}${area('notes','Shipment notes',ship.notes)}${area('reason','Reason for correction')}</div>`,f=>{const data=Object.fromEntries(f);['courierCost','playerFee','otherCost'].forEach(k=>data[k]=Math.round(Number(data[k])*100));return this.save({type:'shipment.amend',id,data,reason:f.get('reason')});});return;
      }
      if(action==='deliver'){
        this.dialog('Confirm delivery',`${field('date','Delivery date',today(),'date',true)}${field('source','Confirmed by / confirmation source','','text',true)}${field('evidence','Delivery evidence HTTPS link (optional)','','url')}`,f=>this.save({type:'shipment.deliver',id,...Object.fromEntries(f)}));return;
      }
      if(action==='exception'){
        const x=s.auraShipments[id];this.dialog('Shipment exception',`${select('flag','Exception',C.flags.map(x=>[x,x||'Resolve / clear exception']),x.exception)}${area('reason','Reason / resolution',x.exceptionReason)}`,f=>this.save({type:'shipment.exception',id,...Object.fromEntries(f)}));return;
      }
      if(action==='submit'){const p=s.auraPromotions[id];this.dialog('Promotion evidence',`${field('link','Published content HTTPS link',p.link,'url',true)}${field('publishedDate','Publication date',p.publishedDate||today(),'date',true)}<p>Saving evidence does not verify it. Review the content and use Verify content next.</p>`,f=>this.save({type:'promotion.submit',id,...Object.fromEntries(f)}));return;}
      if(action==='verify'){const p=s.auraPromotions[id];this.dialog('Verify promotional content',`<p><b>${esc(p.type)}</b> · ${esc(p.instructions)}</p><p>${link(p.link,'Open content to review')}</p><label>Confirm content meets the agreed commitment<select name="confirm" required><option value="">Choose</option><option value="yes">I reviewed and approve this content</option></select></label>`,f=>{if(f.get('confirm')!=='yes')throw new Error('Review content first');return this.save({type:'promotion.verify',id});});return;}
      if(action==='reopen'){this.dialog('Reopen verification',area('reason','Why is verification being reopened?'),f=>this.save({type:'promotion.reopen',id,reason:f.get('reason')}));return;}
      if(action==='obligation'){
        this.dialog('Add content obligation',this.obligationFields(),f=>this.save({type:'promotion.add',id:uid(),shipmentId:id,data:this.readObligation(f)}));return;
      }
      if(action==='obligation-edit'){
        const p=s.auraPromotions[id];this.dialog('Edit content commitment',this.obligationFields(p)+area('reason','Reason for agreed change'),f=>this.save({type:'promotion.edit',id,data:this.readObligation(f),reason:f.get('reason')}));return;
      }
      if(action==='followup'||action==='followup-edit'){
        const f=action==='followup-edit'?s.auraFollowUps[id]:{shipmentId:id,purpose:'Promotion follow-up',dueDate:today(),notes:''};
        this.dialog('Schedule follow-up',`${field('purpose','Purpose',f.purpose,'text',true)}${field('dueDate','Due date',f.dueDate,'date',true)}${area('notes','Notes',f.notes)}`,data=>this.save({type:'followup.save',id:f.id||uid(),shipmentId:f.shipmentId,...Object.fromEntries(data)}));return;
      }
      if(action==='followup-complete'){this.dialog('Complete follow-up',area('notes','Outcome / contact notes'),f=>this.save({type:'followup.complete',id,notes:f.get('notes')}));return;}
      if(action==='settings-edit')return this.settingsForm(s);
    },
    obligationFields(p={type:'Instagram Reel',required:true,instructions:'',dueDate:'',daysAfterDelivery:7}){
      return `<div class="au-form-grid">${field('type','Content type',p.type,'text',true)}${select('required','Commitment',[['yes','Required'],['no','Optional']],p.required?'yes':'no')}${field('dueDate','Fixed deadline (optional)',p.dueDate,'date')}${field('daysAfterDelivery','Days after delivery if no fixed date',p.daysAfterDelivery,'number',true)}${area('instructions','Caption, mentions, tags & requirements',p.instructions)}</div>`;
    },
    readObligation(f){return {type:f.get('type'),required:f.get('required')==='yes',instructions:f.get('instructions'),dueDate:f.get('dueDate'),daysAfterDelivery:Number(f.get('daysAfterDelivery'))};},
    commitmentRow(c={type:'Instagram Story',count:1,required:true,instructions:'',daysAfterDelivery:7}){
      return `<div class="au-commit"><div class="au-form-grid">${field('type','Content type',c.type,'text',true)}${field('count','Number of individual pieces',c.count,'number',true)}${select('required','Commitment',[['yes','Required'],['no','Optional']],c.required?'yes':'no')}${field('daysAfterDelivery','Days after delivery',c.daysAfterDelivery,'number',true)}${area('instructions','Caption, mentions, tags & requirements',c.instructions)}</div><button type="button" data-remove>Remove commitment type</button></div>`;
    },
    readCommitments(form){return Array.from(form.querySelectorAll('.au-commit')).map(row=>{const v=n=>row.querySelector('[name="'+n+'"]').value;return {type:v('type'),count:Number(v('count')),required:v('required')==='yes',instructions:v('instructions'),daysAfterDelivery:Number(v('daysAfterDelivery'))};});},
    setupRows(d){d.addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b)b.closest('.au-commit,.au-line').remove();});},
    settingsForm(s){const settings=s.auraSettings.default||C.defaults();this.dialog('Configure default commitments',`${field('deliveryCheckDays','Delivery check after days',settings.deliveryCheckDays,'number',true)}<div id="aura-commitments">${settings.commitments.map(c=>this.commitmentRow(c)).join('')}</div><button type="button" data-add-commit>Add commitment type</button>`,(f,form)=>this.save({type:'settings.save',data:{deliveryCheckDays:Number(f.get('deliveryCheckDays')),commitments:this.readCommitments(form)}}),d=>{this.setupRows(d);d.querySelector('[data-add-commit]').onclick=()=>d.querySelector('#aura-commitments').insertAdjacentHTML('beforeend',this.commitmentRow());});},
    productRow(){return `<div class="au-line">${field('product','Product name','','text',true)}${field('variant','Variant / size')}${field('quantity','Quantity',1,'number',true)}<label>Unit cost ₹<input name="unitCost" type="number" min="0" step="0.01" value="0" required></label><button type="button" data-remove aria-label="Remove product">Remove</button></div>`;},
    dispatchForm(s,playerId){
      const p=s.auraPlayers[playerId],settings=s.auraSettings.default||C.defaults();
      const costField=(name,label)=>`<label>${label} ₹<input name="${name}" type="number" min="0" step="0.01" value="0" required></label>`;
      this.dialog('Dispatch sponsorship products',`<p>For <b>${esc(p.name)}</b>. Products and costs are saved independently from stock and accounting.</p><div class="au-form-grid">${field('dispatchDate','Dispatch date',today(),'date',true)}${field('expectedDelivery','Expected delivery','','date')}${field('courier','Courier','','text',true)}${field('trackingNumber','Tracking number','','text',true)}${field('trackingUrl','Tracking HTTPS link (optional)','','url',false,true)}${area('deliveryAddress','Delivery address',p.address)}</div><fieldset><legend>Products sent</legend><div id="aura-products">${this.productRow()}</div><button type="button" data-add-product>Add product</button></fieldset><fieldset><legend>Sponsorship costs · INR</legend><div class="au-form-grid">${costField('courierCost','Courier')}${costField('playerFee','Player fee')}${costField('otherCost','Other costs')}${area('costNotes','Cost notes')}</div></fieldset><fieldset><legend>Agreed content</legend><p>Each piece becomes an individual obligation. Customize this shipment without changing the defaults.</p><div id="aura-commitments">${settings.commitments.map(c=>this.commitmentRow(c)).join('')}</div><button type="button" data-add-commit>Add commitment type</button></fieldset>${area('notes','Shipment notes')}`,async(f,form)=>{
        const cents=value=>{const str=String(value);if(!/^\d+(\.\d{1,2})?$/.test(str))throw new Error('Costs must be positive amounts with at most two decimals');return Math.round(Number(str)*100);};
        const items=Array.from(form.querySelectorAll('.au-line')).map(row=>{const v=n=>row.querySelector('[name="'+n+'"]').value;return {name:v('product'),variant:v('variant'),quantity:Number(v('quantity')),unitCost:cents(v('unitCost'))};});
        const commitments=C.validateCommitments(this.readCommitments(form)),obligations=[];
        commitments.forEach(c=>{for(let i=0;i<c.count;i++)obligations.push({id:uid(),type:c.type+(c.count>1?' '+(i+1):''),required:c.required,instructions:c.instructions,daysAfterDelivery:c.daysAfterDelivery,dueDate:''});});
        const data=Object.fromEntries(f);['courierCost','playerFee','otherCost'].forEach(k=>data[k]=cents(data[k]));data.items=items;
        await this.save({type:'shipment.dispatch',id:uid(),playerId,data,obligations});this.playerId=playerId;this.view='player';
      },d=>{this.setupRows(d);d.querySelector('[data-add-product]').onclick=()=>d.querySelector('#aura-products').insertAdjacentHTML('beforeend',this.productRow());d.querySelector('[data-add-commit]').onclick=()=>d.querySelector('#aura-commitments').insertAdjacentHTML('beforeend',this.commitmentRow());});
    }
  };
  root.AuraUI=UI;
})(window);
