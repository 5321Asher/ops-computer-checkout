// The checkout page: check items out, and return the ones that are out.

import { api, clockTime, el, emptyState, formatDate, matchesSearch, showLocation, showToast } from './common.js';

const REFRESH_MS = 30_000;

const form = document.getElementById('checkout-form');
const submitButton = document.getElementById('submit-btn');
const search = document.getElementById('search');
const list = document.getElementById('asset-list');

let items = [];

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
  list.replaceChildren(...shown.map(card));
}

function card(item, index) {
  const row = (label, value, className = '') =>
    el('div', { className: 'card-row' },
      el('span', { className: 'card-label' }, label),
      el('span', { className: `card-value ${className}` }, value));

  const returnButton = el('button', { type: 'button', className: 'btn-return' }, 'Return');
  const node = el('div', { className: 'asset-card' },
    el('div', { className: 'card-header' },
      el('span', { className: 'card-asset' }, item.asset ?? ''),
      el('span', { className: 'card-id-pill', title: item.id ?? '' }, (item.id ?? '').slice(0, 8))),
    el('div', { className: 'card-body' },
      row('USER', item.name ?? ''),
      row('LOCATION', item.location ?? '', 'location'),
      row('SINCE', formatDate(item.checkout), 'time')),
    returnButton);
  node.style.animationDelay = `${Math.min(index, 20) * 30}ms`;
  returnButton.addEventListener('click', () => returnItem(item, node, returnButton));
  return node;
}

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
