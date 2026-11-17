// Drives a headless Chrome, Chromium or Edge through the DevTools protocol, using only Node's
// built-in WebSocket and fetch. Used by ui.test.js, which is skipped if no browser is installed.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tempDir } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const finder = process.platform === 'win32' ? 'where' : 'which';
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge']) {
    const found = spawnSync(finder, [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0];
  }
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync) ?? null;
}

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

export async function launchBrowser(executable) {
  const profile = tempDir();
  const port = await freePort();
  const proc = spawn(executable, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 100 && !targets; i++) {
    await sleep(100);
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => null);
  }
  if (!targets) throw new Error('the browser did not start');
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  // Anything that went wrong in the page: uncaught errors, console.error, and blocked content
  // (e.g. a Content-Security-Policy violation).
  const problems = [];
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    const p = message.params;
    if (message.method === 'Runtime.exceptionThrown') problems.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && p.type === 'error') problems.push(p.args.map((a) => a.value ?? a.description).join(' '));
    if (message.method === 'Log.entryAdded' && p.entry.level === 'error') {
      problems.push(p.entry.url ? `${p.entry.text} (${new URL(p.entry.url).pathname})` : p.entry.text);
    }
    for (const listener of listeners) listener(message);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const nextEvent = (method) => new Promise((resolve) => {
    const listener = (message) => {
      if (message.method === method) {
        listeners.delete(listener);
        resolve(message.params);
      }
    };
    listeners.add(listener);
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  const page = {
    problems,
    async eval(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
    async goto(url) {
      const loaded = nextEvent('Page.loadEventFired');
      await send('Page.navigate', { url });
      await loaded;
    },
    async waitFor(expression, timeout = 5000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await page.eval(expression)) return;
        await sleep(50);
      }
      throw new Error(`timed out waiting for: ${expression}`);
    },
    // A real mouse click in the middle of the element.
    async click(selector) {
      const box = await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      }
    },
    // Replaces a field's text, typed as if from the keyboard.
    async type(selector, text) {
      await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      if (text) await send('Input.insertText', { text });
    },
    text: (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`),
    async close() {
      const exited = new Promise((resolve) => (proc.exitCode !== null ? resolve() : proc.once('exit', resolve)));
      await Promise.race([send('Browser.close').catch(() => {}), sleep(2000)]);
      ws.close();
      const timer = setTimeout(() => proc.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
  return page;
}
