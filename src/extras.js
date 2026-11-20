import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Optional materials used by the advisory report. They are kept separate from
// materials.js so that the original reader contract (three tables) stays intact.
const fieldsByFile = {
  "转介.json": [
    "id",
    "item",
    "toStation",
    "sentAt",
    "basisTurns",
    "excerptTurns",
    "status",
    "arrangement",
    "note"
  ],
  "补充.json": [
    "id",
    "recordedAt",
    "voice",
    "language",
    "heardAt",
    "text"
  ],
  "词表.json": [
    "id",
    "zh",
    "en",
    "topic",
    "note"
  ]
};

const defaultDirectory = new URL('../资料/', import.meta.url);

export async function readExtras(directory = defaultDirectory) {
  const tables = {};
  for (const [name, fields] of Object.entries(fieldsByFile)) {
    let rows;
    try {
      rows = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        tables[name] = [];
        continue;
      }
      throw error;
    }
    if (!Array.isArray(rows)) {
      throw new TypeError(`${name} 应包含 JSON 数组`);
    }
    for (const [index, row] of rows.entries()) {
      if (!row || Array.isArray(row) || typeof row !== 'object' ||
          fields.some(field => typeof row[field] !== 'string')) {
        throw new TypeError(`${name} 第 ${index + 1} 条的字段与资料约定不符`);
      }
    }
    tables[name] = rows;
  }
  return tables;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const tables = await readExtras();
    for (const [name, rows] of Object.entries(tables)) {
      process.stdout.write(`${name} 读取 ${rows.length} 条\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
