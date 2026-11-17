/* Disabled means no SDK loads, listeners, auth changes or data writes. */
(function(){
  'use strict';
  const config=window.AURA_CONFIG;
  if(!config?.enabled)return;
  let started=false;
  function script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('Unable to load sponsorship component'));document.head.append(s);});}
  async function start(){
    if(started)return;started=true;
    try{
      const style=document.createElement('link');style.rel='stylesheet';style.href='/aura.css?v=2';document.head.append(style);
      await script('/aura-ui.js?v=2');
      window.AuraUI.mount(config);
    }catch(e){started=false;alert('AURA could not open: '+e.message);}
  }
  const nav=document.createElement('button');nav.className='sb-item';nav.id='n-aura';nav.type='button';nav.textContent='🏏 AURA Sponsorship';nav.onclick=()=>{start().then(()=>{if(window.AuraUI)go('aura');});};
  document.getElementById('sb').append(nav);
  window.AuraModule={open:()=>{start().then(()=>{if(window.AuraUI)go('aura');});},render:()=>{start().then(()=>window.AuraUI?.render());},roleChanged:()=>{
    const allowed=typeof window.auraCanAccess==='function'&&window.auraCanAccess()&&document.getElementById('login-screen')?.style.display==='none';
    nav.hidden=!allowed;nav.style.display=allowed?'':'none';if(!allowed)window.AuraUI?.lock();
  }};
  window.AuraModule.roleChanged();
  if(typeof currentPerson!=='undefined'&&currentPerson==='Juhi'&&document.getElementById('login-screen')?.style.display==='none')window.AuraModule.open();
  // The existing login is synchronous. Observe its overlay as well as explicit
  // role hooks so cached AURA data disappears immediately on logout.
  const login=document.getElementById('login-screen');if(login)new MutationObserver(()=>window.AuraModule.roleChanged()).observe(login,{attributes:true,attributeFilter:['style']});
})();
