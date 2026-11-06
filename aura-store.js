(function(root) {
  'use strict';
  const C=root.AuraCore;
  const uuid=()=>crypto.randomUUID().replace(/-/g,'');
  class AuraStore {
    constructor({uid,db,indexedDB:factory=root.indexedDB,onChange=()=>{}}) {
      this.uid=uid;this.db=db;this.factory=factory;this.onChange=onChange;this.state=C.empty();this.queue=[];this.stops=[];this.ready=false;this.syncing=false;this.closed=false;this.message='Opening local storage…';
    }
    async open() {
      this.local=await new Promise((resolve,reject)=>{
        const r=this.factory.open('aura-sponsorship-v1',1);
        r.onupgradeneeded=()=>r.result.createObjectStore('owners');
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Close other AURA tabs to upgrade local storage'));
      });
      this.local.onversionchange=()=>this.close();
      await this.update(v=>v);this.ready=true;
      if(root.BroadcastChannel){this.channel=new root.BroadcastChannel('aura-sponsorship');this.channel.onmessage=()=>{if(!this.closed)this.refresh().then(()=>this.flush()).catch(e=>this.error(e));};}
      for(const col of C.collections) {
        this.stops.push(this.db.collection(col).onSnapshot(snap=>{
          if(this.closed||snap.metadata.hasPendingWrites)return;
          this.update(v=>{for(const change of snap.docChanges()){
            if(change.type==='removed')delete v.base[col][change.doc.id];
            else v.base[col][change.doc.id]=change.doc.data();
          }return v;}).catch(e=>this.error(e));
        },e=>this.error(e)));
      }
      this.online=()=>this.flush();root.addEventListener?.('online',this.online);
      this.timer=root.setInterval(()=>this.flush(),15000);await this.flush();return this;
    }
    error(e){this.message=e.message||String(e);this.onChange();}
    update(fn) {
      if(this.closed)return Promise.reject(new Error('Sponsorship session closed'));
      return new Promise((resolve,reject)=>{
        const tx=this.local.transaction('owners','readwrite'),store=tx.objectStore('owners'),r=store.get(this.uid);let value,failure;
        r.onsuccess=()=>{try{
          const current=r.result||{base:C.empty(),queue:[],initialized:false};
          value=fn(current)||current;store.put(value,this.uid);
        }catch(e){failure=e;tx.abort();}};
        tx.oncomplete=()=>{this.install(value);resolve(value);};
        tx.onabort=tx.onerror=()=>reject(failure||tx.error||new Error('Local save failed; change was not recorded'));
      });
    }
    install(v){if(this.closed)return;this.base=v.base;this.queue=v.queue;this.initialized=v.initialized;this.state=this.queue.reduce((s,op)=>C.apply(s,op),C.clone(v.base));this.onChange();}
    refresh(){return this.update(v=>v);}
    async enqueue(command){
      if(!this.ready||this.closed)throw new Error('Local storage is not ready');
      if(!this.initialized)throw new Error('Connect once and load cloud data before making changes');
      if(this.queue.some(x=>x.error))throw new Error('Resolve the pending sync error first');
      await this.update(v=>{
        if(v.queue.some(x=>x.error))throw new Error('Resolve the pending sync error first');
        const state=v.queue.reduce((s,op)=>C.apply(s,op),C.clone(v.base));
        const op=C.plan(state,command,this.uid,new Date().toISOString(),uuid());
        if(new TextEncoder().encode(JSON.stringify(op.event)).length>700000)throw new Error('Action too large; reduce products or notes');
        v.queue.push(op);return v;
      });
      this.message='Saved on this device; pending cloud confirmation';this.channel?.postMessage('changed');this.onChange();this.flush();
    }
    async bootstrap(){
      // A complete server read is required before a first offline edit or restore.
      const results=await Promise.all(C.collections.map(async c=>[c,await this.db.collection(c).get({source:'server'})]));
      await this.update(v=>{for(const [c,snap] of results){v.base[c]={};snap.forEach(doc=>v.base[c][doc.id]=doc.data());}v.initialized=true;return v;});
    }
    flush(){
      if(this.flushPromise)return this.flushPromise;
      this.flushPromise=this.performFlush().finally(()=>{this.flushPromise=null;});
      return this.flushPromise;
    }
    async performFlush(){
      if(this.closed||this.syncing||!this.ready||root.navigator?.onLine===false)return;
      this.syncing=true;
      try {
        if(!this.initialized)await this.bootstrap();
        await this.refresh();
        while(this.queue.length&&!this.closed){
          const op=this.queue[0];if(op.error){this.message=op.error;break;}
          await this.db.runTransaction(async tx=>{
            const eventRef=this.db.collection('auraHistory').doc(op.id), event=await tx.get(eventRef);
            if(event.exists)return; // Idempotent retry after an ambiguous network response.
            const refs=op.writes.map(w=>this.db.collection(w.collection).doc(w.id));
            const current=await Promise.all(refs.map(ref=>tx.get(ref)));
            op.writes.forEach((w,i)=>{if((current[i].exists?current[i].data().rev:0)!==w.expectedRev){const e=new Error('Conflict: another device changed this record. Export pending work before choosing the cloud version.');e.code='aura/conflict';throw e;}});
            op.writes.forEach((w,i)=>tx.set(refs[i],w.record));
            tx.set(eventRef,{...op.event,serverAt:root.firebase.firestore.FieldValue.serverTimestamp()});
          });
          await this.update(v=>{
            // Another tab may already have acknowledged the same operation.
            for(const w of op.writes){if((v.base[w.collection][w.id]?.rev||0)<=w.record.rev)v.base[w.collection][w.id]=w.record;}
            v.base.auraHistory[op.id]=op.event;v.queue=v.queue.filter(x=>x.id!==op.id);return v;
          });
          this.channel?.postMessage('changed');
        }
        if(!this.queue.length)this.message='All sponsorship changes saved to cloud';
      }catch(e){
        if(this.closed)return;
        this.message=e.message;
        if(e.code==='aura/conflict'||e.code==='permission-denied')await this.update(v=>{if(v.queue[0])v.queue[0].error=e.message;return v;});
      }finally{this.syncing=false;if(!this.closed)this.onChange();}
    }
    async retry(){await this.update(v=>{v.queue.forEach(x=>delete x.error);return v;});return this.flush();}
    export(){return C.backup(this.state,this.queue,this.uid,new Date().toISOString());}
    async discardPending(){
      if(this.syncing)throw new Error('Wait for the current cloud request to finish');
      // Caller must download a recovery backup and explicitly confirm first.
      await this.bootstrap();await this.update(v=>{v.queue=[];return v;});this.channel?.postMessage('changed');
    }
    async restore(backup){
      if(this.syncing||this.queue.length)throw new Error('Sync or export and resolve pending changes before restoring');
      const imported=C.validateBackup(backup,this.uid);await this.bootstrap();
      await this.update(v=>{
        if(v.queue.length)throw new Error('Another tab has pending changes');
        const writes=[];
        for(const c of C.collections)for(const [id,r] of Object.entries(imported[c])){
          const old=v.base[c][id];
          if(old){if(c==='auraHistory'){
            const clean=x=>{const y=C.clone(x);delete y.serverAt;return y;};
            if(JSON.stringify(clean(old))!==JSON.stringify(clean(r)))throw new Error('History ID collision; restore requires an unchanged original history');
          }else {
            const normalize=x=>{const y=C.clone(x);delete y.lastOperation;return y;};
            if(JSON.stringify(normalize(old))!==JSON.stringify(normalize(r)))throw new Error('Restore collision: '+c+'/'+id+'. Existing records are never overwritten.');
          }}
          else writes.push({collection:c,id,expectedRev:0,record:r});
        }
        if(!writes.length)throw new Error('All backup records already exist');
        // Single transaction: never a partially applied backup. Large backups
        // require an administrative recovery tool rather than silent truncation.
        if(writes.length>150)throw new Error('Backup has over 150 missing records; use the documented administrative recovery process');
        const operationId=uuid(),now=new Date().toISOString();
        const event={id:operationId,ownerUid:this.uid,actor:this.uid,action:'backup.restore',playerId:'',shipmentId:'',at:now,createdAt:now,updatedAt:now,rev:1,
          changes:[],reason:'Restored '+writes.length+' missing records from '+backup.exportedAt};
        writes.forEach(w=>{if(w.collection!=='auraHistory')w.record={...w.record,lastOperation:operationId};});
        v.queue.push({id:operationId,actor:this.uid,createdAt:now,writes,event});return v;
      });this.channel?.postMessage('changed');await this.flush();
    }
    close(){this.closed=true;this.ready=false;this.stops.forEach(stop=>stop());this.stops=[];root.clearInterval(this.timer);root.removeEventListener?.('online',this.online);this.channel?.close();this.local?.close();this.state=C.empty();this.queue=[];}
  }
  root.AuraStore=AuraStore;
  if(typeof module==='object'&&module.exports)module.exports=AuraStore;
})(typeof globalThis!=='undefined'?globalThis:this);
