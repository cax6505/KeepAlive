import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const assets = `${root}/dist/assets`;
const files = (await readdir(assets)).filter(name => name.endsWith('.js'));
const application = files.filter(name => !/hls(?:\.light)?[-.]/i.test(name));
const bytes = await Promise.all(application.map(async name => gzipSync(await readFile(`${assets}/${name}`)).length));
const total = bytes.reduce((sum, item) => sum + item, 0);
const kib = (total / 1024).toFixed(2);
console.log(`Application JavaScript gzip (hls.js excluded): ${kib} KiB`);
console.log(`Excluded chunks: ${files.filter(name => !application.includes(name)).join(', ') || '(none)'}`);
if (total >= 250 * 1024) throw new Error(`Application JS must remain under 250 KB gzip; found ${kib} KiB.`);
