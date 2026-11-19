// The two pages in a real (headless) browser. Skipped if Chrome, Chromium or Edge isn't installed.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { findBrowser, launchBrowser } from './browser.js';
import { startApp } from './helpers.js';

const executable = findBrowser();
let app;
let page;

before(async () => {
  if (!executable) return;
  app = await startApp();
  page = await launchBrowser(executable);
});

after(async () => {
  await page?.close();
  await app?.close();
});

const skip = !executable && 'no Chrome, Chromium or Edge found';
// The customer's name on each card, top to bottom.
const cards = () => page.eval('[...document.querySelectorAll(".asset-card")].map((c) => c.querySelector(".card-name").textContent)');
const cardRows = () => page.eval('[...document.querySelectorAll("#asset-list .card-row")].map((r) => r.innerText.replace(/\\s+/g, " ").trim())');
const dialogOpen = 'document.getElementById("return-dialog").open';
// Whether each card, top to bottom, plays the slide-in animation.
const entering = () => page.eval('[...document.querySelectorAll(".asset-card")].map((c) => c.classList.contains("entering"))');
// The text of each history cell with this class, top to bottom.
const logColumn = (className) => page.eval(`[...document.querySelectorAll("#log-body td.${className}")].map((td) => td.textContent)`);

test('checking out from the form shows a card with the customer and asset', { skip }, async () => {
  await page.goto(`${app.base}/`);
  await page.waitFor('document.getElementById("location-name").textContent === "Test Location"');
  await page.waitFor('document.getElementById("asset-list").textContent.includes("All assets returned")');

  await page.type('#f-user', 'Jane Doe');
  await page.type('#f-asset', 'ops-1234 csd');
  await page.type('#f-location', 'Courtroom 3');
  await page.click('#submit-btn');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 1');

  assert.equal(await page.text('#toast'), 'OPS-1234 checked out successfully.');
  assert.deepEqual(await cards(), ['Jane Doe']);
  const rows = await cardRows();
  assert.equal(rows[0], 'ASSET OPS-1234');
  assert.equal(rows[1], 'LOCATION Courtroom 3');
  assert.match(rows[2], /^SINCE [A-Z]{3} \d+/);
  assert.equal(await page.eval('document.getElementById("f-user").value'), '');
  assert.equal(await page.text('#count'), '1');
});

test('any asset can be checked out, and the newest checkout is listed first', { skip }, async () => {
  await page.type('#f-user', 'Sam Lee');
  await page.type('#f-asset', 'Projector 2');
  await page.type('#f-location', 'Room 1');
  await page.click('#submit-btn');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 2');
  assert.equal(await page.text('#toast'), 'PROJECTOR 2 checked out successfully.');
  assert.deepEqual(await cards(), ['Sam Lee', 'Jane Doe']);
  assert.equal((await cardRows())[0], 'ASSET PROJECTOR 2');
});

test('typed text is always shown as text, never run as HTML', { skip }, async () => {
  await page.type('#f-user', '<img src=x onerror="window.hacked=1">');
  await page.type('#f-asset', 'RSI-<b>9</b>');
  await page.type('#f-location', '"><script>window.hacked=1</script>');
  await page.click('#submit-btn');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 3');
  assert.equal(await page.eval('document.querySelectorAll("#asset-list img, #asset-list b, #asset-list script").length'), 0);
  assert.equal(await page.eval('window.hacked ?? null'), null);
  assert.equal((await cards())[0], '<img src=x onerror="window.hacked=1">');
  assert.equal((await cardRows())[0], 'ASSET RSI-<B>9</B>');
});

test('cards slide in when they first appear, not again each time the list is redrawn', { skip }, async () => {
  // Only the card checked out just now slides in; the two already shown stay put.
  assert.deepEqual(await entering(), [true, false, false]);
  // Searching redraws the list, as the automatic refresh does.
  await page.type('#search', 'jane');
  await page.type('#search', '');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 3');
  assert.deepEqual(await entering(), [false, false, false]);
});

