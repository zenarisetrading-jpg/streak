// Apple Watch / Health connection: create, show once and revoke the Shortcut key.
const el = id => document.getElementById(id);
const INGEST_PATH = '/ingest/health';
const status = message => { el('health-status').textContent = message; };

async function api(method) {
 const response = await fetch('/api/health-key', {method, cache: 'no-store'});
 if (!response.ok) throw new Error('Request failed (' + response.status + ')');
 return response.status === 204 ? null : response.json();
}

function showState({active, createdAt}) {
 el('health-state').textContent = active
  ? 'Connected. Key created ' + new Date(createdAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) + '.'
  : 'Not connected.';
 el('health-create').textContent = active ? 'Replace key' : 'Create Shortcut key';
 el('health-revoke').hidden = !active;
}

async function refresh() {
 try { showState(await api('GET')); } catch { el('health-state').textContent = 'Could not check the connection.'; }
}

function copyButton(button, field) {
 button.onclick = async () => {
  try { await navigator.clipboard.writeText(field.value); status('Copied.'); }
  catch { field.select(); status('Select and copy it manually.'); }
 };
}

el('health-create').onclick = async () => {
 if (!el('health-revoke').hidden && !confirm('Replace your key? The Shortcut will stop sending until you paste the new key into it.')) return;
 try {
  const {token} = await api('POST');
  el('health-key').value = token;
  el('health-url').value = location.origin + INGEST_PATH;
  el('health-setup').hidden = false;
  status('Key created. Copy it into the Shortcut now. It will not be shown again.');
  await refresh();
 } catch (error) { status('Could not create a key. ' + error.message); }
};

el('health-revoke').onclick = async () => {
 if (!confirm('Disconnect Apple Health? Your Shortcut will stop sending data. Data already sent is kept.')) return;
 try { await api('DELETE'); el('health-setup').hidden = true; el('health-key').value = ''; status('Disconnected.'); await refresh(); }
 catch (error) { status('Could not disconnect. ' + error.message); }
};

copyButton(el('health-copy-key'), el('health-key'));
copyButton(el('health-copy-url'), el('health-url'));
window.addEventListener('tracker-user', refresh);
refresh();
