import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sessionKey = Number(process.argv[2] || 9126);
const outputDir = `${root}/src/data/raw/f1-${sessionKey}`;
await mkdir(outputDir, { recursive: true });

// One-time data preparation. The app itself only imports the generated JSON.
for (const endpoint of ['race_control', 'pit', 'laps', 'position']) {
  const url = `https://api.openf1.org/v1/${endpoint}?session_key=${sessionKey}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
  const data = await response.json();
  await writeFile(`${outputDir}/${endpoint}.json`, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${endpoint}: ${data.length} rows`);
}
console.log(`Saved OpenF1 session ${sessionKey} to ${outputDir}`);
