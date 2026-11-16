(() => {
 const dayKey='daily-check-in-v1', mealKey='daily-check-in-meals-v1', settingsKey='daily-check-in-settings-v1', healthKey='daily-check-in-health-v1', workoutKey='daily-check-in-workouts-v1';
 const queueKey='check-in-pending-v1', ownerKey='check-in-owner-v1';
 const read=(key,fallback={})=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
 const write=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
 let running=false, again=false, owner=null, etag=null;
 // Fired once per load, as soon as the first sync has finished one way or the other. An empty
 // cache means "nothing yet" only after this: before it, it only means the download is still in
 // flight, and anything that treats a signed-in person as a new one must wait for it.
 let settled=false;
 const ready=()=>{if(settled)return;settled=true;window.dispatchEvent(new Event('tracker-ready'))};
 const status=message=>{document.getElementById('sync-status').textContent=message};
 // Cloudflare Access answers an expired session with a redirect to its sign-in page.
 const signedOut=response=>response.type==='opaqueredirect'||response.status===401||response.status===403;
 class SignedOut extends Error{}
 function askToSignIn(){
  const box=document.getElementById('sync-status'), button=document.createElement('button');
  button.type='button';button.className='btn btn--ghost';button.textContent='Sign in again';button.onclick=()=>location.reload();
  box.replaceChildren('Your sign-in has expired. Entries are kept on this device. ',button);
 }
 // Each person signs in separately. Queued changes carry the account they were made under
 // (null while this page has not yet confirmed who is signed in, which means the current person).
 // If a different person signs in on this browser, the previous person's changes are parked for
 // them and the cache starts clean.
 async function checkOwner(){
  const response=await fetch('/api/me',{cache:'no-store',redirect:'manual'});
  if(signedOut(response))throw new SignedOut();
  if(!response.ok)throw Error('Not signed in');
  const {email}=await response.json();
  const previous=localStorage.getItem(ownerKey);
  if(previous&&previous!==email){
   const pending=read(queueKey), theirs={}, mine=read(queueKey+':'+email);
   for(const [key,entry] of Object.entries(pending)){
    if(entry.owner===null||entry.owner===email)mine[key]={...entry,owner:email};
    else theirs[key]=entry;
   }
   if(Object.keys(theirs).length)write(queueKey+':'+previous,{...read(queueKey+':'+previous),...theirs});
   write(dayKey,{});write(mealKey,{});write(settingsKey,{});write(healthKey,{});write(workoutKey,{});write(queueKey,mine);
   localStorage.removeItem(queueKey+':'+email);
   etag=null;
   window.dispatchEvent(new Event('tracker-synced'));
  }
  localStorage.setItem(ownerKey,email);
  owner=email;
  window.trackerUser=email;
  window.dispatchEvent(new CustomEvent('tracker-user',{detail:email}));
 }
 // Reload into a newer deploy, but never while someone is typing or reviewing a meal.
 const loadedVersion=document.querySelector('meta[name="app-version"]')?.content;
 function checkVersion(serverVersion){
  if(!serverVersion||!loadedVersion||serverVersion===loadedVersion)return;
  const busy=document.getElementById('meal-text')?.value.trim()||document.getElementById('workout-text')?.value.trim()||!document.getElementById('save-meal')?.disabled||!document.getElementById('save-workout')?.disabled||document.activeElement?.matches('input,textarea,select');
  if(busy)status('A new version is ready. It will load when you finish this entry.');
  else location.reload();
 }
 // Sends queued rows. A batch the server refuses as invalid is retried row by row, and rows that
 // can never be accepted are returned so they stop blocking every later sync.
 async function post(rows){
  const response=await fetch('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rows),redirect:'manual'});
  if(signedOut(response))throw new SignedOut();
  return response;
 }
 const permanent=response=>response.status===400||response.status===413;
 async function push(rows){
  const rejected=[];
  while(rows.length){
   const batch=rows.splice(0,30), response=await post(batch);
   if(response.ok)continue;
   if(!permanent(response))throw Error('Sync rejected');
   for(const row of batch){
    const single=await post([row]);
    if(!single.ok&&permanent(single)){rejected.push(row.key);console.error('Dropped a record the server will not accept:',row.key)}
    else if(!single.ok)throw Error('Sync rejected');
   }
  }
  return rejected;
 }
 async function sync(){
  if(running){again=true;return}
  running=true;
  try{
   if(!owner)await checkOwner();
   const pending=read(queueKey);
   const rejected=await push(Object.entries(pending).map(([key,entry])=>({key,value:entry.value})));
   // The server answers 304 when nothing changed since the last download (one cheap row read).
   const response=await fetch('/api/records',{cache:'no-store',redirect:'manual',headers:etag?{'If-None-Match':etag}:{}});
   if(signedOut(response))throw new SignedOut();
   if(!response.ok&&response.status!==304)throw Error('Could not download records');
   checkVersion(response.headers.get('x-app-version'));
   const remaining=read(queueKey);
   for(const [key,entry] of Object.entries(pending))if(remaining[key]?.id===entry.id)delete remaining[key];
   if(response.status===304){
    write(queueKey,remaining);
    status(rejected.length?'Some changes could not be saved and were dropped.':Object.keys(remaining).length?'Syncing…':'Synced across devices');
    return;
   }
   const records=await response.json();
   etag=response.headers.get('etag');
   for(const [key,entry] of Object.entries(remaining))records[key]=entry.value;
   const days={}, meals={}, health={}, workouts={};let settings={};
   for(const [key,value] of Object.entries(records)){
    if(value===null)continue;
    if(key==='settings:profile'){settings=value;continue}
    if(key.startsWith('health:')){health[key.slice(7)]=value;continue}
    const [type,date]=key.split(':');
    if(type==='day')days[date]=value;
    else if(type==='workout')(workouts[date]??=[]).push(value);
    else (meals[date]??=[]).push(value);
   }
   const changed=JSON.stringify(read(dayKey))!==JSON.stringify(days)||JSON.stringify(read(mealKey))!==JSON.stringify(meals)||JSON.stringify(read(settingsKey))!==JSON.stringify(settings)||JSON.stringify(read(healthKey))!==JSON.stringify(health)||JSON.stringify(read(workoutKey))!==JSON.stringify(workouts);
   write(dayKey,days);write(mealKey,meals);write(settingsKey,settings);write(healthKey,health);write(workoutKey,workouts);write(queueKey,remaining);
   if(changed)window.dispatchEvent(new Event('tracker-synced'));
   status(rejected.length?'Some changes could not be saved and were dropped.':Object.keys(remaining).length?'Syncing…':'Synced across devices');
  }catch(error){if(error instanceof SignedOut)askToSignIn();else status('Sync unavailable · local entries kept · will retry')}
  finally{running=false;ready();if(again){again=false;void sync()}}
 }
 window.trackerWrite=(key,value)=>{
  const pending=read(queueKey);
  pending[key]={id:crypto.randomUUID(),value,owner};write(queueKey,pending);
  status('Syncing…');void sync();
 };
 // Adds records from a backup without overwriting anything already saved.
 window.trackerImport=async rows=>{await push(rows.map(({key,value})=>({key,value,importOnly:true})));await sync()};
 window.addEventListener('online',sync);
 window.addEventListener('pageshow',sync);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync()});
 setInterval(()=>{if(!document.hidden)void sync()},20000);
})();
