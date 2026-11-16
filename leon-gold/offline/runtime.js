/* Offline stand-in for window.claude: the same db / user / downloads / assets calls the app makes,
   kept in this browser's IndexedDB. Built into leon-gold-offline.html by build.ps1; never published. */
(function(){
  // «#view»: «حساب من» shows one invoice on this exact sheet (index.html viewMode()); no ledger data, no sign-in, no worker
  var VIEW=location.hash==='#view';
  var DBN='leon-gold-offline',docs={},blobs={},urls={},subs={},idb=null,n=0;
  var clone=function(o){return JSON.parse(JSON.stringify(o))};
  // v2 adds the sync outbox (changes not yet on the server) and meta (sync settings)
  function open(){return new Promise(function(res,rej){var r=indexedDB.open(DBN,2);
    r.onupgradeneeded=function(){var d=r.result;['docs','blobs','outbox','meta'].forEach(function(s){if(!d.objectStoreNames.contains(s))d.createObjectStore(s)})};
    r.onblocked=function(){alert('دفتر لئون در یک پنجره‌ی دیگر هم باز است. آن پنجره را ببندید تا این یکی باز شود.')};
    r.onsuccess=function(){var d=r.result;d.onversionchange=function(){d.close();location.reload()};res(d)};r.onerror=function(){rej(r.error)}})}
  function all(st){return new Promise(function(res,rej){var t=idb.transaction(st),s=t.objectStore(st),out={};
    s.openCursor().onsuccess=function(e){var c=e.target.result;if(c){out[c.key]=c.value;c.continue()}else res(out)};t.onerror=function(){rej(t.error)}})}
  function write(st,key,val){return new Promise(function(res,rej){var t=idb.transaction(st,'readwrite'),s=t.objectStore(st);
    if(val===undefined)s.delete(key);else s.put(val,key);t.oncomplete=function(){res()};t.onerror=function(){rej(t.error)}})}
  var obox={},S={};
  var ready=open().then(function(d){idb=d;return Promise.all([all('docs'),all('blobs'),all('outbox'),all('meta')])}).then(function(r){
    Object.keys(r[0]).forEach(function(k){var i=k.indexOf('/'),c=k.slice(0,i);(docs[c]=docs[c]||{})[k.slice(i+1)]=r[0][k]});blobs=r[1];obox=r[2];S=r[3].sync||{}});
  function emit(c){(subs[c]||[]).forEach(function(f){var m=docs[c]||{};
    f({docs:Object.keys(m).map(function(id){return {id:id,data:function(){return clone(m[id])}}})})})}
  // remote: the change came from the server, so it is neither queued nor announced one by one
  function put(c,id,d,remote){if(d===undefined){if(docs[c])delete docs[c][id]}else (docs[c]=docs[c]||{})[id]=d;
    if(!remote)setTimeout(function(){emit(c)});
    var w=write('docs',c+'/'+id,d);if(remote||!S.on)return w;
    return Promise.all([w,queue('d/'+c+'/'+id,{c:c,id:id,d:d===undefined?null:d})]).then(function(){soon()})}
  var db={collection:function(c){return {
    doc:function(id){id=id||('off'+Date.now().toString(36)+(++n)+Math.random().toString(36).slice(2,6));return {id:id,
      set:function(d){return put(c,id,clone(d))},
      update:function(d){var cur=docs[c]&&docs[c][id];if(!cur)return Promise.reject({code:'not_found'});return put(c,id,Object.assign(clone(cur),clone(d)))},
      delete:function(){return put(c,id,undefined)}}},
    onSnapshot:function(f){(subs[c]=subs[c]||[]).push(f);setTimeout(function(){emit(c)});return function(){subs[c]=subs[c].filter(function(x){return x!==f})}}}}};
  var user={me:async function(){return {id:'local',name:'مالک',avatarUrl:'',isOwner:true}},can:async function(){return true}};
  function saveAs(name,blob){var a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},60000)}
  var downloads={save:async function(o){var b=o.data instanceof Blob?o.data:new Blob([o.data]);
    // «#view» on a phone: the share sheet saves to Files or sends it on; elsewhere (or if sharing is refused) a plain download
    if(VIEW){var fl=new File([b],o.filename,{type:b.type||'application/pdf'});if(navigator.canShare&&navigator.canShare({files:[fl]})){try{await navigator.share({files:[fl]});return}catch(e){if(e&&e.name==='AbortError')throw {code:'declined'}}}}
    saveAs(o.filename,b)}};
  var assets={upload:async function(b,o){var id='p'+Date.now().toString(36)+(++n),bl=new Blob([b],{type:(o&&o.type)||b.type||'image/jpeg'});
    blobs[id]=bl;await write('blobs',id,bl);if(S.on){await queue('b/'+id,{b:id});soon()}return {id:id}}};

  /* ---------- sync with leon-gold-server ----------
     Every change is saved here first and queued in the outbox; when online the outbox goes to the server
     and everyone else's changes come back. A doc with a change still waiting here is never overwritten by
     the server's older copy. The last change to reach the server wins. */
  var SYNC_URL='__SYNC_URL__'.indexOf('__')===0?'':'__SYNC_URL__',busy=false,again=false,timer=0,state='off',lastErr='';
  var qn=0;function queue(k,v){v.q=Date.now()+'.'+(++qn);obox[k]=v;return write('outbox',k,v)}
  function saveS(){return write('meta','sync',S)}
  function soon(){clearTimeout(timer);timer=setTimeout(syncNow,800)}
  function setState(s,e){state=s;lastErr=e||'';if(window.__leonSyncPaint)window.__leonSyncPaint()}
  async function api(p,o){o=o||{};var h=o.headers||{};if(S.token)h.Authorization='Bearer '+S.token;
    if(o.json!==undefined){h['Content-Type']='application/json';o.body=JSON.stringify(o.json)}
    var r=await fetch(S.url.replace(/\/+$/,'')+p,{method:o.method||'GET',headers:h,body:o.body,cache:'no-store'});
    if(r.status===401){var e=new Error('login');e.login=true;throw e}
    if(!r.ok){var e2=new Error('server '+r.status);try{e2.body=await r.json()}catch(x){}throw e2}
    return o.raw?r:r.json()}
  var pend=[];
  async function syncNow(){
    // a sync asked for while one runs waits for the next full run (so «now» always means fresh data)
    if(!S.on)return;if(busy){again=true;return new Promise(function(r){pend.push(r)})}busy=true;setState('busy');
    var touched={};
    try{
      // 1. send what is waiting here
      var keys=Object.keys(obox),dk=keys.filter(function(k){return k[0]==='d'});
      for(var i=0;i<dk.length;i+=300){var part=dk.slice(i,i+300),sent=part.map(function(k){return obox[k]});
        await api('/api/push',{method:'POST',json:{changes:sent.map(function(v){return {c:v.c,id:v.id,d:v.d}})}});
        for(var j=0;j<part.length;j++)if(obox[part[j]]&&obox[part[j]].q===sent[j].q){delete obox[part[j]];await write('outbox',part[j],undefined)}}
      // a blob the server refuses (too large) must not stop the push/pull below from running for everything else
      var bk=keys.filter(function(k){return k[0]==='b'});
      for(i=0;i<bk.length;i++){var bid=obox[bk[i]].b;
        try{if(blobs[bid])await api('/api/blob/'+encodeURIComponent(bid),{method:'PUT',headers:{'Content-Type':blobs[bid].type||'image/jpeg'},body:blobs[bid]});
          delete obox[bk[i]];await write('outbox',bk[i],undefined)}catch(e){if(e.login)throw e}}
      // 2. bring back everything after the last number this device saw
      var more=true;
      while(more){var r=await api('/api/pull?since='+(S.rev||0));
        for(i=0;i<r.changes.length;i++){var ch=r.changes[i];if(obox['d/'+ch.c+'/'+ch.id])continue;
          var cur=docs[ch.c]&&docs[ch.c][ch.id];if(JSON.stringify(cur===undefined?null:cur)===JSON.stringify(ch.d))continue;
          await put(ch.c,ch.id,ch.d===null?undefined:ch.d,true);touched[ch.c]=1}
        // the server lists a photo only in the pull that first carries it, so one that failed to download is kept in S.miss and retried
        var want=(S.miss||[]).concat(r.blobs),miss=[];
        for(i=0;i<want.length;i++){var id=want[i];if(blobs[id]||miss.indexOf(id)>-1)continue;
          try{var bl=await (await api('/api/blob/'+encodeURIComponent(id),{raw:true})).blob();blobs[id]=bl;await write('blobs',id,bl);touched.products=1}
          catch(e){if(e.login)throw e;if(!/ 404$/.test(e.message))miss.push(id)}}
        S.miss=miss;S.rev=r.rev;more=r.more;await saveS()}
      S.at=new Date().toISOString();await saveS();setState('ok')
    }catch(e){setState(e.login?'login':navigator.onLine===false?'wait':'err',String(e.message||e))}
    // pages already applied stay on screen even when a later page or the connection fails
    Object.keys(touched).forEach(emit);
    busy=false;var ws=pend;pend=[];if(again){again=false;syncNow().then(function(){ws.forEach(function(f){f()})})}else ws.forEach(function(f){f()})}
  function count(){var t=0;for(var c in docs)t+=Object.keys(docs[c]).length;return t}
  // first connection: an empty server takes this device's data; otherwise this device takes the server's (after saving a backup file)
  async function connect(url,u,p){
    S={url:url.trim().replace(/\/+$/,''),rev:0};
    var r=await api('/api/login',{method:'POST',json:{u:u,p:p,device:navigator.platform+' '+(navigator.maxTouchPoints?'touch':'')}});
    S.token=r.token;S.user=r.user;S.owner=!!r.isOwner;var st=await api('/api/state');
    if(!st.docs){for(var c in docs)for(var id in docs[c])await queue('d/'+c+'/'+id,{c:c,id:id,d:docs[c][id]});
      for(var b in blobs)await queue('b/'+b,{b:b})}
    else if(count()){
      if(!confirm('روی سرور '+Number(st.docs).toLocaleString('fa-IR')+' مورد اطلاعات هست.\nاطلاعات این دستگاه با اطلاعات سرور جایگزین می‌شود؛ قبلش یک فایل پشتیبان از همین دستگاه دانلود می‌شود.\n\nادامه می‌دهی؟')){S={};return false}
      await exportAll();
      for(c in docs)for(id in docs[c])await put(c,id,undefined,true);
      for(c in subs)emit(c)}
    S.on=true;await saveS();await syncNow();watch();return true}
  // an expired login (a new password, or 180 days) signs in again and keeps the outbox and the data as they are
  async function relogin(u,p){
    var r=await api('/api/login',{method:'POST',json:{u:u,p:p,device:navigator.platform+' '+(navigator.maxTouchPoints?'touch':'')}});
    S.token=r.token;S.user=r.user;S.owner=!!r.isOwner;await saveS();await syncNow();watch();return true}
  async function disconnect(){try{if(S.token)await api('/api/logout',{method:'POST',json:{}})}catch(e){}
    for(var k in obox)await write('outbox',k,undefined);obox={};S={};await saveS();setState('off')}
  setInterval(function(){if(S.on&&document.visibilityState==='visible')syncNow()},20000);
  // (owner, 2026-11-09) always listening: one request stays open at the server and is answered the moment anything is saved
  // (a new order from «حساب من», another user's invoice), then the ledger syncs at once. A server without /api/wait: every 5 s.
  var watching=false,noWait=false;
  async function watch(){if(watching||!S.on||!S.token||document.visibilityState!=='visible')return;watching=true;var pause=150;
    try{if(noWait){await syncNow();pause=5000}else{var r=await api('/api/wait?since='+(S.rev||0));if(r&&r.rev>(S.rev||0)){await syncNow();if(state!=='ok')pause=5000}}}
    catch(e){if(e&&/ 404$/.test(e.message||'')){noWait=true;pause=0}else pause=e&&e.login?60000:4000}
    finally{watching=false;setTimeout(watch,pause)}}
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')watch()});
  addEventListener('online',function(){watch()});
  // a notification arrived (sw.js tells the open ledger): sync now
  if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',function(e){if(e.data&&e.data.leonSync&&S.on)syncNow()});
  addEventListener('online',function(){if(S.on)syncNow()});
  document.addEventListener('visibilitychange',function(){if(S.on&&document.visibilityState==='visible')syncNow()});
  // the server moved to the owner's own domain (Liara's free *.liara.run address lasts 7 days): a device still holding
  // the old address follows this build's one, with the same sign-in (same server, same data)
  ready.then(function(){if(S.url&&SYNC_URL&&S.url!==SYNC_URL&&/^https:\/\/[\w-]+\.liara\.run$/.test(S.url)){S.url=SYNC_URL;saveS()}
    if(S.on){syncNow();watch()}else setState('off')});
  window.__leonSync={now:syncNow,connect:connect,relogin:relogin,disconnect:disconnect,ready:ready,api:api,
    // only the owner can sign in to the server now, so a device holding a token is the owner's (old tokens never carried the flag)
    info:function(){return {on:!!S.on,url:S.url||SYNC_URL,user:S.user||'',owner:!!S.token,at:S.at||'',state:state,err:lastErr,waiting:Object.keys(obox).length}}};
  var NOPHOTO='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#f5f0e3"/><text x="120" y="88" font-family="Tahoma" font-size="16" fill="#9c7433" text-anchor="middle">عکس آفلاین موجود نیست</text></svg>');
  window.__leonBlobURL=function(id){if(!blobs[id])return NOPHOTO;return urls[id]=urls[id]||URL.createObjectURL(blobs[id])};
  window.claude={use:async function(name){await ready;return name==='db'?db:name==='user'?user:name==='downloads'?downloads:name==='assets'?assets:null}};

  /* whole-store export/import, also accepts the app's own «پشتیبان کامل» file */
  function b64(blob){return new Promise(function(r){var f=new FileReader();f.onload=function(){r(f.result)};f.readAsDataURL(blob)})}
  async function exportAll(){await ready;var ph={};for(var k in blobs)ph[k]=await b64(blobs[k]);
    var d=new Date(),day=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    saveAs('leon-gold-offline-'+day+'.json',new Blob([JSON.stringify({app:'leon-gold-offline',format:1,at:d.toISOString(),docs:docs,photos:ph})],{type:'application/json'}))}
  /* the app's «پشتیبان کامل» reads product photos through this (id -> data URL) */
  window.__leonPhotos=async function(){await ready;var ph={};for(var k in blobs)ph[k]=await b64(blobs[k]);return ph};
  var COLS=['parties','invoices','settlements','products','orders','targets','expenses','vitrin','prices','settings','log'];
  var CNAME={parties:'طرف‌حساب',invoices:'فاکتور',settlements:'سند تسویه',products:'کالا',orders:'سفارش',targets:'تارگت',expenses:'هزینه',prices:'قیمت روزانه',settings:'تنظیمات',log:'سابقه'};
  // a full file (offline export, or «پشتیبان کامل» format 3+) replaces everything; an old format-2 file replaces only what it holds
  async function importAll(file){var j;try{j=JSON.parse(await file.text())}catch(e){alert('این فایل JSON معتبر نیست.');return}
    var col={};
    if(j&&j.app==='leon-gold-offline'&&j.docs)col=j.docs;
    else if(j&&j.app==='leon-gold'){COLS.forEach(function(c){
      if(Array.isArray(j[c])){col[c]={};j[c].forEach(function(o){var x=clone(o),id=x.id;delete x.id;if(id)col[c][id]=x})}})}
    else{alert('این فایل پشتیبان لئون گلد نیست.');return}
    var full=j.app==='leon-gold-offline'||(+j.format||0)>=3,np=j.photos?Object.keys(j.photos).length:0;
    var fa=function(n){return Number(n).toLocaleString('fa-IR')};
    var cnt=Object.keys(col).filter(function(c){return Object.keys(col[c]).length}).map(function(c){return '• '+fa(Object.keys(col[c]).length)+' '+(CNAME[c]||c)}).join('\n')+(np?'\n• '+fa(np)+' عکس کالا':'');
    var when=j.at?new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(j.at)):'';
    if(!confirm('بازگردانی پشتیبان'+(when?' '+when:'')+':\n'+cnt+'\n\n'+(full?'همه‌ی اطلاعات این دستگاه با این فایل جایگزین می‌شود.':'این فایل پشتیبان قدیمی است و فقط همین بخش‌ها را دارد؛ فقط همین‌ها جایگزین می‌شوند و بقیه دست نمی‌خورد.')+'\n\nادامه می‌دهی؟'))return;
    await ready;
    // only ledger collections are ever cleared; a backup never touches other apps' data sharing this sync (the CRM panel's crm_*)
    for(var c in docs)if(COLS.indexOf(c)>-1&&(full||col[c]))for(var id in docs[c])await put(c,id,undefined);
    for(c in col)for(id in col[c])await put(c,id,col[c][id]);
    if(j.photos)for(var k in j.photos){try{var bl=await (await fetch(j.photos[k])).blob();blobs[k]=bl;await write('blobs',k,bl);if(S.on)await queue('b/'+k,{b:k})}catch(e){}}
    alert('بازگردانی انجام شد.');location.reload()}
  function badge(){document.title+=' · آفلاین';var t=document.createElement('meta');t.name='apple-mobile-web-app-title';t.content='لئون گلد';document.head.appendChild(t);var b=document.createElement('div');b.id='offBadge';
    b.style.cssText='position:fixed;left:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px));z-index:99999;font:12px Vazirmatn,Tahoma,sans-serif;direction:rtl;letter-spacing:0';
    b.innerHTML='<button type="button" style="all:unset;cursor:pointer;background:#0a1f15;color:#f3ead0;border:1px solid #c59a50;border-radius:14px;padding:4px 10px">آفلاین ▾</button>'+
      '<div hidden style="margin-top:6px;background:#fff;color:#12241b;border:1px solid #d9c9a0;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.2);overflow:hidden">'+
      '<button type="button" data-o="sync" style="all:unset;display:block;padding:10px 14px;cursor:pointer">همگام‌سازی با سرور</button>'+
      '<button type="button" data-o="exp" style="all:unset;display:block;padding:10px 14px;cursor:pointer;border-top:1px solid #eee">خروجی کامل آفلاین</button>'+
      '<button type="button" data-o="imp" style="all:unset;display:block;padding:10px 14px;cursor:pointer;border-top:1px solid #eee">ورود اطلاعات از فایل</button>'+
      '<div style="padding:6px 14px;border-top:1px solid #eee;color:#6a7468;font-size:11px">نسخه __BUILD__</div></div>'+
      '<input type="file" accept="application/json,.json" hidden>';
    var st=document.createElement('style');st.textContent='body:not(.noact) #offBadge,body.menu #offBadge,body:has(.modal) #offBadge,body:has(#lgSync) #offBadge{display:none}';document.head.appendChild(st);
    var m=b.children[1],inp=b.children[2];
    b.children[0].onclick=function(){m.hidden=!m.hidden};
    m.onclick=function(e){var o=e.target.getAttribute('data-o');m.hidden=true;if(o==='exp')exportAll();if(o==='imp')inp.click();if(o==='sync')syncPanel()};
    inp.onchange=function(){if(inp.files[0])importAll(inp.files[0]);inp.value=''};
    window.__leonImportPick=function(){inp.click()};
    window.__leonImport=importAll;  // tests restore a file without the picker
    var LBL={off:'آفلاین',busy:'↻ همگام‌سازی',ok:'● همگام',wait:'○ بدون اینترنت',err:'! خطای همگام‌سازی',login:'! ورود دوباره'};
    window.__leonSyncPaint=function(){var i=window.__leonSync.info();b.children[0].textContent=LBL[i.state]+' ▾';
      b.children[0].style.color=i.state==='ok'?'#9fe0b0':i.state==='err'||i.state==='login'?'#f2b8a0':'#f3ead0';
      if(window.__leonSyncPanelPaint)window.__leonSyncPanelPaint()};
    window.__leonSyncPaint();
    document.body.appendChild(b)}
  function syncPanel(){
    var fa=function(x){return Number(x).toLocaleString('fa-IR')},esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return '&#'+c.charCodeAt(0)+';'})};
    var w=document.createElement('div');w.id='lgSync';
    w.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(6,20,14,.55);display:flex;align-items:flex-end;justify-content:center;font:15px Vazirmatn,Tahoma,sans-serif;direction:rtl;letter-spacing:0';
    var inS='display:block;width:100%;box-sizing:border-box;margin:4px 0 10px;padding:11px 12px;border:1px solid #d9c9a0;border-radius:10px;font:16px Vazirmatn,Tahoma,sans-serif;background:#fffdf7;color:#12241b';
    var btS='all:unset;box-sizing:border-box;text-align:center;cursor:pointer;padding:12px 16px;border-radius:12px;font-weight:700';
    function paint(){var i=window.__leonSync.info();
      var when=i.at?new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(i.at)):'';
      var st={off:'وصل نیست',busy:'در حال همگام‌سازی…',ok:'همگام است',wait:'اینترنت نیست؛ تغییرها روی همین دستگاه می‌مانند و بعداً فرستاده می‌شوند',err:'سرور جواب نداد',login:'ورود منقضی شده؛ دوباره وارد شوید'}[i.state];
      box.innerHTML='<h3 style="margin:0 0 6px;font-size:18px">همگام‌سازی با سرور</h3>'+
        '<p style="margin:0 0 12px;color:#4a5a50;font-size:13px;line-height:1.8">اطلاعات همه‌ی دستگاه‌ها روی یک سرور نگه داشته می‌شود و هر تغییر خودکار به بقیه می‌رسد. بدون اینترنت هم کار می‌کند.</p>'+
        (i.on
          ?'<div style="background:#f5f0e3;border-radius:10px;padding:10px 12px;line-height:2;font-size:14px">وضعیت: <b>'+st+'</b><br>کاربر: '+esc(i.user)+(when?'<br>آخرین همگام‌سازی: '+when:'')+(i.waiting?'<br>در صف ارسال: '+fa(i.waiting):'')+'</div>'+
            (i.state==='login'
              ?'<div style="margin-top:12px"><label style="font-size:13px">نام کاربری<input id="syN" autocapitalize="off" style="'+inS+'" value="'+esc(i.user)+'"></label>'+
                '<label style="font-size:13px">رمز<input id="syP" type="password" autocapitalize="off" style="'+inS+'"></label>'+
                '<p id="syE" style="color:#8a3b22;font-size:13px;margin:0 0 8px;min-height:1em"></p>'+
                '<button data-s="re" style="'+btS+';display:block;width:100%;background:#0d3a2a;color:#f3ead0">ورود دوباره</button></div>'
              :'')+
            '<div style="display:flex;gap:8px;margin-top:14px">'+(i.state==='login'?'':'<button data-s="now" style="'+btS+';flex:1;background:#0d3a2a;color:#f3ead0">همگام‌سازی الان</button>')+
            '<button data-s="off" style="'+btS+';background:#fff;color:#8a3b22;border:1px solid #e2c3b5">قطع اتصال</button></div>'
          :'<label style="font-size:13px">آدرس سرور<input id="syU" dir="ltr" inputmode="url" autocapitalize="off" style="'+inS+'" value="'+esc(i.url)+'" placeholder="https://…"></label>'+
            '<label style="font-size:13px">نام کاربری<input id="syN" autocapitalize="off" style="'+inS+'"></label>'+
            '<label style="font-size:13px">رمز<input id="syP" type="password" autocapitalize="off" style="'+inS+'"></label>'+
            '<p id="syE" style="color:#8a3b22;font-size:13px;margin:0 0 8px;min-height:1em"></p>'+
            '<button data-s="go" style="'+btS+';display:block;width:100%;background:#0d3a2a;color:#f3ead0">اتصال</button>')+
        '<button data-s="x" style="'+btS+';display:block;width:100%;margin-top:8px;color:#4a5a50">بستن</button>'}
    var box=document.createElement('div');
    box.style.cssText='background:#fffdf7;color:#12241b;width:100%;max-width:440px;box-sizing:border-box;border-radius:18px 18px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));border-top:2px solid #c59a50';
    w.appendChild(box);document.body.appendChild(w);paint();
    window.__leonSyncPanelPaint=function(){if(!box.querySelector('input'))paint()};
    var close=function(){w.remove();window.__leonSyncPanelPaint=null};
    w.onclick=async function(e){if(e.target===w)return close();var s=e.target.getAttribute('data-s');if(!s)return;
      if(s==='x')return close();
      if(s==='now')return window.__leonSync.now();
      if(s==='off'){var wt=window.__leonSync.info().waiting;
        if(confirm('این دستگاه از سرور جدا شود؟ اطلاعات روی همین دستگاه می‌ماند.'+(wt?'\n\n'+fa(wt)+' تغییر هنوز به سرور نرسیده و دیگر فرستاده نمی‌شود. اگر ورود منقضی شده، به‌جای قطع اتصال «ورود دوباره» را بزنید.':'')))await window.__leonSync.disconnect();return paint()}
      if(s==='re'){var rn=box.querySelector('#syN').value,rp=box.querySelector('#syP').value,re=box.querySelector('#syE');
        if(!rn||!rp){re.textContent='نام کاربری و رمز را بنویسید.';return}
        e.target.textContent='در حال ورود…';
        try{await window.__leonSync.relogin(rn,rp);return paint()}
        catch(x){re.textContent=x.login?'نام کاربری یا رمز درست نیست.':'به سرور وصل نشد. اینترنت را بررسی کنید.';e.target.textContent='ورود دوباره'}}
      if(s==='go'){var u=box.querySelector('#syU').value,nm=box.querySelector('#syN').value,p=box.querySelector('#syP').value,er=box.querySelector('#syE');
        if(!/^https?:\/\/\S+$/.test(u.trim())||!nm||!p){er.textContent='آدرس سرور، نام کاربری و رمز را بنویسید.';return}
        e.target.textContent='در حال اتصال…';
        try{var ok=await window.__leonSync.connect(u,nm,p);if(ok===false)return paint();paint()}
        catch(x){er.textContent=x.login?'نام کاربری یا رمز درست نیست.':'به سرور وصل نشد. آدرس و اینترنت را بررسی کنید.';e.target.textContent='اتصال'}}}}
  if(!VIEW){if(document.body)badge();else document.addEventListener('DOMContentLoaded',badge)}
  /* installed on a phone (served over https): keep the app available offline */
  if(!VIEW&&/^https?:$/.test(location.protocol)&&'serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(function(){});
  if(!VIEW&&navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(function(){});
})();
