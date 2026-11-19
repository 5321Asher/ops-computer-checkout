// The checkout page: check items out, and return the ones that are out.

import { api, clockTime, el, emptyState, formatDate, matchesSearch, showLocation, showToast } from './common.js';

const REFRESH_MS = 30_000;

const form = document.getElementById('checkout-form');
const submitButton = document.getElementById('submit-btn');
const search = document.getElementById('search');
const list = document.getElementById('asset-list');
const dialog = document.getElementById('return-dialog');

let items = [];
// Cards slide in the first time they're shown, not again every time the list is redrawn (the
// automatic refresh, searching).
const seen = new Set();

async function loadItems() {
  try {
    items = await api('/api/checkouts');
    document.getElementById('refresh-time').textContent = clockTime();
    render();
  } catch (err) {
    list.replaceChildren(emptyState('!', err.message));
  }
}

function render() {
  const shown = items.filter((item) => matchesSearch(item, search.value));
  document.getElementById('count').textContent = shown.length;
  document.getElementById('count-word').textContent = shown.length === 1 ? 'item' : 'items';
  if (!shown.length) {
    list.replaceChildren(emptyState('⊘', search.value.trim() ? 'No matching assets' : 'All assets returned'));
    return;
  }
  let entering = 0;
  list.replaceChildren(...shown.map((item) => {
    const node = card(item);
    if (!seen.has(item.id)) {
      seen.add(item.id);
      node.classList.add('entering');
      node.style.animationDelay = `${Math.min(entering++, 20) * 30}ms`;
    }
    return node;
  }));
}

// An item's asset, location and time out, one per line, as on its card.
function details(item) {
  const row = (label, value, className) =>
    el('div', { className: 'card-row' },
      el('span', { className: 'card-label' }, label),
      el('span', { className: `card-value ${className}` }, value));
  return [
    row('ASSET', item.asset ?? '', 'asset'),
    row('LOCATION', item.location ?? '', 'location'),
    row('SINCE', formatDate(item.checkout), 'time'),
  ];
}

function card(item) {
  const returnButton = el('button', { type: 'button', className: 'btn-return' }, 'Return');
  const node = el('div', { className: 'asset-card' },
    el('div', { className: 'card-header' },
      el('span', { className: 'card-name' }, item.name ?? ''),
      el('span', { className: 'card-id-pill', title: item.id ?? '' }, (item.id ?? '').slice(0, 8))),
    el('div', { className: 'card-body' }, ...details(item)),
    returnButton);
  returnButton.addEventListener('click', async () => {
    if (await confirmReturn(item)) returnItem(item, node, returnButton);
  });
  return node;
}

// Asks before returning an item, since a return can't be undone. Resolves true for Return; Cancel,
// Escape or clicking outside the box resolve false. Cancel has the focus, so Enter doesn't return.
let settle = null; // resolves the open dialog's question; null once it's answered

function confirmReturn(item) {
  document.getElementById('return-name').textContent = item.name ?? '';
  document.getElementById('return-details').replaceChildren(...details(item));
  settle?.(false); // closed with Escape, but the close event hasn't arrived yet
  dialog.showModal();
  return new Promise((resolve) => { settle = resolve; });
}

// Answers the question once, however the dialog was closed.
function answer(confirmed) {
  const resolve = settle;
  settle = null;
  dialog.close();
  resolve?.(confirmed);
}

document.getElementById('return-confirm').addEventListener('click', () => answer(true));
document.getElementById('return-cancel').addEventListener('click', () => answer(false));
// The box fills the dialog, so a click on the dialog itself is a click on the backdrop around it.
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) answer(false);
});
// Escape. The browser reports a close some time later, possibly after the dialog has been opened
// again for another return; that close isn't this one's, so it's ignored.
dialog.addEventListener('close', () => {
  if (!dialog.open) answer(false);
});

async function returnItem(item, node, button) {
  button.disabled = true;
  button.replaceChildren(el('span', { className: 'spinner' }));
  try {
    const { message } = await api(`/api/checkouts/${encodeURIComponent(item.id)}/return`, { method: 'POST' });
    showToast(message, 'success');
    node.classList.add('leaving');
    setTimeout(() => {
      items = items.filter((i) => i.id !== item.id);
      render();
    }, 200);
  } catch (err) {
    showToast(err.message, 'error');
    // The list may be out of date (e.g. returned on another tab), so show what's really out.
    await loadItems();
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const details = Object.fromEntries(new FormData(form));
  submitButton.disabled = true;
  submitButton.replaceChildren(el('span', { className: 'spinner' }));
  try {
    const { message } = await api('/api/checkouts', { method: 'POST', body: details });
    showToast(message, 'success');
    form.reset();
    document.getElementById('f-user').focus();
    await loadItems();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Check Out';
  }
});

search.addEventListener('input', render);

showLocation();
loadItems();
setInterval(loadItems, REFRESH_MS);
