import {estimate,energy,totals} from './nutrition.mjs';
import {groupMeals,loggedHour,kindForHour,typeOf,typeOfEntry} from './meal-sections.mjs';
import {renderEditor,cleanItems} from './meal-editor.mjs';
import {preparePhoto,analyzePhoto,estimateText} from './photo.mjs';
import {recentMeals,scaleItems,shortLabel} from './recent.mjs';
import {splitBatch,shareFactor,shareLabel} from './batch.mjs';
import {fmt} from './store.mjs';
const el=id=>document.getElementById(id);
const day=el('day'), meal=el('meal-text'), kind=el('meal-kind'), status=el('meal-status'), preview=el('meal-preview');
const photoPanel=el('photo-panel'), photoNotes=el('photo-notes'), photoHint=el('photo-hint');
const key='daily-check-in-meals-v1';
// draft: {items, unknown, source:'text'|'photo', notes} while reviewing; photo: the last prepared photo.
let draft=null, editing=null, editingAt=null, photo=null, busy=false;
// repeatBase: the foods of a past meal being logged again, at one serving.
let repeatBase=null;
const read=()=>JSON.parse(localStorage.getItem(key)||'{}');
function row(parent,tag,value){const node=document.createElement(tag);node.textContent=value;parent.append(node);return node}
function button(parent,label,action){const b=row(parent,'button',label);b.type='button';b.onclick=action;return b}
function clearPhoto(){if(photo)URL.revokeObjectURL(photo.previewUrl);photo=null;photoPanel.hidden=true;photoNotes.replaceChildren();photoHint.value='';el('photo-preview').removeAttribute('src')}
function clearDraft(){draft=null;repeatBase=null;el('meal-servings-field').hidden=true;preview.replaceChildren();photoNotes.replaceChildren();el('save-meal').disabled=true}
function reset(){editing=null;editingAt=null;meal.value='';clearDraft();clearPhoto()}
function showDraft(next){
 draft=next;
 renderEditor(preview,draft.items,items=>{draft={...draft,items}});
 if(draft.unknown.length)row(preview,'p','Uncounted: '+draft.unknown.join(', ')+'. Add them as items above, or save as a partial estimate.');
 el('save-meal').disabled=false;
}
const macros=sum=>'P '+Math.round(sum.protein)+' g · C '+Math.round(sum.carbs)+' g · F '+Math.round(sum.fat)+' g';
const clock=time=>new Date(time).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const LEAD={Breakfast:'🍳',Lunch:'🍛',Dinner:'🍽️','Snack / drink':'☕'};
function mealRow(history,entry){
 const sum=totals(entry.items);
 const li=row(history,'li','');li.className='list-row';li.style.flexWrap='wrap';
 const lead=row(li,'span',LEAD[entry.kind]||'🍴');lead.className='list-row__lead';lead.dataset.meal=typeOfEntry(entry);lead.setAttribute('aria-hidden','true');
 const body=row(li,'div','');body.className='list-row__body';
 row(body,'p',entry.text).className='list-row__title';
 row(body,'p',[loggedHour(entry,day.value)!==null&&clock(entry.at),macros(sum),entry.source==='photo'&&'photo'].filter(Boolean).join(' · ')).className='list-row__meta';
 if(entry.unknown.length)row(body,'p','Uncounted: '+entry.unknown.join(', ')).className='list-row__meta';
 const trail=row(li,'div','');trail.className='list-row__trail';
 row(trail,'strong',fmt(energy(sum)));row(trail,'span','kcal').className='hint';
 const actions=row(li,'div','');actions.className='row-actions';actions.style.flexBasis='100%';actions.style.paddingLeft='56px';
 const edit=button(actions,'Edit',()=>{reset();editing=entry.id;editingAt=entry.at||null;kind.value=entry.kind;meal.value=entry.text;showDraft({items:entry.items,unknown:entry.unknown,source:entry.source||'text',notes:entry.notes||[]});el('meal-log').scrollIntoView({block:'start'})});
 const remove=button(actions,'Remove',()=>{if(!confirm('Remove this meal?'))return;try{const data=read();data[day.value]=data[day.value].filter(m=>m.id!==entry.id);localStorage.setItem(key,JSON.stringify(data));window.trackerWrite('meal:'+day.value+':'+entry.id,null);if(editing===entry.id)reset();render();status.textContent='Meal removed.'}catch{status.textContent='Could not remove meal.'}});
 edit.className='btn btn--ghost';remove.className='btn btn--ghost';
}
// One card per meal time: the name and its calories, the macro subtotal, then its entries.
function section(parent,group){
 const card=row(parent,'article','');card.className='card';card.dataset.meal=typeOf(group.name);card.setAttribute('aria-label',group.name+', '+fmt(group.kcal)+' kcal');
 const head=row(card,'div','');head.className='card__head';head.style.marginBottom='0';
 const title=row(head,'h3','');title.className='card__title';
 const dot=row(title,'span','');dot.className='meal-dot';dot.dataset.meal=typeOf(group.name);dot.setAttribute('aria-hidden','true');
 title.append(group.name);
 const total=row(head,'p','');total.className='list-row__trail';row(total,'strong',fmt(group.kcal)+' kcal');
 row(card,'p',macros(group.sum)+(group.partial?' · partial':'')).className='hint num';
 const list=row(card,'ul','');list.className='list';
 for(const entry of group.entries)mealRow(list,entry);
}
function setServings(factor){for(const b of el('meal-servings').querySelectorAll('button'))b.setAttribute('aria-pressed',String(Number(b.dataset.factor)===factor))}
// A past meal back in the editor as a new entry for the selected day, at one serving.
function eatAgain(entry){
 reset();kind.value=entry.kind;meal.value=entry.text;status.textContent='';
 showDraft({items:entry.items,unknown:entry.unknown||[],source:'repeat',notes:[]});
 repeatBase=entry.items;setServings(1);el('meal-servings-field').hidden=false;
 status.textContent='Change the servings or any amount, then save.';
 el('meal-servings-field').scrollIntoView({block:'start',behavior:'smooth'});
}
// A dropdown of past meals; picking one opens it in the editor, then the dropdown goes back to its prompt.
let againMeals=[];
function renderAgain(){
 const list=el('meal-again-list');
 againMeals=recentMeals(read(),{upTo:day.value,kind:kind.value});
 el('meal-again').hidden=!againMeals.length;
 list.replaceChildren(new Option('Pick a past meal…',''),...againMeals.map((entry,i)=>new Option(shortLabel(entry.text,40)+' · '+fmt(energy(totals(entry.items)))+' kcal',String(i))));
}
el('meal-again-list').addEventListener('change',event=>{const entry=event.target.value===''?null:againMeals[Number(event.target.value)];event.target.value='';if(entry)eatAgain(entry)});
function render(){
 const history=el('meal-history');history.replaceChildren();
 try{
  const entries=read()[day.value]||[];
  const sum=totals(entries.flatMap(entry=>entry.items));
  el('meal-total').textContent=entries.length?fmt(energy(sum))+' kcal':'';
  el('meal-partial').textContent=entries.some(entry=>entry.unknown.length)?'Partial total. Some foods are uncounted.':'';
  for(const group of groupMeals(entries,day.value))section(history,group);
  renderAgain();
  if(!entries.length){const card=row(history,'article','');card.className='card';const empty=row(card,'div','');empty.className='empty';row(empty,'p','Nothing logged yet').className='empty__title';row(empty,'p','Snap your next meal with the orange camera. It takes about five seconds.').className='empty__text'}
 }catch{status.textContent='Could not open meal history.'}
 window.dispatchEvent(new Event('meals-rendered'));
}
// Batch mode asks for the whole pot, because dividing a known total beats judging a serving.
const POT_PREFIX='These are the raw, dry ingredients that went into one pot for the whole household. Estimate the whole pot, not one serving: ';
const POT_PLACEHOLDER='2.5 cups basmati, 1 kg mutton, 4 tbsp ghee, 3 onions';
const PLATE_PLACEHOLDER='2 rotis, 150 g chicken curry, 1 cup sabzi';
const batchOn=()=>el('batch-on').checked;
const batchShare=()=>batchOn()?shareFactor(el('batch-made').value,el('batch-ate').value||1):null;

