// Helpers shared by the checkout page and the admin page.

// Calls the server's API. Resolves with the reply, or rejects with the server's error message.
export async function api(path, { method = 'GET', body } = {}) {
  const options = { method, headers: {} };
  if (method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body ?? {});
  }
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error('Could not reach the checkout program. Is its window still open?');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Something went wrong (error ${res.status}).`);
  return data;
}

// Makes an element: el('td', { className: 'td-asset' }, 'OPS-1234', otherElement).
// Text is always added as text, never as HTML, so nothing typed into the form can run as code.
export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

// The "nothing to show" message for a list or table.
export function emptyState(symbol, message) {
  return el('div', { className: 'empty-state' }, el('span', { className: 'big' }, symbol), message);
}

let toastTimer;
export function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = ''; }, type === 'error' ? 6000 : 3500);
}

// A stored timestamp as e.g. "NOV 17, 02:05 PM", in this computer's time zone.
export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).toUpperCase();
}

export const clockTime = (date = new Date()) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Whether a record's name, asset or location contains the search text.
export function matchesSearch(row, query) {
  const q = query.trim().toLowerCase();
  return !q || [row.name, row.asset, row.location].some((v) => (v ?? '').toLowerCase().includes(q));
}

// Shows which location this computer is set up for, next to the page title.
export async function showLocation() {
  try {
    const { location } = await api('/api/status');
    document.getElementById('location-name').textContent = location;
    if (location) document.title = `${document.title} · ${location}`;
  } catch {
    // Not important enough to report; the lists show their own errors.
  }
}
