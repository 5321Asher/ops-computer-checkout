// Reads config.json from the program's folder. setup.ps1 writes it:
//   {
//     "location": "46 Water Street",
//     "serverFolder": "\\\\jus00adc1140\\library\\Scripts\\equipment_checkout_v2\\46-water-street"
//   }
// location is shown at the top of the pages. serverFolder is the location's folder on the server,
// where the program keeps the three files RSOs need: the Excel copy (checkouts.xlsx), the ticket
// list (ticketList.json) and createTickets.ps1. Everything else stays on this computer.
// Without serverFolder (or without config.json) those three files are kept in the program's
// folder, which is handy for trying the program out.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripBom } from './files.js';

export class ConfigError extends Error {}

export function loadConfig(dir) {
  let text;
  try {
    text = readFileSync(join(dir, 'config.json'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { location: '', serverFolder: '' };
    throw new ConfigError(`config.json could not be read: ${err.message}`);
  }

  let config;
  try {
    config = JSON.parse(stripBom(text));
  } catch (err) {
    throw new ConfigError(`config.json is not valid JSON: ${err.message}. It should look like ` +
      '{ "location": "46 Water Street", "serverFolder": "\\\\\\\\server\\\\share\\\\46-water-street" } (in JSON, each \\ is written \\\\). ' +
      'Run setup.ps1 again to write it.');
  }
  const folder = config?.serverFolder ?? '';
  if (typeof folder !== 'string') {
    throw new ConfigError('In config.json, "serverFolder" must be the location\'s folder on the server, written as text. Run setup.ps1 again to fix it.');
  }
  return {
    location: typeof config?.location === 'string' ? config.location.trim() : '',
    // A relative folder is relative to the program's folder.
    serverFolder: folder.trim() ? resolve(dir, folder.trim()) : '',
  };
}