test('searching filters the cards', { skip }, async () => {
  await page.type('#search', 'courtroom');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 1');
  await page.type('#search', 'nothing like this');
  await page.waitFor('document.getElementById("asset-list").textContent.includes("No matching assets")');
  await page.type('#search', '');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 3');
});

test('Return asks first, showing the item, and Cancel, Escape or clicking outside keep it out', { skip }, async () => {
  const before = await cards();
  await page.click('.asset-card .btn-return');
  await page.waitFor(dialogOpen);
  assert.equal(await page.text('#return-name'), before[0]);
  assert.match(await page.eval('document.getElementById("return-details").innerText'), /ASSET\s+RSI-<B>9<\/B>\s+LOCATION\s+"><script>/);
  assert.equal(await page.eval('document.activeElement.id'), 'return-cancel'); // so Enter doesn't return it
  await page.click('#return-cancel');
  await page.waitFor(`!${dialogOpen}`);

  await page.click('.asset-card .btn-return');
  await page.waitFor(dialogOpen);
  await page.press('Escape');
  await page.waitFor(`!${dialogOpen}`);

  await page.click('.asset-card .btn-return');
  await page.waitFor(dialogOpen);
  await page.eval('document.getElementById("return-dialog").dispatchEvent(new MouseEvent("click", { bubbles: true }))');
  await page.waitFor(`!${dialogOpen}`);

  assert.deepEqual(await cards(), before);
  assert.equal((await (await app.get('/api/checkouts')).json()).length, 3);
});

test('returning an item removes its card', { skip }, async () => {
  await page.click('.asset-card .btn-return');
  await page.waitFor(dialogOpen);
  await page.click('#return-confirm');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 2');
  assert.match(await page.text('#toast'), /returned successfully\.$/);
});

test('returning an item that was already returned elsewhere refreshes the list', { skip }, async () => {
  for (const item of await (await app.get('/api/checkouts')).json()) {
    await app.post(`/api/checkouts/${item.id}/return`); // e.g. from another tab
  }
  await page.click('.asset-card .btn-return');
  await page.waitFor(dialogOpen);
  await page.click('#return-confirm');
  await page.waitFor('document.getElementById("toast").className.includes("error")');
  assert.match(await page.text('#toast'), /not checked out/);
  await page.waitFor('document.getElementById("asset-list").textContent.includes("All assets returned")');
});

test('the admin page shows the history, stats and Excel status, and saves the Excel file', { skip }, async () => {
  await page.goto(`${app.base}/admin.html`);
  await page.waitFor('document.querySelectorAll("#log-body tr td.td-asset").length === 3');
  assert.equal(await page.text('#stat-active'), '0');
  assert.equal(await page.text('#stat-total'), '3');
  assert.equal(await page.text('#stat-today'), '3');
  assert.match(await page.text('#daily-body'), /No assets currently checked out/);
  await page.waitFor('document.getElementById("excel-status").textContent.startsWith("Excel file: saved at")');

  await page.click('#btn-save');
  await page.waitFor('document.getElementById("toast").textContent.startsWith("Saved to ")');

  await page.click('#log-table th[data-sort="asset"] button');
  const sorted = await page.eval('[...document.querySelectorAll("#log-body td.td-asset")].map((td) => td.textContent)');
  assert.deepEqual(sorted, ['OPS-1234', 'PROJECTOR 2', 'RSI-<B>9</B>']);
  await page.click('#log-table th[data-sort="asset"] button');
  assert.equal(await page.eval('document.querySelector("#log-body td.td-asset").textContent'), 'RSI-<B>9</B>');
  assert.equal(await page.text('#log-table th[data-sort="asset"] .sort-arrow'), '↓');

  assert.equal(await page.eval('document.getElementById("btn-download").getAttribute("href")'), '/api/export');
});

test('a note can be added on the admin page', { skip }, async () => {
  const asset = await page.text('#log-body td.td-asset');
  await page.click('#log-body .note-button');
  await page.waitFor('document.activeElement?.className === "note-input"');
  await page.type('#log-body .note-input', 'Screen cracked');
  await page.eval('document.querySelector("#log-body .note-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))');
  await page.waitFor('document.getElementById("toast").textContent === "Note saved."');
  assert.equal(await page.text('#log-body .note-button'), 'Screen cracked');
  const saved = (await (await app.get('/api/history')).json()).find((r) => r.asset === asset);
  assert.equal(saved.note, 'Screen cracked');

  // Escape leaves the note as it was.
  await page.click('#log-body .note-button');
  await page.type('#log-body .note-input', 'something else');
  await page.eval('document.querySelector("#log-body .note-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
  assert.equal(await page.text('#log-body .note-button'), 'Screen cracked');
});

test('sorting ignores capitals and puts numbers in order', { skip }, async () => {
  for (const [name, asset] of [['zz baker', 'TAG-10'], ['ZZ Adams', 'TAG-9'], ['zz Carter', 'TAG-100']]) {
    app.store.checkIn(app.store.checkOut({ name, asset, location: 'Room 1' }).id);
  }
  await page.click('#btn-refresh');
  await page.type('#log-search', 'zz');
  await page.waitFor('document.querySelectorAll("#log-body td.td-asset").length === 3');

  await page.click('#log-table th[data-sort="name"] button');
  assert.deepEqual(await logColumn('td-name'), ['ZZ Adams', 'zz baker', 'zz Carter']);
  await page.click('#log-table th[data-sort="asset"] button');
  assert.deepEqual(await logColumn('td-asset'), ['TAG-9', 'TAG-10', 'TAG-100']);
  await page.type('#log-search', '');
});

test('long tables are shown a page at a time', { skip }, async () => {
  for (let i = 1; i <= 120; i++) {
    app.store.checkIn(app.store.checkOut({ name: `Customer ${i}`, asset: `PG-${i}`, location: 'Room 2' }).id);
  }
  await page.click('#btn-refresh');
  await page.waitFor('document.getElementById("log-count").textContent === "126 records"');
  const rows = () => page.eval('document.querySelectorAll("#log-body tr").length');
  const disabled = (step) => page.eval(`document.querySelector('#log-pager [data-page="${step}"]').disabled`);

  assert.equal(await rows(), 50);
  assert.equal(await page.text('#log-shown'), '1–50 of 126');
  assert.equal(await page.text('#log-page'), 'Page 1 of 3');
  assert.equal(await disabled(-1), true);
  await page.click('#log-pager [data-page="1"]');
  assert.equal(await page.text('#log-shown'), '51–100 of 126');
  await page.click('#log-pager [data-page="1"]');
  assert.equal(await page.text('#log-shown'), '101–126 of 126');
  assert.equal(await rows(), 26);
  assert.equal(await disabled(1), true);
  await page.click('#log-pager [data-page="-1"]');
  assert.equal(await page.text('#log-page'), 'Page 2 of 3');

  // A refresh stays on the same page.
  app.store.checkIn(app.store.checkOut({ name: 'Customer 121', asset: 'PG-121', location: 'Room 2' }).id);
  await page.click('#btn-refresh');
  await page.waitFor('document.getElementById("log-count").textContent === "127 records"');
  assert.equal(await page.text('#log-shown'), '51–100 of 127');

  // The filter covers every page, and starts again from the first.
  await page.type('#log-search', 'pg-12');
  assert.deepEqual((await logColumn('td-asset')).sort(), ['PG-12', 'PG-120', 'PG-121']);
  assert.equal(await page.text('#log-shown'), '1–3 of 3');
  assert.equal(await page.eval('document.getElementById("log-pager").hidden'), true);
  await page.type('#log-search', '');

  // A table that fits on one page has no Prev and Next.
  assert.equal(await page.eval('document.getElementById("daily-pager").hidden'), true);
});

test('the pages ran without errors or blocked content', { skip }, () => {
  // The API refusal the tests above caused on purpose (already returned).
  const expected = [/status of 404 .*\(\/api\/checkouts\/[^/]+\/return\)$/];
  assert.deepEqual(page.problems.filter((p) => !expected.some((e) => e.test(p))), []);
});
