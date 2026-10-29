import JSZip from 'jszip';
import { outputName } from './options.js';

export async function createArchive(entries) {
  if (!entries.length) throw new Error('没有可下载的结果');
  const zip = new JSZip(), used = new Set(), reports = [];
  for (const entry of entries) {
    const requested = outputName(entry.name, entry.report.format);
    let name = requested, index = 2;
    while (used.has(name.toLowerCase())) name = requested.replace(/(\.[^.]+)$/, `_${index++}$1`);
    used.add(name.toLowerCase());
    zip.file(name, entry.buffer);
    reports.push({ source: entry.name, output: name, ...entry.report });
  }
  zip.file('verification.json', JSON.stringify(reports, null, 2));
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}
