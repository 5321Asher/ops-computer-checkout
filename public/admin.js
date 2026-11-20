// The admin page: everything checked out, the full history, and how the Excel file and the ticket
// list are doing.

import { api, clockTime, el, emptyState, formatDate, matchesSearch, showLocation, showToast } from './common.js';

const REFRESH_MS = 30_000;
// Rows shown at once. The history keeps growing, and drawing all of it every refresh would freeze
// the page; the filter and sorting still cover every row.
const PAGE_SIZE = 50;
// Sorts the way people expect: capitals don't matter, and numbers go in order (OPS-9 before OPS-10).
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

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
      ['td-note', (r) => noteButton('daily', r)],
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
      ['td-note', (r) => noteButton('log', r)],
    ],
    empty: 'No history yet',
    countText: (n) => `${n} records`,
  },
};

const state = {
  daily: { rows: [], sortColumn: null, sortDirection: 1, page: 1 },
  log: { rows: [], sortColumn: null, sortDirection: 1, page: 1 },
};

async function loadTable(name) {
  const body = document.getElementById(`${name}-body`);
  try {
    state[name].rows = await api(TABLES[name].url);
    document.getElementById(`${name}-refresh`).textContent = clockTime();
    render(name);
    return true;
  } catch (err) {
    body.replaceChildren(fullWidthRow(name, emptyState('!', err.message)));
    return false;
  }
}

function fullWidthRow(name, content) {
  return el('tr', {}, el('td', { colSpan: TABLES[name].cells.length }, content));
}

function render(name) {
  const s = state[name];
  const table = TABLES[name];
  const search = document.getElementById(`${name}-search`).value;
  const matching = s.rows.filter((r) => matchesSearch(r, search));
  if (s.sortColumn) {
    matching.sort((a, b) => s.sortDirection * collator.compare(a[s.sortColumn] ?? '', b[s.sortColumn] ?? ''));
  }
  // Stay on the same page through a refresh, unless the list got shorter than that.
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  s.page = Math.min(s.page, pages);
  const first = (s.page - 1) * PAGE_SIZE;
  const shown = matching.slice(first, first + PAGE_SIZE);

  document.getElementById(`${name}-count`).textContent = table.countText(s.rows.length);
  document.getElementById(`${name}-shown`).textContent =
    matching.length ? `${first + 1}–${first + shown.length} of ${matching.length}` : '0';
  document.getElementById(`${name}-page`).textContent = `Page ${s.page} of ${pages}`;
  const pager = document.getElementById(`${name}-pager`);
  pager.hidden = pages === 1;
  pager.querySelector('[data-page="-1"]').disabled = s.page === 1;
  pager.querySelector('[data-page="1"]').disabled = s.page === pages;

  const body = document.getElementById(`${name}-body`);
  if (!shown.length) {
    body.replaceChildren(fullWidthRow(name, emptyState('⊘', search.trim() ? 'No matching records' : table.empty)));
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

async function loadFileStatus() {
  try {
    const { excel, tickets } = await api('/api/status');
    if (excel.lastError) {
      setStatus('excel-status', `Excel file: not saved: ${excel.lastError}. If it's open in Excel, close it. It keeps trying by itself, including while the server can't be reached.`, 'problem');
    } else if (excel.lastSuccessAt) {
      setStatus('excel-status', `Excel file: saved at ${clockTime(new Date(excel.lastSuccessAt))} to ${excel.path}`, 'ok');
    } else {
      setStatus('excel-status', `Excel file: saving to ${excel.path}…`, '');
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
    setStatus('excel-status', 'Excel file: unknown (could not reach the checkout program)', 'problem');
    setStatus('tickets-status', 'Ticket list: unknown', 'problem');
  }
}

async function loadAll() {
  const results = await Promise.all([loadTable('daily'), loadTable('log'), loadFileStatus()]);
  const online = results[0] && results[1];
  const dot = document.getElementById('status-dot');
  dot.classList.toggle('offline', !online);
  dot.title = online ? 'Connected' : 'Could not reach the checkout program';
  if (online) updateStats();
}

// ---------- Notes ----------

// The automatic refresh waits while a note is being typed, so the text box isn't replaced.
let editingNote = false;
const refresh = () => (editingNote ? undefined : loadAll());

// A note, shown as a button that turns into a text box for changing it.
function noteButton(name, row) {
  const button = el('button', { type: 'button', className: row.note ? 'note-button' : 'note-button empty', title: row.note || 'Add a note' },
    row.note || '+ note');
  button.addEventListener('click', () => editNote(name, row, button));
  return button;
}

// Enter, or clicking elsewhere, saves the note; Escape cancels. An empty note removes it.
function editNote(name, row, button) {
  const input = el('input', { type: 'text', className: 'note-input', value: row.note ?? '', maxLength: 500, placeholder: 'Note…' });
  input.setAttribute('aria-label', `Note for ${row.asset ?? 'this item'}`);
  let finished = false;

  async function finish(save) {
    if (finished) return;
    finished = true;
    editingNote = false;
    const note = input.value.trim();
    if (!save || note === (row.note ?? '')) {
      input.replaceWith(noteButton(name, row));
      return;
    }
    input.disabled = true;
    let saved = false;
    try {
      const reply = await api(`/api/checkouts/${encodeURIComponent(row.id)}/note`, { method: 'POST', body: { note } });
      row.note = reply.note;
      saved = true;
      showToast(reply.message, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
    const stillShown = input.isConnected;
    if (stillShown) input.replaceWith(noteButton(name, row));
    // Show what's really saved if this failed (e.g. the item is gone), or if the table was
    // redrawn meanwhile (e.g. Refresh) without the new note.
    if (!saved || !stillShown) refresh();
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    else if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  editingNote = true;
  button.replaceWith(input);
  input.focus();
}

// ---------- Sorting, filtering and pages ----------

for (const name of Object.keys(TABLES)) {
  const s = state[name];
  const headers = document.querySelectorAll(`#${name}-table th[data-sort]`);
  for (const th of headers) {
    th.querySelector('button').addEventListener('click', () => {
      const column = th.dataset.sort;
      s.sortDirection = s.sortColumn === column ? -s.sortDirection : 1;
      s.sortColumn = column;
      s.page = 1;
      for (const other of headers) {
        other.classList.toggle('sorted', other === th);
        other.querySelector('.sort-arrow').textContent = other === th ? (s.sortDirection === 1 ? '↑' : '↓') : '↕';
      }
      render(name);
    });
  }
  document.getElementById(`${name}-search`).addEventListener('input', () => {
    s.page = 1;
    render(name);
  });
  for (const button of document.querySelectorAll(`#${name}-pager button`)) {
    button.addEventListener('click', () => {
      s.page += Number(button.dataset.page);
      render(name);
    });
  }
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
    label.textContent = 'Save Excel';
    loadFileStatus();
  }
});

document.getElementById('btn-download').addEventListener('click', () => showToast('Downloading Excel file…', 'info'));
document.getElementById('btn-refresh').addEventListener('click', loadAll);

showLocation();
loadAll();
setInterval(refresh, REFRESH_MS);
