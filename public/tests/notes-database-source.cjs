'use strict';
// The Notes database table ships embedded at the top of notes-workspace.js; the
// standalone notes-database.js copy was never loaded by the site. Tests load the
// exact embedded production block instead of a drifting duplicate.
const fs = require('node:fs'), path = require('node:path');
const START = '/* Notes Database Table.';
function source() {
  const text = fs.readFileSync(path.join(__dirname, '..', 'notes-workspace.js'), 'utf8');
  if (!text.startsWith(START)) throw Error('notes-workspace.js no longer starts with the Notes database block');
  const api = text.indexOf('return {isPopupOpen');
  const end = api < 0 ? -1 : text.indexOf('\n});\n', api);
  if (end < 0) throw Error('Cannot find the end of the embedded Notes database block');
  return text.slice(0, end + 4);
}
function load() {
  const module = { exports: {} };
  new Function('module', 'exports', source())(module, module.exports);
  if (!module.exports || typeof module.exports.normalize !== 'function') throw Error('Embedded Notes database did not export its API');
  return module.exports;
}
module.exports = { source, load };
