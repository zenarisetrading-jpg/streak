// One-time import of a records backup (the JSON from the old app's /api/records).
const KEY_PATTERN=/^(?:day:\d{4}-\d{2}-\d{2}|meal:\d{4}-\d{2}-\d{2}:[\w-]{1,80})$/;
const MAX_FILE_BYTES=5*1024*1024;
const status=document.getElementById('import-status');
const showAccount=email=>{document.getElementById('account').textContent='Signed in as '+email};
window.addEventListener('tracker-user',event=>showAccount(event.detail));
if(window.trackerUser)showAccount(window.trackerUser);

function backupRows(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('This file is not a Streak backup.');
 const rows=Object.entries(data).filter(([key,value])=>KEY_PATTERN.test(key)&&value&&typeof value==='object'&&!Array.isArray(value)).map(([key,value])=>({key,value}));
 if(!rows.length)throw Error('No check-ins or meals found in this file.');
 return rows;
}

document.getElementById('import-file').addEventListener('change',async event=>{
 const file=event.target.files[0];event.target.value='';
 if(!file)return;
 try{
  if(file.size>MAX_FILE_BYTES)throw Error('That file is too large to be a backup.');
  const rows=backupRows(JSON.parse(await file.text()));
  status.textContent='Importing '+rows.length+' entries…';
  await window.trackerImport(rows);
  status.textContent='Imported '+rows.length+' entries. Anything already saved here was kept.';
 }catch(error){status.textContent=error instanceof SyntaxError?'This file is not valid JSON.':error.message}
});
