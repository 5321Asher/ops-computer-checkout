// Reads config.json from the program's folder. setup.ps1 writes it when a location is set up:
//   {
//     "location": "46 Water Street",
//     "locationFolder": "\\\\jus00adc1140\\library\\Scripts\\equipment_checkout_v2\\46-water-street"
//   }
// locationFolder is the location's folder on the share (a full \\server\share path, so it works
// even where Z: isn't mapped). The Excel copy, checkouts.xlsx, and the ticket list,
// ticketList.json, are kept there.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripBom } from './files.js';

export class ConfigError extends Error {}

export function loadConfig(dir) {
  const file = join(dir, 'config.json');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ConfigError(`There is no config.json in ${dir}. Run setup.ps1 from the share to set up this computer, ` +
        'or copy config.example.json to config.json and fill it in (see README.md).');
    }
    throw new ConfigError(`config.json could not be read: ${err.message}`);
  }

  let config;
  try {
    config = JSON.parse(stripBom(text));
  } catch (err) {
    throw new ConfigError(`config.json is not valid JSON: ${err.message}. In JSON, each \\ in a path is written \\\\.`);
  }
  const folder = config?.locationFolder;
  if (typeof folder !== 'string' || !folder.trim()) {
    throw new ConfigError('In config.json, "locationFolder" must be the location\'s folder on the share, ' +
      'for example "\\\\\\\\jus00adc1140\\\\library\\\\Scripts\\\\equipment_checkout_v2\\\\46-water-street".');
  }
  // A relative folder is relative to this program's folder (handy for trying things out).
  const locationFolder = resolve(dir, folder.trim());
  return {
    location: typeof config.location === 'string' ? config.location.trim() : '',
    locationFolder,
    excelPath: join(locationFolder, 'checkouts.xlsx'),
    ticketListPath: join(locationFolder, 'ticketList.json'),
  };
}
