const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chooseVideo, chooseOutputFolder } = require('./lib/dialogs');
const { validateStarts, exportClips } = require('./lib/clipping');
const { probe } = require('./lib/media');
const { analyze } = require('./lib/detection');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3333;
const PUBLIC = path.join(__dirname, 'public');
let selected = null;
let selectionVersion = 0;
let analysisBusy = false;
let exportJob = null;
let exportBusy = false;

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function fail(res, err) {
  console.error(err);
  json(res, 500, { error: err.message || 'Unexpected error' });
}
async function video(req, res) {
  if (!selected) return json(res, 404, { error: 'No video selected' });
  const filepath = selected.path;
  const stat = await fs.promises.stat(filepath);
  const size = stat.size;
  const type = path.extname(filepath).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4';
  const range = req.headers.range;
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end();
    }
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    } else {
      const suffix = Number(match[2]);
      start = Math.max(0, size - suffix);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || end < 0) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end();
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  } else {
    res.writeHead(200, { 'Content-Length': size });
  }
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filepath, { start, end });
  stream.on('error', err => { console.error(err); res.destroy(err); });
  stream.pipe(res);
}
async function readJson(req) {
  const parts = [];
  let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > 8192) { const err = new Error('Request too large.'); err.status = 413; throw err; }
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); }
  catch { const err = new Error('Invalid JSON.'); err.status = 400; throw err; }
}
async function handler(req, res) {
  // Same-origin browser requests only; this service is strictly loopback-bound.
  const origin = req.headers.origin;
  if (origin && origin !== `http://${HOST}:${PORT}` && origin !== `http://localhost:${PORT}`) {
    return json(res, 403, { error: 'Forbidden origin' });
  }
  const pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
  if (pathname === '/api/select' && req.method === 'POST') {
    if (exportBusy) return json(res, 409, { error: 'Export in progress.' });
    const filepath = await chooseVideo();
    if (!filepath) return json(res, 200, { canceled: true });
    const metadata = await probe(filepath);
    // Commit only after successful probing.
    selected = { path: filepath, name: path.basename(filepath), metadata };
    selectionVersion++;
    return json(res, 200, { name: selected.name, metadata });
  }
  if (pathname === '/api/analyze' && req.method === 'POST') {
    if (exportBusy) return json(res, 409, { error: 'Export in progress.' });
    if (!selected) return json(res, 400, { error: 'Select a video first.' });
    if (analysisBusy) return json(res, 409, { error: 'Analysis already in progress.' });
    // Reject unexpectedly large request bodies; analysis only needs small numeric settings.
    const parts = [];
    let length = 0;
    for await (const part of req) {
      length += part.length;
      if (length > 8192) return json(res, 413, { error: 'Request too large.' });
      parts.push(part);
    }
    let settings;
    try { settings = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); }
    catch { return json(res, 400, { error: 'Invalid settings JSON.' }); }
    const current = selected;
    const version = selectionVersion;
    analysisBusy = true;
    try {
      const result = await analyze(current.path, current.metadata, settings);
      if (version !== selectionVersion) return json(res, 409, { error: 'Selected video changed. Analyze again.' });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: err.message });
    } finally { analysisBusy = false; }
  }
  if (pathname === '/api/export' && req.method === 'POST') {
    if (!selected) return json(res, 400, { error: 'Select a video first.' });
    if (exportBusy || analysisBusy) return json(res, 409, { error: 'Another operation is in progress.' });
    let clips;
    try {
      const body = await readJson(req);
      clips = validateStarts(body.starts, selected.metadata.duration);
    } catch (err) { return json(res, err.status || 400, { error: err.message }); }
    exportBusy = true; // Lock selection while the native picker is open.
    try {
      const folder = await chooseOutputFolder();
      if (!folder) { exportBusy = false; return json(res, 200, { canceled: true }); }
      const current = selected;
      const id = String(Date.now());
      exportJob = { id, state: 'running', total: clips.length, completed: 0, current: null, folder, error: null };
      // Export asynchronously; browser polls for progress.
      exportClips(current.path, folder, clips, update => Object.assign(exportJob, update))
        .then(() => { exportJob.state = 'complete'; })
        .catch(error => { console.error(error); exportJob.state = 'error'; exportJob.error = error.message; })
        .finally(() => { exportBusy = false; });
      return json(res, 200, { id, total: clips.length });
    } catch (err) { exportBusy = false; return json(res, 400, { error: err.message }); }
  }
  if (pathname === '/api/export-status' && req.method === 'GET') {
    return json(res, 200, exportJob || { state: 'idle' });
  }
  if (pathname === '/api/video-info' && req.method === 'GET') {
    return json(res, 200, selected ? { name: selected.name, metadata: selected.metadata } : { selected: false });
  }
  if (pathname === '/api/video' && (req.method === 'GET' || req.method === 'HEAD')) return video(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
  const staticFiles = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js' };
  const filename = staticFiles[pathname];
  if (!filename) return json(res, 404, { error: 'Not found' });
  const contents = await fs.promises.readFile(path.join(PUBLIC, filename));
  res.writeHead(200, { 'Content-Type': mime[path.extname(filename)], 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : contents);
}
const server = http.createServer((req, res) => Promise.resolve(handler(req, res)).catch(err => fail(res, err)));
server.listen(PORT, HOST, () => console.log(`Concert Clipper running at http://${HOST}:${PORT}`));
