import { readMaterials } from './materials.js';
import { readExtras } from './src/extras.js';
import { buildWorkspace, buildReport } from './src/analysis.js';
import { renderReport } from './src/render.js';
import { pathToFileURL } from 'node:url';

export async function loadWorkspace({ materials, extras } = {}) {
  const [base, extra] = await Promise.all([
    materials ? Promise.resolve(materials) : readMaterials(),
    extras ? Promise.resolve(extras) : readExtras()
  ]);
  return buildWorkspace({ ...base, ...extra });
}

export async function analyse(options = {}) {
  const workspace = await loadWorkspace(options);
  return buildReport(workspace);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await analyse();
    process.stdout.write(`${renderReport(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
