// Bundle the app into single-file pages:
//   dist/index.html     – complete page, works offline / anywhere (open it or host it)
//   dist/artifact.html  – the same page body without <html>/<head>, for hosts that
//                         wrap pages themselves
// Usage: npm install && npm run build
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pick = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error('marker missing: ' + a);
  return html.slice(i + a.length, j).trim();
};
const keep = pick('<!-- BUILD:KEEP-START -->', '<!-- BUILD:KEEP-END -->');
let body = pick('<!-- BUILD:BODY-START -->', '<!-- BUILD:BODY-END -->');

const res = await esbuild.build({
  entryPoints: [path.join(root, 'src', 'app.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tag = '<script type="module" src="./src/app.js"></script>';
if (!body.includes(tag)) throw new Error('module script tag not found');
body = body.replace(tag, () => `<script>\n${js}</script>`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), `${keep}\n${body}\n`);
fs.writeFileSync(path.join(root, 'dist', 'index.html'),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${keep}\n</head>\n<body>\n${body}\n</body>\n</html>\n`);
const kb = (f) => (fs.statSync(path.join(root, 'dist', f)).size / 1024).toFixed(0) + ' KB';
console.log('dist/index.html', kb('index.html'), ' dist/artifact.html', kb('artifact.html'));
