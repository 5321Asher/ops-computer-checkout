// Reads config.json from the program's folder. setup.ps1 writes it when the program is installed:
//   { "location": "46 Water Street" }
// location is shown at the top of the pages. Without config.json the program still runs; it just
// shows no location.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripBom } from './files.js';

export class ConfigError extends Error {}

export function loadConfig(dir) {
  let text;
  try {
    text = readFileSync(join(dir, 'config.json'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { location: '' };
    throw new ConfigError(`config.json could not be read: ${err.message}`);
  }

  let config;
  try {
    config = JSON.parse(stripBom(text));
  } catch (err) {
    throw new ConfigError(`config.json is not valid JSON: ${err.message}. It should look like { "location": "46 Water Street" }.`);
  }
  return { location: typeof config?.location === 'string' ? config.location.trim() : '' };
}