function showBatch(){
 const on=batchOn();
 el('batch-fields').hidden=!on;
 meal.placeholder=on?POT_PLACEHOLDER:PLATE_PLACEHOLDER;
 el('batch-share').textContent=on?(shareLabel(el('batch-made').value,el('batch-ate').value||1)||'Say how many servings the pot made.'):'';
 if(draft?.source==='text')clearDraft();
}
el('batch-on').addEventListener('change',showBatch);
for(const id of ['batch-made','batch-ate'])el(id).addEventListener('input',showBatch);
showBatch();

// Typed meals are re-estimated after the text changes; photo descriptions are just labels.
meal.addEventListener('input',()=>{if(draft?.source==='text')clearDraft()});
day.addEventListener('change',()=>{reset();kind.value=kindForHour(new Date().getHours());status.textContent='';render()});
// Typed meals (often spoken with the keyboard mic) go to Claude; the local food table is the offline fallback.
el('estimate-meal').onclick=async()=>{
 clearDraft();clearPhoto();status.textContent='';
 const description=meal.value.trim();
 if(!day.value||!description){status.textContent='Choose a date and describe your meal.';return}
 if(busy)return;
 busy=true;el('estimate-meal').disabled=true;status.textContent='Estimating…';
 try{
  const result=await estimateText(batchOn()?POT_PREFIX+description:description);
  if(meal.value.trim()!==description){status.textContent='The description changed. Tap Estimate again.';return}
  if(!result.isFood){status.textContent=(result.summary||'No food found in that description.')+' Nothing was saved.';return}
  for(const note of result.assumptions)row(photoNotes,'li','Assumed: '+note);
  if(result.question)row(photoNotes,'li','Question: '+result.question+' Add the answer to the description and estimate again, or edit the items directly.');
  const share=batchShare();
  if(batchOn()&&share===null){status.textContent='Say how many servings the pot made, then estimate again.';return}
  if(share!==null)row(photoNotes,'li',shareLabel(el('batch-made').value,el('batch-ate').value||1)+' of the whole pot.');
  showDraft({items:share===null?result.items:splitBatch(result.items,el('batch-made').value,el('batch-ate').value||1),unknown:[],source:'text',notes:result.assumptions});
  status.textContent=share===null?'Review the foods and amounts, then save.':'That is your share of the pot. Review and save.';
 }catch(error){
  if(meal.value.trim()!==description){status.textContent='The description changed. Tap Estimate again.';return}
  const offline=estimate(description), share=batchShare();
  showDraft({...offline,items:share===null?offline.items:splitBatch(offline.items,el('batch-made').value,el('batch-ate').value||1),source:'text',notes:[]});
  status.textContent=error.message+' Showing a basic offline estimate instead. Check it carefully.';
 }finally{busy=false;el('estimate-meal').disabled=false}
};
async function runPhotoEstimate(){
 if(!photo||busy)return;
 busy=true;el('snap-meal').disabled=el('photo-recheck').disabled=true;clearDraft();photoNotes.replaceChildren();
 status.textContent='Analysing photo… this can take up to a minute.';
 try{
  const result=await analyzePhoto(photo,photoHint.value.trim());
  if(!result.isFood){status.textContent=(result.summary||'No food found in this photo.')+' Nothing was saved.';return}
  if(!meal.value.trim()||meal.value===photo.summary)meal.value=result.summary;
  photo={...photo,summary:result.summary};
  for(const note of result.assumptions)row(photoNotes,'li','Assumed: '+note);
  if(result.question)row(photoNotes,'li','Question: '+result.question+' Answer below and re-check, or edit the items directly.');
  showDraft({items:result.items,unknown:[],source:'photo',notes:result.assumptions});
  status.textContent='Review the foods and amounts, then save.';
 }catch(error){status.textContent=error.message+' Nothing was saved.'}
 finally{busy=false;el('snap-meal').disabled=el('photo-recheck').disabled=false}
}
el('snap-meal').onclick=()=>{if(!day.value){status.textContent='Choose a date first.';return}el('photo-input').click()};
el('photo-input').addEventListener('change',async event=>{
 const file=event.target.files[0];event.target.value='';
 if(!file)return;
 const keepEditing=editing, keepAt=editingAt;reset();editing=keepEditing;editingAt=keepAt;
 try{photo=await preparePhoto(file)}catch(error){status.textContent=error.message;return}
 el('photo-preview').src=photo.previewUrl;photoPanel.hidden=false;
 await runPhotoEstimate();
});
el('photo-recheck').onclick=runPhotoEstimate;
el('meal-servings').addEventListener('click',event=>{
 const factor=Number(event.target.closest('button')?.dataset.factor);
 if(!repeatBase||!factor)return;
 showDraft({...draft,items:scaleItems(repeatBase,factor)});setServings(factor);
});
kind.addEventListener('change',()=>{try{renderAgain()}catch{}});
el('save-meal').onclick=()=>{
 if(!draft)return;
 const items=cleanItems(draft.items);
 if(!items.length&&!draft.unknown.length){status.textContent='Add at least one food before saving.';return}
 try{
  const data=read(), entries=data[day.value]||[];
  const entry={id:editing||crypto.randomUUID(),at:editing?editingAt??undefined:Date.now(),kind:kind.value,text:meal.value.trim()||'Meal',items,unknown:draft.unknown,...(draft.source==='photo'?{source:'photo',notes:draft.notes}:{})};
  data[day.value]=editing&&entries.some(m=>m.id===editing)?entries.map(m=>m.id===editing?entry:m):[...entries,entry];
  localStorage.setItem(key,JSON.stringify(data));window.trackerWrite('meal:'+day.value+':'+entry.id,entry);reset();kind.value=kindForHour(new Date().getHours());render();status.textContent='Meal saved.';
 }catch{status.textContent='Could not save. Check browser storage.'}
};
kind.value=kindForHour(new Date().getHours());
render();
window.addEventListener('tracker-synced',render);
