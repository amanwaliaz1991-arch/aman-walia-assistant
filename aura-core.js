/* Pure domain model. No dependency on the host app or Firebase. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AuraCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const collections = ['auraPlayers', 'auraShipments', 'auraPromotions', 'auraFollowUps', 'auraSettings', 'auraHistory'];
  const flags = ['', 'delayed', 'returned', 'cancelled', 'disputed'];
  const clone = x => JSON.parse(JSON.stringify(x));
  const empty = () => Object.fromEntries(collections.map(c => [c, {}]));
  function requireThat(ok, message) { if (!ok) throw new Error(message); }
  function text(v, name, max = 2000, required = false) {
    requireThat(typeof v === 'string' && v.length <= max && (!required || v.trim()), 'Invalid ' + name);
    return v.trim();
  }
  function date(v, name, required = false) {
    requireThat(typeof v === 'string' && ((!v && !required) || /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) === v), 'Invalid ' + name);
    return v;
  }
  function integer(v, name, min = 0, max = 100000000) {
    requireThat(Number.isSafeInteger(v) && v >= min && v <= max, 'Invalid ' + name); return v;
  }
  function id(v) { requireThat(typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v) && !['__proto__','prototype','constructor'].includes(v), 'Invalid record ID'); return v; }
  function url(v, required = false) {
    text(v, 'link', 2048, required);
    if (!v) return '';
    let u; try { u = new URL(v); } catch (_) { throw new Error('Enter a complete https:// link'); }
    requireThat(u.protocol === 'https:' && !u.username && !u.password, 'Use an HTTPS link without credentials');
    return u.href;
  }
  function day(now) { return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(now)); }
  function addDays(ds, days) { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10); }
  function obligations(s, shipmentId) { return Object.values(s.auraPromotions).filter(p => p.shipmentId === shipmentId); }
  function progress(s, shipmentId) {
    const all = obligations(s, shipmentId), required = all.filter(p => p.required);
    return {verified: required.filter(p => p.verifiedAt).length, total: required.length,
      submitted: required.filter(p => p.link).length, optional: all.filter(p => !p.required).length};
  }
  function stage(s, shipment) {
    const p = progress(s, shipment.id);
    return shipment.deliveredAt ? (p.total > 0 && p.verified === p.total ? 'Promoted' : 'Delivered') : 'Dispatched';
  }
  function cost(shipment) {
    return shipment.items.reduce((n, i) => n + i.quantity * i.unitCost, 0) + shipment.courierCost + shipment.playerFee + shipment.otherCost;
  }
  function dashboard(s, today) {
    const active = Object.values(s.auraShipments).filter(x => !['cancelled','returned'].includes(x.exception));
    return {deliveries:active.filter(x => stage(s,x)==='Dispatched'), promotions:active.filter(x=>stage(s,x)==='Delivered'),
      completed:active.filter(x=>stage(s,x)==='Promoted'), exceptions:Object.values(s.auraShipments).filter(x=>x.exception),
      followUps:Object.values(s.auraFollowUps).filter(x=>!x.completedAt && x.dueDate<=today),
      totalCost:Object.values(s.auraShipments).reduce((n,x)=>n+cost(x),0)};
  }
  const defaults = () => ({id:'default', commitments:[{type:'Instagram Reel', count:1, required:true, instructions:'Tag @AURA and include the product', daysAfterDelivery:7}], deliveryCheckDays:5});
  function validateCommitments(list) {
    requireThat(Array.isArray(list) && list.length > 0 && list.length <= 20, 'Add 1–20 commitment types');
    return list.map(x=>({type:text(x.type,'content type',80,true), count:integer(x.count,'content count',1,20), required:!!x.required,
      instructions:text(x.instructions,'instructions',2000), daysAfterDelivery:integer(x.daysAfterDelivery,'promotion days',0,365)}));
  }
  function plan(s, command, actor, now, operationId) {
    id(actor); id(operationId); requireThat(!Number.isNaN(Date.parse(now)), 'Invalid timestamp');
    const cmd = clone(command), writes = [], before = [];
    const get = (col, key) => { id(key); const v=s[col][key]; requireThat(v, 'Record no longer exists'); return clone(v); };
    const put = (col, value) => {
      id(value.id); const old=s[col][value.id];
      requireThat(!writes.some(x=>x.collection===col&&x.id===value.id),'Duplicate write');
      const record={...value, rev:(old?.rev||0)+1, createdAt:old?.createdAt||now, updatedAt:now, ownerUid:actor,lastOperation:operationId};
      writes.push({collection:col,id:record.id,expectedRev:old?.rev||0,record}); before.push({collection:col,id:record.id,record:old||null});
      return record;
    };
    let playerId='', shipmentId='';
    function playerFields(p) {
      return {name:text(p.name,'player name',120,true), phone:text(p.phone,'phone',60), email:text(p.email,'email',200),
        address:text(p.address,'address',2000), instagram:url(p.instagram), team:text(p.team,'team',200), notes:text(p.notes,'notes',4000)};
    }
    function promotion(p) {
      requireThat(typeof p.required==='boolean','Choose required or optional');
      return {type:text(p.type,'content type',80,true), required:p.required, instructions:text(p.instructions,'instructions',2000),
        dueDate:date(p.dueDate,'promotion deadline'), daysAfterDelivery:integer(p.daysAfterDelivery||0,'promotion days',0,365)};
    }
    switch(cmd.type) {
      case 'player.save': {
        const old=s.auraPlayers[cmd.id]; playerId=id(cmd.id);
        put('auraPlayers',{...(old||{}),id:cmd.id,...playerFields(cmd.data), archived:old?.archived||false}); break;
      }
      case 'player.archive': {
        const p=get('auraPlayers',cmd.id); playerId=p.id; put('auraPlayers',{...p,archived:!!cmd.archived}); break;
      }
      case 'settings.save': {
        put('auraSettings',{id:'default',commitments:validateCommitments(cmd.data.commitments),deliveryCheckDays:integer(cmd.data.deliveryCheckDays,'delivery check days',1,90)}); break;
      }
      case 'shipment.dispatch': {
        const p=get('auraPlayers',cmd.playerId); requireThat(!p.archived,'Restore the archived player first'); playerId=p.id; shipmentId=id(cmd.id);
        requireThat(!s.auraShipments[shipmentId],'Shipment already exists');
        const d=cmd.data; date(d.dispatchDate,'dispatch date',true); requireThat(d.dispatchDate<=day(now),'Dispatch date cannot be in the future');
        requireThat(Array.isArray(d.items)&&d.items.length>0&&d.items.length<=100,'Add 1–100 products');
        const items=d.items.map(x=>({name:text(x.name,'product',200,true),variant:text(x.variant,'variant',100),quantity:integer(x.quantity,'quantity',1,10000),unitCost:integer(x.unitCost,'unit cost',0,100000000)}));
        const expectedDelivery=date(d.expectedDelivery,'expected delivery'); requireThat(!expectedDelivery||expectedDelivery>=d.dispatchDate,'Expected delivery precedes dispatch');
        const ship={id:shipmentId,playerId:p.id,dispatchDate:d.dispatchDate,items,courier:text(d.courier,'courier',100,true),trackingNumber:text(d.trackingNumber,'tracking number',200,true),trackingUrl:url(d.trackingUrl),
          expectedDelivery,deliveryAddress:text(d.deliveryAddress,'delivery address',2000,true),courierCost:integer(d.courierCost,'courier cost'),playerFee:integer(d.playerFee,'player fee'),otherCost:integer(d.otherCost,'other cost'),
          costNotes:text(d.costNotes,'cost notes',2000),notes:text(d.notes,'notes',4000),currency:'INR',deliveredAt:'',deliverySource:'',deliveryEvidence:'',exception:'',exceptionReason:''};
        requireThat(Number.isSafeInteger(cost(ship))&&cost(ship)<=10000000000,'Shipment cost is too large'); put('auraShipments',ship);
        requireThat(Array.isArray(cmd.obligations)&&cmd.obligations.length>0&&cmd.obligations.length<=100,'Add 1–100 individual content obligations');
        requireThat(cmd.obligations.some(x=>x.required),'At least one required content obligation is needed');
        cmd.obligations.forEach(x=>{id(x.id);requireThat(!s.auraPromotions[x.id],'Content ID already exists');put('auraPromotions',{...promotion(x),id:x.id,shipmentId,playerId,link:'',publishedDate:'',verifiedAt:'',verifiedBy:''});});
        put('auraFollowUps',{id:operationId+'_delivery',playerId,shipmentId,purpose:'Check delivery',dueDate:expectedDelivery||addDays(d.dispatchDate,(s.auraSettings.default||defaults()).deliveryCheckDays),notes:'',completedAt:'',kind:'delivery'}); break;
      }
      case 'shipment.deliver': {
        const ship=get('auraShipments',cmd.id); playerId=ship.playerId; shipmentId=ship.id;
        requireThat(!ship.deliveredAt,'Delivery is already confirmed'); requireThat(!['cancelled','returned'].includes(ship.exception),'Resolve the shipment exception first');
        const deliveredAt=date(cmd.date,'delivery date',true); requireThat(deliveredAt>=ship.dispatchDate&&deliveredAt<=day(now),'Delivery must be between dispatch and today');
        put('auraShipments',{...ship,deliveredAt,deliverySource:text(cmd.source,'confirmation source',500,true),deliveryEvidence:url(cmd.evidence)});
        const ps=obligations(s,ship.id);
        ps.forEach(p=>{if(!p.dueDate)put('auraPromotions',{...p,dueDate:addDays(deliveredAt,p.daysAfterDelivery)});});
        Object.values(s.auraFollowUps).filter(f=>f.shipmentId===ship.id&&f.kind==='delivery'&&!f.completedAt).forEach(f=>put('auraFollowUps',{...f,completedAt:now}));
        const required=ps.filter(p=>p.required); const due=required.map(p=>p.dueDate||addDays(deliveredAt,p.daysAfterDelivery)).sort()[0];
        put('auraFollowUps',{id:operationId+'_promotion',playerId,shipmentId,purpose:'Follow up on promotional content',dueDate:due,notes:'',completedAt:'',kind:'promotion'}); break;
      }
      case 'shipment.exception': {
        const ship=get('auraShipments',cmd.id); playerId=ship.playerId; shipmentId=ship.id;
        requireThat(flags.includes(cmd.flag),'Unknown exception'); put('auraShipments',{...ship,exception:cmd.flag,exceptionReason:text(cmd.reason,'exception reason',2000,true)}); break;
      }
      case 'shipment.amend': {
        const ship=get('auraShipments',cmd.id);playerId=ship.playerId;shipmentId=ship.id;const d=cmd.data;
        text(cmd.reason,'correction reason',2000,true);const expectedDelivery=date(d.expectedDelivery,'expected delivery');
        requireThat(!expectedDelivery||expectedDelivery>=ship.dispatchDate,'Expected delivery precedes dispatch');
        const updated={...ship,courier:text(d.courier,'courier',100,true),trackingNumber:text(d.trackingNumber,'tracking number',200,true),trackingUrl:url(d.trackingUrl),
          expectedDelivery,deliveryAddress:text(d.deliveryAddress,'address',2000,true),courierCost:integer(d.courierCost,'courier cost'),playerFee:integer(d.playerFee,'player fee'),otherCost:integer(d.otherCost,'other cost'),costNotes:text(d.costNotes,'cost notes',2000),notes:text(d.notes,'shipment notes',4000)};
        put('auraShipments',updated);
        if(!ship.deliveredAt&&expectedDelivery&&expectedDelivery!==ship.expectedDelivery)Object.values(s.auraFollowUps).filter(f=>f.shipmentId===ship.id&&f.kind==='delivery'&&!f.completedAt).forEach(f=>put('auraFollowUps',{...f,dueDate:expectedDelivery}));
        break;
      }
      case 'promotion.add': {
        const ship=get('auraShipments',cmd.shipmentId); playerId=ship.playerId; shipmentId=ship.id;
        requireThat(!s.auraPromotions[cmd.id],'Content ID already exists');requireThat(obligations(s,ship.id).length<100,'Maximum 100 content obligations');
        const p=promotion(cmd.data); if(ship.deliveredAt&&!p.dueDate)p.dueDate=addDays(ship.deliveredAt,p.daysAfterDelivery);
        put('auraPromotions',{...p,id:cmd.id,playerId,shipmentId,link:'',publishedDate:'',verifiedAt:'',verifiedBy:''});
        if(ship.deliveredAt&&p.required)put('auraFollowUps',{id:operationId+'_promotion',playerId,shipmentId,purpose:'Follow up on added content obligation',dueDate:p.dueDate,notes:'',completedAt:'',kind:'promotion'});
        break;
      }
      case 'promotion.edit': {
        const p=get('auraPromotions',cmd.id),ship=get('auraShipments',p.shipmentId);playerId=p.playerId;shipmentId=p.shipmentId;
        requireThat(!p.verifiedAt,'Reopen verified content before changing commitments');text(cmd.reason,'commitment change reason',2000,true);
        const fields=promotion(cmd.data);requireThat(fields.required||obligations(s,ship.id).some(x=>x.id!==p.id&&x.required),'At least one required content obligation is needed');
        if(ship.deliveredAt&&!fields.dueDate)fields.dueDate=addDays(ship.deliveredAt,fields.daysAfterDelivery);
        put('auraPromotions',{...p,...fields});break;
      }
      case 'promotion.submit': case 'promotion.verify': case 'promotion.reopen': {
        const p=get('auraPromotions',cmd.id), ship=get('auraShipments',p.shipmentId); playerId=p.playerId; shipmentId=p.shipmentId;
        requireThat(ship.deliveredAt,'Confirm delivery before recording promotion'); requireThat(!['cancelled','returned'].includes(ship.exception),'Resolve the shipment exception first');
        if(cmd.type==='promotion.reopen') { requireThat(p.verifiedAt,'Content is not verified'); text(cmd.reason,'reopen reason',2000,true); put('auraPromotions',{...p,verifiedAt:'',verifiedBy:''});
          if(p.required)put('auraFollowUps',{id:operationId+'_promotion',playerId,shipmentId,purpose:'Review reopened promotional content',dueDate:p.dueDate||day(now),notes:cmd.reason,completedAt:'',kind:'promotion'});
        }
        else if(cmd.type==='promotion.submit') {
          requireThat(!p.verifiedAt,'Reopen verified content before changing evidence');
          const publishedDate=date(cmd.publishedDate,'publication date',true);requireThat(publishedDate>=ship.deliveredAt&&publishedDate<=day(now),'Publication must be between delivery and today');
          put('auraPromotions',{...p,link:url(cmd.link,true),publishedDate});
        } else {
          requireThat(p.link&&p.publishedDate,'Add promotion evidence before verifying'); requireThat(!p.verifiedAt,'Content is already verified');
          put('auraPromotions',{...p,verifiedAt:now,verifiedBy:actor});
          const remaining=obligations(s,ship.id).filter(x=>x.required&&x.id!==p.id&&!x.verifiedAt);
          if(!remaining.length)Object.values(s.auraFollowUps).filter(f=>f.shipmentId===ship.id&&f.kind==='promotion'&&!f.completedAt).forEach(f=>put('auraFollowUps',{...f,completedAt:now}));
        }
        break;
      }
      case 'followup.save': {
        const ship=get('auraShipments',cmd.shipmentId);playerId=ship.playerId;shipmentId=ship.id;
        const old=s.auraFollowUps[cmd.id]; requireThat(!old||old.shipmentId===ship.id,'Wrong shipment');
        put('auraFollowUps',{...(old||{}),id:cmd.id,playerId,shipmentId,purpose:text(cmd.purpose,'follow-up purpose',300,true),dueDate:date(cmd.dueDate,'follow-up date',true),notes:text(cmd.notes,'follow-up notes',2000),completedAt:'',kind:old?.kind||'manual'});break;
      }
      case 'followup.complete': {
        const f=get('auraFollowUps',cmd.id);playerId=f.playerId;shipmentId=f.shipmentId; requireThat(!f.completedAt,'Follow-up already completed');put('auraFollowUps',{...f,completedAt:now,notes:text(cmd.notes,'follow-up outcome',2000,true)});break;
      }
      default: throw new Error('Unknown sponsorship action');
    }
    requireThat(writes.length<=150,'Too many changes in one action');
    const event={id:operationId,ownerUid:actor,action:cmd.type,playerId,shipmentId,actor,at:now,reason:cmd.reason||'',
      changes:writes.map((w,i)=>({collection:w.collection,id:w.id,before:before[i].record,after:w.record})),rev:1,createdAt:now,updatedAt:now};
    return {id:operationId,actor,createdAt:now,command:cmd,writes,event};
  }
  function apply(s, op) { const next=clone(s); op.writes.forEach(w=>next[w.collection][w.id]=clone(w.record));next.auraHistory[op.id]=clone(op.event);return next; }
  function backup(s, outbox, ownerUid, now) { return {format:'aura-sponsorship',schemaVersion:1,ownerUid,exportedAt:now,collections:clone(s),pendingOperations:clone(outbox)}; }
  function validateBackup(b, ownerUid) {
    requireThat(b&&b.format==='aura-sponsorship'&&b.schemaVersion===1&&b.ownerUid===ownerUid,'Wrong backup format, version or owner');
    requireThat(b.collections&&collections.every(c=>b.collections[c]&&typeof b.collections[c]==='object'&&!Array.isArray(b.collections[c])),'Incomplete backup');
    const s=clone(b.collections); let count=0;
    for(const c of collections)for(const [key,r] of Object.entries(s[c])) {
      id(key);requireThat(r&&r.id===key&&r.ownerUid===ownerUid,'Invalid backup record owner or ID');integer(r.rev,'record revision',1);count++;
      requireThat(new TextEncoder().encode(JSON.stringify(r)).length<700000,'Backup record too large');
      requireThat(typeof r.createdAt==='string'&&!Number.isNaN(Date.parse(r.createdAt))&&typeof r.updatedAt==='string'&&!Number.isNaN(Date.parse(r.updatedAt)),'Invalid record timestamps');
    }
    requireThat(count<=20000,'Backup too large');
    for(const p of Object.values(s.auraPlayers)){text(p.name,'player name',120,true);['phone','email','address','team','notes'].forEach(k=>text(p[k],k,4000));url(p.instagram);requireThat(typeof p.archived==='boolean','Invalid archive state');}
    for(const settings of Object.values(s.auraSettings)){requireThat(settings.id==='default','Invalid settings ID');validateCommitments(settings.commitments);integer(settings.deliveryCheckDays,'delivery check days',1,90);}
    for(const ship of Object.values(s.auraShipments)){requireThat(s.auraPlayers[ship.playerId],'Orphaned shipment');requireThat(Array.isArray(ship.items)&&ship.items.length>0,'Invalid shipment items');ship.items.forEach(x=>{text(x.name,'product',200,true);integer(x.quantity,'quantity',1,10000);integer(x.unitCost,'unit cost');});[ship.courierCost,ship.playerFee,ship.otherCost].forEach(x=>integer(x,'cost'));date(ship.dispatchDate,'dispatch date',true);date(ship.deliveredAt,'delivery date');requireThat(!ship.deliveredAt||ship.deliveredAt>=ship.dispatchDate,'Invalid delivery chronology');requireThat(flags.includes(ship.exception),'Invalid exception');url(ship.trackingUrl);url(ship.deliveryEvidence);requireThat(ship.currency==='INR','Unsupported currency');requireThat(Number.isSafeInteger(cost(ship))&&cost(ship)<=10000000000,'Invalid cost');}
    for(const p of Object.values(s.auraPromotions)){const ship=s.auraShipments[p.shipmentId];requireThat(ship&&ship.playerId===p.playerId,'Orphaned obligation');url(p.link);date(p.dueDate,'deadline');date(p.publishedDate,'publication date');requireThat(typeof p.required==='boolean','Invalid required flag');text(p.type,'content type',80,true);text(p.instructions,'instructions',2000);integer(p.daysAfterDelivery,'promotion days',0,365);requireThat(!p.verifiedAt||p.link&&ship.deliveredAt&&p.publishedDate&&p.verifiedBy===ownerUid,'Invalid verification');}
    for(const ship of Object.values(s.auraShipments))requireThat(obligations(s,ship.id).some(p=>p.required),'Shipment missing required obligations');
    for(const f of Object.values(s.auraFollowUps)){requireThat(s.auraShipments[f.shipmentId]?.playerId===f.playerId,'Orphaned follow-up');date(f.dueDate,'follow-up date',true);}
    requireThat(Array.isArray(b.pendingOperations),'Invalid pending operations');
    for(const e of Object.values(s.auraHistory)){requireThat(e.actor===ownerUid&&typeof e.action==='string'&&Array.isArray(e.changes)&&typeof e.at==='string'&&!Number.isNaN(Date.parse(e.at)),'Invalid history event');}
    // Restore uses the materialized snapshot. Outbox is preserved in the exported
    // file for recovery, never executed as untrusted imported commands.
    return s;
  }
  return {collections,flags,empty,clone,plan,apply,stage,progress,cost,dashboard,defaults,validateCommitments,day,addDays,backup,validateBackup,url};
});
