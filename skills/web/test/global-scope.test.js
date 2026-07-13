const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- card #60: one browser global scope, unique top-level names ---------------
// Every web/*.js loads as a plain <script> into ONE page scope (app.html), so
// two files declaring the same top-level const/let/class kill the LATER file
// at parse ("Identifier 'X' has already been declared") and a duplicate
// var/function silently overwrites the earlier one. The require()-based unit
// tests can never see either failure — require() gives each file its own
// scope — which is exactly how the CAL collision (gantt-model.js vs
// date-picker.js) shipped and left every 📅 button dead. These tests close
// the blind spot class two ways: scan every web/*.js for top-level
// const/let/var/function/class names and assert cross-file uniqueness, and
// ban `var` outright (a var inside a top-level block — every file's export
// tail is one — hoists to page scope where the depth-gated scan can't see it).

// Blank out comments and string/template/regex literal CONTENTS (newlines
// kept, so nothing shifts lines) so the declaration walk below can track
// bracket depth and spot keywords without being fooled by quoted text. Not a
// parser — a scanner with the classic last-significant-char heuristic for
// regex-vs-division, which covers everything these classic scripts do.
function blankNonCode(src) {
  let out = '';
  let i = 0;
  let last = ';'; // last significant char kept — drives the regex heuristic
  const tpl = []; // curly depths where an open `${` began (templates nest)
  let curly = 0;
  let mode = 'code'; // 'code' | 'tpl'
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { mode = 'code'; out += '"'; last = '"'; i++; continue; }
      if (c === '$' && n === '{') { tpl.push(curly); mode = 'code'; i += 2; continue; }
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    if (c === '/' && n === '/') { // line comment
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') { // block comment
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') { // string literal
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      out += '"'; // placeholder: an expression ended here (so a next / divides)
      last = '"';
      continue;
    }
    if (c === '`') { mode = 'tpl'; i++; continue; }
    if (c === '/' && !/[A-Za-z0-9_$)\]"]/.test(last)) {
      // a slash in expression position = regex literal; skip it whole,
      // character classes and all (a / inside [...] does not close it)
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++; // closing slash
      while (i < src.length && /[a-z]/i.test(src[i])) i++; // flags
      out += '"';
      last = '"';
      continue;
    }
    if (c === '{') curly++;
    if (c === '}') {
      if (tpl.length && curly === tpl[tpl.length - 1]) { tpl.pop(); mode = 'tpl'; i++; continue; }
      curly--;
    }
    out += c;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out;
}

// The names a classic <script> adds to the shared page scope: top-level
// const/let/var/function/class declarations. Depth tracking keeps function
// bodies, blocks, and for-heads out; the statement-position check keeps
// function/class EXPRESSIONS (const f = function g() {...}) out — g is not a
// global. Top-level destructuring throws loudly rather than being silently
// missed: gantt-model.js documents why shared-scope scripts avoid it, and a
// scanner blind spot is this card's whole disease.
function topLevelDeclarations(src) {
  const code = blankNonCode(src);
  const tokens = code.match(/[A-Za-z_$][A-Za-z0-9_$]*|[(){}[\]]|[;,=]|[^\sA-Za-z_$(){}[\];,=]+/g) || [];
  const names = [];
  let depth = 0;
  let prev = ''; // previous token — statement-position + async-function checks
  let state = null; // null | 'expectName' (after decl keyword or declarator comma) | 'inDecl'
  let fnName = false; // the next identifier names a function/class declaration
  for (const tok of tokens) {
    if (tok === '(' || tok === '[' || tok === '{') {
      if (state === 'expectName') throw new Error('top-level destructuring declaration — scanner cannot name it; declare plain identifiers in shared-scope scripts');
      depth++;
      prev = tok;
      continue;
    }
    if (tok === ')' || tok === ']' || tok === '}') { depth--; prev = tok; continue; }
    if (depth === 0) {
      if (tok === 'const' || tok === 'let' || tok === 'var') {
        state = 'expectName';
        prev = tok;
        continue;
      }
      if ((tok === 'function' || tok === 'class') &&
          (prev === '' || prev === ';' || prev === '}' || (tok === 'function' && prev === 'async'))) {
        fnName = true;
        prev = tok;
        continue;
      }
      if (fnName && /^[A-Za-z_$]/.test(tok)) {
        names.push(tok);
        fnName = false;
        prev = tok;
        continue;
      }
      if (state === 'expectName' && /^[A-Za-z_$]/.test(tok)) {
        names.push(tok);
        state = 'inDecl';
        prev = tok;
        continue;
      }
      if (state === 'inDecl' && tok === ',') state = 'expectName';
      if (state === 'inDecl' && tok === ';') state = null;
    }
    prev = tok;
  }
  return names;
}

const webDir = path.join(__dirname, '..', 'web');
const webFiles = fs.readdirSync(webDir).filter((f) => f.endsWith('.js')).sort();
const readWeb = (f) => fs.readFileSync(path.join(webDir, f), 'utf8');

