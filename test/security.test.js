// Only this computer's browser, on this program's own pages, can use the program.

import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { startApp } from './helpers.js';

// fetch() won't let a test set the Host header, so use http.request.
function rawRequest(app, { method = 'GET', path = '/', headers = {}, body, setHost = true } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${app.base}${path}`, { method, headers, setHost }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('requests addressed to another name are refused (DNS rebinding)', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const { port } = app.server.address();
  for (const host of ['evil.example', `evil.example:${port}`, 'localhost:1']) {
    const res = await rawRequest(app, { path: '/api/checkouts', headers: { Host: host } });
    assert.equal(res.status, 403, host);
  }
  // No Host header at all (HTTP/1.0 style). Node answers that one with 400 before the app sees it.
  const noHost = await rawRequest(app, { path: '/api/checkouts', setHost: false });
  assert.ok([400, 403].includes(noHost.status), String(noHost.status));
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
    assert.equal((await rawRequest(app, { path: '/api/checkouts', headers: { Host: host } })).status, 200, host);
  }
});

test('changes sent from another website are refused', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const json = JSON.stringify({ name: 'A', asset: 'OPS-1', location: 'B' });

  const fromOtherSite = await rawRequest(app, {
    method: 'POST', path: '/api/checkouts', body: json,
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
  });
  assert.equal(fromOtherSite.status, 403);

  // What a plain HTML form on another site can send: not JSON.
  for (const type of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=x']) {
    const res = await rawRequest(app, { method: 'POST', path: '/api/checkouts', body: json, headers: { 'Content-Type': type } });
    assert.equal(res.status, 415, type);
  }
  const noType = await rawRequest(app, { method: 'POST', path: '/api/excel/save' });
  assert.equal(noType.status, 415);

  const fromOwnPage = await rawRequest(app, {
    method: 'POST', path: '/api/checkouts', body: json,
    headers: { 'Content-Type': 'application/json', Origin: app.base },
  });
  assert.equal(fromOwnPage.status, 201);
  assert.equal((await (await app.get('/api/checkouts')).json()).length, 1);
});

test('oversized requests are refused', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const res = await app.post('/api/checkouts', { name: 'x'.repeat(20_000), asset: 'OPS-1', location: 'B' });
  assert.equal(res.status, 413);
});

test('only the files in public/ are served, with security headers', async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  for (const [path, type] of [['/', 'text/html'], ['/index.html', 'text/html'], ['/admin.html', 'text/html'], ['/admin', 'text/html'],
    ['/style.css', 'text/css'], ['/checkout.js', 'text/javascript'], ['/admin.js', 'text/javascript'], ['/common.js', 'text/javascript']]) {
    const res = await app.get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), new RegExp(type), path);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  }

  for (const path of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver.js', '/server.js', '/lib/app.js',
    '/checkouts.db', '/config.json', '/public/index.html', '/node_modules/exceljs/package.json', '/api/nope']) {
    const res = await rawRequest(app, { path });
    assert.equal(res.status, 404, path);
  }
});

test('the API is never cached, and errors do not leak server details', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const res = await app.get('/api/checkouts');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);

  // A database failure: the reply says nothing was saved, and nothing about why.
  app.store.db.exec('ALTER TABLE daily RENAME TO daily_gone');
  const failed = await app.post('/api/checkouts', { name: 'A', asset: 'OPS-1', location: 'B' });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'Something went wrong on the server, so nothing was saved. Please try again.' });
  assert.ok(app.log.lines.some((l) => l.includes('daily')));
  app.store.db.exec('ALTER TABLE daily_gone RENAME TO daily');
});
