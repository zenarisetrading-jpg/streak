// Owner-only People card: invite someone by email, share the app link, remove invited people.
// The server refuses everyone else, so the card stays hidden for them.
const el = id => document.getElementById(id);
const status = message => { el('people-status').textContent = message; };
const SHARE_TEXT = 'Track meals and workouts on Streak. Open the link and sign in with the email I invited.';

async function api(method, email) {
 const response = await fetch('/api/people', {
  method, cache: 'no-store',
  headers: email ? {'Content-Type': 'application/json'} : undefined,
  body: email ? JSON.stringify({email}) : undefined,
 });
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed (' + response.status + ')'), {status: response.status});
 return data;
}

function row(title, meta, onRemove) {
 const item = document.createElement('li');
 item.className = 'list-row';
 const body = document.createElement('div');
 body.className = 'list-row__body';
 const name = document.createElement('div');
 name.className = 'list-row__title';
 name.textContent = title;
 const sub = document.createElement('div');
 sub.className = 'list-row__meta';
 sub.textContent = meta;
 body.append(name, sub);
 item.append(body);
 if (onRemove) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--ghost';
  button.textContent = 'Remove';
  button.setAttribute('aria-label', 'Remove ' + title);
  button.onclick = onRemove;
  item.append(button);
 }
 return item;
}

const added = iso => 'Invited ' + new Date(iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric'});

function render({household, invited, max, ready}) {
 el('people-section').hidden = false;
 el('people-invite').disabled = !ready || invited.length >= max;
 if (!ready) status('Inviting is not switched on yet.');
 const rows = [
  ...household.map(email => row(email, 'Household')),
  ...invited.map(person => row(person.email, added(person.added_at), () => remove(person.email))),
 ];
 el('people-list').replaceChildren(...rows);
}

async function refresh() {
 try { render(await api('GET')); }
 catch (error) { if (error.status === 403) el('people-section').hidden = true; }
}

async function remove(email) {
 if (!confirm('Remove ' + email + '? They will lose access straight away. Their saved data is kept.')) return;
 try { const result = await api('DELETE', email); status(result.warning || 'Removed ' + email + '.'); }
 catch (error) { status(error.message); }
 await refresh();
}

async function invite() {
 const field = el('people-email');
 const email = field.value.trim().toLowerCase();
 if (!field.checkValidity() || !email) { status('Enter a valid email address.'); return; }
 const button = el('people-invite');
 button.disabled = true;
 status('Inviting…');
 try {
  await api('POST', email);
  field.value = '';
  status('Invited ' + email + '. Send them the link with Share link.');
 } catch (error) { status(error.message); }
 await refresh();
}

async function share() {
 const url = location.origin + '/';
 try {
  if (navigator.share) await navigator.share({title: 'Streak', text: SHARE_TEXT, url});
  else { await navigator.clipboard.writeText(url); status('Link copied.'); }
 } catch (error) { if (error.name !== 'AbortError') status('Copy this link: ' + url); }
}

el('people-invite').onclick = invite;
el('people-share').onclick = share;
el('people-email').addEventListener('keydown', event => { if (event.key === 'Enter') invite(); });
window.addEventListener('tracker-user', refresh);
refresh();
