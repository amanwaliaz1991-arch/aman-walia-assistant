/* AURA storage adapter: keeps each AURA collection as one JSON document in
   aman_assistant/<collection> (same place as the rest of the app's data), so
   no separate Google sign-in is needed. Mimics the small Firestore API used by AuraStore. */
(function(root){
  'use strict';
  const BASE='aman_assistant';
  const parse=d=>{try{return d&&d.exists?(JSON.parse(d.data().data||'{}')||{}):{};}catch(e){return {};}};
  const docSnap=(id,v)=>({id,exists:v!==undefined,data:()=>v});
  const clean=v=>JSON.parse(JSON.stringify(v,(k,x)=>(k==='serverAt'&&typeof x!=='string')?new Date().toISOString():x));
  class AuraDocDB{
    constructor(fs){this.fs=fs;}
    ref(col){return this.fs.collection(BASE).doc(col);}
    collection(col){
      const self=this;
      return {
        doc:id=>({__col:col,__id:id}),
        async get(){const m=parse(await self.ref(col).get({source:'server'}).catch(()=>self.ref(col).get()));return {forEach:fn=>Object.entries(m).forEach(([id,v])=>fn(docSnap(id,v)))};},
        onSnapshot(cb,err){
          let prev={};
          return self.ref(col).onSnapshot({includeMetadataChanges:false},snap=>{
            const m=parse(snap),changes=[];
            for(const [id,v] of Object.entries(m))if(JSON.stringify(prev[id])!==JSON.stringify(v))changes.push({type:prev[id]?'modified':'added',doc:docSnap(id,v)});
            for(const id of Object.keys(prev))if(!(id in m))changes.push({type:'removed',doc:docSnap(id,undefined)});
            prev=m;cb({metadata:{hasPendingWrites:snap.metadata.hasPendingWrites},docChanges:()=>changes});
          },err);
        }
      };
    }
    runTransaction(fn){
      return this.fs.runTransaction(async rtx=>{
        const maps={},touched=new Set();
        const load=async col=>{if(!(col in maps))maps[col]=parse(await rtx.get(this.ref(col)));return maps[col];};
        const tx={
          get:async r=>{const m=await load(r.__col);return docSnap(r.__id,m[r.__id]);},
          set:(r,v)=>{if(!(r.__col in maps))throw new Error('AURA: read before write');maps[r.__col][r.__id]=clean(v);touched.add(r.__col);}
        };
        const out=await fn(tx);
        for(const col of touched){const s=JSON.stringify(maps[col]);if(s.length>950000)throw new Error('AURA '+col+' is too large to save; export a backup and contact support');rtx.set(this.ref(col),{data:s,updatedAt:new Date().toISOString()});}
        return out;
      });
    }
  }
  root.AuraDocDB=AuraDocDB;
})(typeof globalThis!=='undefined'?globalThis:this);
