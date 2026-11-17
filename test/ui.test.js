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
const cards = () => page.eval('[...document.querySelectorAll(".asset-card")].map((c) => c.querySelector(".card-asset").textContent)');

test('checking out from the form shows a card with the asset and customer', { skip }, async () => {
  await page.goto(`${app.base}/`);
  await page.waitFor('document.getElementById("location-name").textContent === "Test Location"');
  await page.waitFor('document.getElementById("asset-list").textContent.includes("All assets returned")');

  await page.type('#f-user', 'Jane Doe');
  await page.type('#f-asset', 'ops-1234 csd');
  await page.type('#f-location', 'Courtroom 3');
  await page.click('#submit-btn');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 1');

  assert.equal(await page.text('#toast'), 'OPS-1234 checked out successfully.');
  assert.deepEqual(await cards(), ['OPS-1234']);
  const rows = await page.eval('[...document.querySelectorAll(".card-row")].map((r) => r.innerText.replace(/\\s+/g, " ").trim())');
  assert.equal(rows[0], 'USER Jane Doe');
  assert.equal(rows[1], 'LOCATION Courtroom 3');
  assert.match(rows[2], /^SINCE [A-Z]{3} \d+/);
  assert.equal(await page.eval('document.getElementById("f-user").value'), '');
  assert.equal(await page.text('#count'), '1');
});

test('a wrong asset number is explained and nothing is checked out', { skip }, async () => {
  await page.type('#f-user', 'Sam');
  await page.type('#f-asset', 'LAPTOP-1');
  await page.type('#f-location', 'Room 1');
  await page.click('#submit-btn');
  await page.waitFor('document.getElementById("toast").className.includes("error")');
  assert.match(await page.text('#toast'), /must start with 'OPS-' or 'RSI-'/);
  assert.equal((await cards()).length, 1);
});

test('typed text is always shown as text, never run as HTML', { skip }, async () => {
  await page.type('#f-user', '<img src=x onerror="window.hacked=1">');
  await page.type('#f-asset', 'RSI-<b>9</b>');
  await page.type('#f-location', '"><script>window.hacked=1</script>');
  await page.click('#submit-btn');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 2');
  assert.equal(await page.eval('document.querySelectorAll("#asset-list img, #asset-list b, #asset-list script").length'), 0);
  assert.equal(await page.eval('window.hacked ?? null'), null);
  assert.ok((await cards()).includes('RSI-<B>9</B>'));
});

test('searching filters the cards', { skip }, async () => {
  await page.type('#search', 'courtroom');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 1');
  await page.type('#search', 'nothing like this');
  await page.waitFor('document.getElementById("asset-list").textContent.includes("No matching assets")');
  await page.type('#search', '');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 2');
});

test('returning an item removes its card', { skip }, async () => {
  await page.click('.asset-card .btn-return');
  await page.waitFor('document.querySelectorAll(".asset-card").length === 1');
  assert.match(await page.text('#toast'), /returned successfully\.$/);
});

test('returning an item that was already returned elsewhere refreshes the list', { skip }, async () => {
  const [item] = await (await app.get('/api/checkouts')).json();
  await app.post(`/api/checkouts/${item.id}/return`); // e.g. from another tab
  await page.click('.asset-card .btn-return');
  await page.waitFor('document.getElementById("toast").className.includes("error")');
  assert.match(await page.text('#toast'), /not checked out/);
  await page.waitFor('document.getElementById("asset-list").textContent.includes("All assets returned")');
});

test('the admin page shows the history, stats and Excel status, and saves to the server', { skip }, async () => {
  await page.goto(`${app.base}/admin.html`);
  await page.waitFor('document.querySelectorAll("#log-body tr td.td-asset").length === 2');
  assert.equal(await page.text('#stat-active'), '0');
  assert.equal(await page.text('#stat-total'), '2');
  assert.equal(await page.text('#stat-today'), '2');
  assert.match(await page.text('#daily-body'), /No assets currently checked out/);
  await page.waitFor('document.getElementById("excel-status").textContent.startsWith("Excel copy: saved at")');

  await page.click('#btn-save');
  await page.waitFor('document.getElementById("toast").textContent.startsWith("Saved to ")');

  await page.click('#log-table th[data-sort="asset"] button');
  const sorted = await page.eval('[...document.querySelectorAll("#log-body td.td-asset")].map((td) => td.textContent)');
  assert.deepEqual(sorted, ['OPS-1234', 'RSI-<B>9</B>']);
  await page.click('#log-table th[data-sort="asset"] button');
  assert.equal(await page.eval('document.querySelector("#log-body td.td-asset").textContent'), 'RSI-<B>9</B>');
  assert.equal(await page.text('#log-table th[data-sort="asset"] .sort-arrow'), '↓');

  assert.equal(await page.eval('document.getElementById("btn-download").getAttribute("href")'), '/api/export');
});

test('the pages ran without errors or blocked content', { skip }, () => {
  // The API refusals the tests above caused on purpose (bad asset, already returned).
  const expected = [/status of 400 .*\(\/api\/checkouts\)$/, /status of 404 .*\(\/api\/checkouts\/[^/]+\/return\)$/];
  assert.deepEqual(page.problems.filter((p) => !expected.some((e) => e.test(p))), []);
});
