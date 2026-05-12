import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ALLOWED_RUNTIME_DEPS = new Set(['zod']);

const pkgPath = resolve('packages/core/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const runtimeDeps = Object.keys(pkg.dependencies ?? {});
const offenders = runtimeDeps.filter(d => !ALLOWED_RUNTIME_DEPS.has(d));

if (offenders.length > 0) {
  console.error(
    `packages/core must not depend on anything except [${[...ALLOWED_RUNTIME_DEPS].join(', ')}]. ` +
    `Found: ${offenders.join(', ')}`
  );
  process.exit(1);
}

console.log('packages/core deps OK');