// --- scanner self-tests: quoted/nested "declarations" must not fool it --------

test('scanner sees only real top-level declarations — not comments, strings, templates, regexes, expressions, or nested scopes (card #60)', () => {
  const src = [
    "'use strict';",
    'const REAL = 1;',
    '// const IN_LINE_COMMENT = 2;',
    '/* let IN_BLOCK_COMMENT = 3; */',
    "const S = 'let IN_STRING = 4;';",
    'const T = `class InTemplate {} ${REAL} tail`;',
    'const R = /const{1,2}[\'"]\\//g;',
    'const F = function hiddenExpressionName() { return 1; };',
    'const A = (n) => { let inner = n / 2; return inner; };',
    'let x = 1, y = 2;',
    'async function af() {}',
    'function real2() { var deep; for (const q of []) {} }',
    'class RealClass {}',
    // depth>0 miss — a REAL blind spot, not a non-case: every web/*.js except
    // app.js ends in a top-level if/else export tail, and a hoisted var inside
    // one would be a page global this scan never collects. The no-var test
    // below closes that hole by construction; this line pins the miss so the
    // limitation stays visible.
    'if (x) { var hoisted = 1; }',
  ].join('\n');
  assert.deepStrictEqual(topLevelDeclarations(src),
    ['REAL', 'S', 'T', 'R', 'F', 'A', 'x', 'y', 'af', 'real2', 'RealClass']);
});

test('scanner refuses top-level destructuring instead of silently missing names (card #60)', () => {
  assert.throws(() => topLevelDeclarations('const { a, b } = thing;'), /destructuring/);
  assert.throws(() => topLevelDeclarations('let [p, q] = pair;'), /destructuring/);
});

// --- card #60 review: vars inside top-level blocks — the scan's one hoisting hole

// The depth gate keeps function/block bodies out, which is right for const/let
// (block-scoped, never page globals) but WRONG for `var`: in a classic script a
// `var` inside a plain top-level block — e.g. the module.exports/window export
// tail every web file but app.js ends in — hoists to page scope, exactly the
// silent-overwrite class this file exists to catch, invisible to the uniqueness
// test above. A brace scanner can't tell function braces from block braces, so
// rather than collect vars at depth (function locals would false-positive),
// forbid `var` in web/ outright — these files are const/let-only anyway.
// (Known residual gap, accepted: a sloppy-mode function DECLARATION inside a
// top-level block also hoists; banning the keyword would flag every ordinary
// nested helper, and none exist in blocks today.)

test('the no-var rule catches the export-tail blind spot the declaration scan cannot (card #60)', () => {
  const src = 'if (typeof module !== "undefined") { module.exports = 1; } else { var SNEAKY = 1; }';
  assert.ok(!topLevelDeclarations(src).includes('SNEAKY'), 'depth-gated scan misses a var in a block — why the ban exists');
  const tokens = blankNonCode(src).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  assert.ok(tokens.includes('var'), 'the raw token scan does see it');
});

test('web/*.js never declare with `var` — inside a top-level block it hoists to page scope, invisibly to the uniqueness scan (card #60)', () => {
  for (const file of webFiles) {
    const tokens = blankNonCode(readWeb(file)).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
    assert.ok(!tokens.includes('var'),
      `${file} declares with var — use const/let (a var in any block is a hoisted page global the cross-file scan can't see)`);
  }
});

// --- canary: an empty or broken scan must never pass the uniqueness test ------

test('scanner finds the known declarations in real files — every web/*.js yields at least one (card #60)', () => {
  const dp = topLevelDeclarations(readWeb('date-picker.js'));
  assert.ok(dp.includes('pickDay') && dp.includes('initialMonth'), `date-picker.js scan: ${dp}`);
  const gm = topLevelDeclarations(readWeb('gantt-model.js'));
  assert.ok(gm.includes('CAL') && gm.includes('GANTT_DAY_PX') && gm.includes('barSpan'), `gantt-model.js scan: ${gm}`);
  const app = topLevelDeclarations(readWeb('app.js'));
  assert.ok(app.includes('state') && app.includes('datePickerFor') && app.includes('openDatePicker'), 'app.js scan');
  for (const file of webFiles) {
    assert.ok(topLevelDeclarations(readWeb(file)).length > 0, `${file}: no top-level declarations found — scanner broken?`);
  }
});

// --- the real guard: cross-file uniqueness -------------------------------------

test('top-level declaration names are unique across ALL web/*.js — shared page scope, one namespace (card #60)', () => {
  const owners = new Map(); // name -> [file, ...]
  for (const file of webFiles) {
    for (const name of topLevelDeclarations(readWeb(file))) {
      if (!owners.has(name)) owners.set(name, []);
      owners.get(name).push(file);
    }
  }
  const collisions = [...owners]
    .map(([name, list]) => [name, [...new Set(list)]])
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => `${name}: ${files.join(', ')}`);
  assert.deepStrictEqual(collisions, [],
    'colliding top-level names — the later <script> dies at parse (const/let/class) or silently overwrites (var/function)');
});
