import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function loadDotEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvFile();

const port = process.env.PORT || '3000';
const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
const url = `${base}/docs`;
const command =
  os.platform() === 'win32'
    ? `cmd /c start "" "${url}"`
    : os.platform() === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

console.log(`Swagger UI: ${url}`);
exec(command, (error) => {
  if (error) {
    console.error('Could not open the browser. Open this URL manually:', url);
    process.exitCode = 1;
  }
});
