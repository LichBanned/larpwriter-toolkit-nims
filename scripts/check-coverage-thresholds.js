#!/usr/bin/env node
/**
 * Read c8/istanbul coverage-final.json (or coverage/tmp v8 dumps via c8 report)
 * and enforce per-scope line/branch thresholds from the Docker test plan.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(process.cwd(), 'coverage');
const finalPath = path.join(root, 'coverage-final.json');

function loadMap() {
  if (fs.existsSync(finalPath)) {
    return JSON.parse(fs.readFileSync(finalPath, 'utf8'));
  }
  // Fall back: ask c8 to emit coverage-final by scanning reports-dir html isn't enough.
  throw new Error(`Missing ${finalPath}. Run c8 with --reporter=json`);
}

function pct(covered, total) {
  if (!total) return 100;
  return (100 * covered) / total;
}

function summarize(map, matchFn) {
  let s = 0; let sc = 0;
  let b = 0; let bc = 0;
  let f = 0; let fc = 0;
  for (const [file, data] of Object.entries(map)) {
    const norm = file.replace(/\\/g, '/');
    if (!matchFn(norm)) continue;
    const stmtMap = data.s || {};
    for (const k of Object.keys(stmtMap)) {
      s += 1;
      if (stmtMap[k] > 0) sc += 1;
    }
    const branchMap = data.b || {};
    for (const k of Object.keys(branchMap)) {
      const arr = branchMap[k] || [];
      for (const hit of arr) {
        b += 1;
        if (hit > 0) bc += 1;
      }
    }
    const fnMap = data.f || {};
    for (const k of Object.keys(fnMap)) {
      f += 1;
      if (fnMap[k] > 0) fc += 1;
    }
  }
  return {
    lines: pct(sc, s),
    statements: pct(sc, s),
    branches: pct(bc, b),
    functions: pct(fc, f),
    files: Object.keys(map).filter((f) => matchFn(f.replace(/\\/g, '/'))).length,
  };
}

const scopes = [
  {
    name: 'nims-dbms/pg',
    lines: 70,
    branches: 55,
    match: (f) => /\/packages\/nims-dbms\/pg\//.test(f) || /nims-dbms\/pg\//.test(f),
  },
  {
    name: 'nims-server/pg',
    lines: 65,
    branches: 50,
    match: (f) => /\/packages\/nims-server\/pg\//.test(f) || /nims-server\/pg\//.test(f),
  },
  {
    name: 'permissionProxy',
    lines: 75,
    branches: 60,
    match: (f) => /permissionProxy\.js$/.test(f),
  },
  {
    name: 'requestProcessing+auth',
    lines: 60,
    branches: 45,
    match: (f) => /requestProcessing\.js$/.test(f) || /routes\/auth\.js$/.test(f),
  },
];

const map = loadMap();
let failed = 0;
for (const scope of scopes) {
  const s = summarize(map, scope.match);
  const okL = s.lines + 1e-9 >= scope.lines;
  const okB = s.branches + 1e-9 >= scope.branches;
  const mark = okL && okB ? '✓' : '✗';
  console.log(
    `${mark} ${scope.name}: lines ${s.lines.toFixed(2)}% (need ≥${scope.lines}) `
    + `branches ${s.branches.toFixed(2)}% (need ≥${scope.branches}) [${s.files} files]`,
  );
  if (!okL || !okB) failed += 1;
}
if (failed) {
  process.exit(1);
}
console.log('coverage thresholds OK');
