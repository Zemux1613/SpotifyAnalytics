// Prüft, ob der generierte Angular-API-Client jede Operation aus
// backend/openapi.json als Service-Methode enthält.
//
// Aufruf (aus dem frontend/-Ordner):
//   node scripts/check-api-routes.mjs
//   node scripts/check-api-routes.mjs ../backend/openapi.json src/app/api/generated/api

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const specPath = process.argv[2] ?? '../backend/openapi.json';
const generatedDir = process.argv[3] ?? 'src/app/api/generated/api';

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

// openapi-generator (typescript-angular) macht aus dem operationId eine
// camelCase-Methode, z.B. get_top_me_top__item_type__get -> getTopMeTopItemTypeGet
function toMethodName(operationId) {
  return operationId
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('');
}

let spec;
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8'));
} catch (error) {
  console.error(`OpenAPI-Spec konnte nicht gelesen werden (${specPath}): ${error.message}`);
  process.exit(1);
}

let serviceSources;
try {
  serviceSources = readdirSync(generatedDir)
    .filter((file) => file.endsWith('.service.ts'))
    .map((file) => readFileSync(join(generatedDir, file), 'utf8'))
    .join('\n');
} catch (error) {
  console.error(
    `Generierte Services konnten nicht gelesen werden (${generatedDir}): ${error.message}`,
  );
  process.exit(1);
}

const problems = [];
let checkedOperations = 0;

for (const [path, operations] of Object.entries(spec.paths ?? {})) {
  for (const [method, operation] of Object.entries(operations)) {
    if (!HTTP_METHODS.has(method)) continue;

    checkedOperations += 1;
    const label = `${method.toUpperCase()} ${path}`;

    if (!operation.operationId) {
      problems.push(`${label}: operationId fehlt in der OpenAPI-Spec`);
      continue;
    }

    const methodName = toMethodName(operation.operationId);
    const pattern = new RegExp(`public\\s+${methodName}\\s*\\(`);
    if (!pattern.test(serviceSources)) {
      problems.push(`${label}: Methode ${methodName}() fehlt im generierten Client`);
    }
  }
}

if (checkedOperations === 0) {
  console.error('Die OpenAPI-Spec enthält keine Operationen – das sieht falsch aus.');
  process.exit(1);
}

if (problems.length > 0) {
  console.error('Folgende Backend-Routen fehlen im generierten Frontend-Client:');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(
  `OK: Alle ${checkedOperations} Operationen aus ${specPath} sind im generierten Client vorhanden.`,
);
