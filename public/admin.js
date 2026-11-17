// The admin page: everything checked out, the full history, and the copies on the server share.

import { api, clockTime, el, emptyState, formatDate, matchesSearch, showLocation, showToast } from './common.js';

const REFRESH_MS = 30_000;

// Each table's cells, in column order: [CSS class, how to show the value].
const TABLES = {
  daily: {
    url: '/api/checkouts',
    cells: [
      ['td-name', (r) => r.name ?? ''],
      ['td-asset', (r) => r.asset ?? ''],
      ['td-location', (r) => r.location ?? ''],
      ['td-time', (r) => formatDate(r.checkout)],
      ['', () => el('span', { className: 'badge-active' }, 'Out')],
      ['td-id', (r) => (r.id ?? '').slice(0, 8)],
    ],
    empty: 'No assets currently checked out',
    countText: (n) => `${n} active`,
  },
  log: {
    url: '/api/history',
    cells: [
      ['td-name', (r) => r.name ?? ''],
      ['td-asset', (r) => r.asset ?? ''],
      ['td-location', (r) => r.location ?? ''],
      ['td-time', (r) => formatDate(r.checkout)],
      ['td-time', (r) => formatDate(r.returned_at)],
      ['td-note', (r) => r.note || '—'],
    ],
    empty: 'No history yet',
    countText: (n) => `${n} records`,
  },
};

const state = {
  daily: { rows: [], sortColumn: null, sortDirection: 1 },
  log: { rows: [], sortColumn: null, sortDirection: 1 },
};

async function loadTable(name) {
  const body = document.getElementById(`${name}-body`);
  try {
    state[name].rows = await api(TABLES[name].url);
    document.getElementById(`${name}-refresh`).textContent = clockTime();
    render(name);
    return true;
  } catch (err) {
    body.replaceChildren(fullWidthRow(emptyState('!', err.message)));
    return false;
  }
}

function fullWidthRow(content) {
  return el('tr', {}, el('td', { colSpan: 6 }, content));
}

function render(name) {
  const { rows, sortColumn, sortDirection } = state[name];
  const table = TABLES[name];
  const search = document.getElementById(`${name}-search`).value;
  let shown = rows.filter((r) => matchesSearch(r, search));
  if (sortColumn) {
    shown = [...shown].sort((a, b) => {
      const x = a[sortColumn] ?? '';
      const y = b[sortColumn] ?? '';
      return x < y ? -sortDirection : x > y ? sortDirection : 0;
    });
  }

  document.getElementById(`${name}-count`).textContent = table.countText(rows.length);
  document.getElementById(`${name}-shown`).textContent = shown.length;
  const body = document.getElementById(`${name}-body`);
  if (!shown.length) {
    body.replaceChildren(fullWidthRow(emptyState('⊘', search.trim() ? 'No matching records' : table.empty)));
    return;
  }
  body.replaceChildren(...shown.map((row) =>
    el('tr', {}, ...table.cells.map(([className, value]) => el('td', { className }, value(row))))));
}

function updateStats() {
  const today = new Date().toDateString();
  document.getElementById('stat-active').textContent = state.daily.rows.length;
  document.getElementById('stat-total').textContent = state.log.rows.length;
  document.getElementById('stat-today').textContent =
    state.log.rows.filter((r) => r.returned_at && new Date(r.returned_at).toDateString() === today).length;
}

function setStatus(id, text, kind) {
  const node = document.getElementById(id);
  node.textContent = text;
  node.className = kind;
}

async function loadShareStatus() {
  try {
    const { excel, tickets } = await api('/api/status');
    if (excel.lastError) {
      setStatus('excel-status', `Excel copy: not saved: ${excel.lastError}. It keeps trying by itself.`, 'problem');
    } else if (excel.lastSuccessAt) {
      setStatus('excel-status', `Excel copy: saved at ${clockTime(new Date(excel.lastSuccessAt))} to ${excel.path}`, 'ok');
    } else {
      setStatus('excel-status', `Excel copy: saving to ${excel.path}…`, '');
    }
    if (!tickets.waiting) {
      setStatus('tickets-status', `Ticket list: up to date (${tickets.path})`, 'ok');
    } else if (tickets.lastError) {
      setStatus('tickets-status', `Ticket list: ${tickets.waiting} ticket(s) waiting to be added: ${tickets.lastError}. ` +
        'They are kept safe on this computer and it keeps trying by itself.', 'problem');
    } else {
      setStatus('tickets-status', `Ticket list: adding ${tickets.waiting} ticket(s)…`, '');
    }
  } catch {
    setStatus('excel-status', 'Excel copy: unknown (could not reach the checkout program)', 'problem');
    setStatus('tickets-status', 'Ticket list: unknown', 'problem');
  }
}

async function loadAll() {
  const results = await Promise.all([loadTable('daily'), loadTable('log'), loadShareStatus()]);
  const online = results[0] && results[1];
  const dot = document.getElementById('status-dot');
  dot.classList.toggle('offline', !online);
  dot.title = online ? 'Connected' : 'Could not reach the checkout program';
  if (online) updateStats();
}

// ---------- Sorting ----------

for (const name of Object.keys(TABLES)) {
  const headers = document.querySelectorAll(`#${name}-table th[data-sort]`);
  for (const th of headers) {
    th.querySelector('button').addEventListener('click', () => {
      const s = state[name];
      const column = th.dataset.sort;
      s.sortDirection = s.sortColumn === column ? -s.sortDirection : 1;
      s.sortColumn = column;
      for (const other of headers) {
        other.classList.toggle('sorted', other === th);
        other.querySelector('.sort-arrow').textContent = other === th ? (s.sortDirection === 1 ? '↑' : '↓') : '↕';
      }
      render(name);
    });
  }
  document.getElementById(`${name}-search`).addEventListener('input', () => render(name));
}

// ---------- Buttons ----------

document.getElementById('btn-save').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const label = button.querySelector('span');
  button.disabled = true;
  label.textContent = 'Saving…';
  try {
    const { message } = await api('/api/excel/save', { method: 'POST' });
    showToast(message, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    button.disabled = false;
    label.textContent = 'Save to Server';
    loadShareStatus();
  }
});

document.getElementById('btn-download').addEventListener('click', () => showToast('Downloading Excel file…', 'info'));
document.getElementById('btn-refresh').addEventListener('click', loadAll);

showLocation();
loadAll();
setInterval(loadAll, REFRESH_MS);
