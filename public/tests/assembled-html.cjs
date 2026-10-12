// v3.43: index.html now loads app.css, app.js and notes-workspace.js as separate files.
// Tests that inspect inline code get the page with those files put back inline,
// exactly as it was before the split (same order, same script id).
const fs = require('fs'), path = require('path');
const pub = path.join(__dirname, '..');
module.exports = function assembledHtml() {
  const read = f => fs.readFileSync(path.join(pub, f), 'utf8');
  let html = read('index.html');
  html = html.replace(/<link rel="stylesheet" href="app\.css\?v=[^"]*">\n?/, () => '<style>\n' + read('app.css') + '</style>\n');
  html = html.replace(/<script src="app\.js\?v=[^"]*"><\/script>/, () => '<script>\n' + read('app.js') + '</script>');
  html = html.replace(/<script src="notes-workspace\.js\?v=[^"]*"><\/script>/, () => '<script id="notes-workspace-script">\n' + read('notes-workspace.js') + '</script>');
  return html;
};
