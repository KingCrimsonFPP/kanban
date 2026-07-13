'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const cs = require('./card-store');
const ns = require('./notifications-store');
const cfg = require('./config-store');

const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
// card #31: no server-side status whitelist anymore — free-text statuses are
// legal input end to end (the SPA parks unlisted values in the first column).
// The doing entry gate (waiting + blocked, epic #137) stays pinned to the
// literal 'doing' inside card-store.

function sendJSON(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
  res.end(buf);
}

function serveStatic(res, file) {
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  const body = fs.readFileSync(file);
  // no-store: localhost + tiny files — heuristic caching once served a stale
  // app.html against new scripts and silently broke the form (card #30)
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function createServer(dir) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      // static + board
      if (req.method === 'GET' && p === '/api/board') {
        const active = cs.listActive(dir);
        const archived = cs.listArchived(dir);
        const bad = [...active, ...archived].filter((c) => c.unparseable);
        if (bad.length) console.warn(`[kanban-app] skipping ${bad.length} unparseable card(s): ${bad.map((c) => path.basename(c.file)).join(', ')}`);
        const config = cfg.readConfig(dir); // card #30: one read carries assignees + official lists
        return sendJSON(res, 200, {
          projectName: cs.projectName(dir),
          // card #55: the header copy button copies the board dir's ABSOLUTE
          // path — resolve()d because the CLI defaults dir to the relative
          // 'kanban', and a relative path is useless pasted elsewhere.
          boardDir: path.resolve(dir),
          active: active.filter((c) => !c.unparseable).map(cs.toJSON),
          archived: archived.filter((c) => !c.unparseable).map(cs.toJSON),
          notifications: ns.readNotifications(dir),
          assignees: config.assignees,
          priorities: config.priorities,
          tags: config.tags,
          statuses: config.statuses, // card #31: ordered column list; [] = built-in four
        });
      }
      if (req.method === 'GET' && p === '/') return serveStatic(res, path.join(WEB, 'app.html'));
      if (req.method === 'GET' && (p === '/app.css' || p === '/app.js' || p === '/refresh-policy.js' || p === '/column-state.js' || p === '/column-sort.js' || p === '/search.js' || p === '/waiting-blocked.js' || p === '/dependency-graph.js' || p === '/modal-fullscreen.js' || p === '/assignee-badge.js' || p === '/priority-badge.js' || p === '/combobox.js' || p === '/bulk-edit.js' || p === '/notifications.js' || p === '/form-guard.js' || p === '/selection.js' || p === '/calendar-model.js' || p === '/gantt-model.js' || p === '/date-picker.js' || p === '/status-colors.js')) {
        return serveStatic(res, path.join(WEB, path.basename(p)));
      }

      // notifications (card #22): the file protocol's app-side mutations
      if (req.method === 'POST' && p === '/api/notifications/mark-read') {
        const body = await readBody(req);
        return sendJSON(res, 200, { notifications: ns.markRead(dir, Array.isArray(body.ids) ? body.ids : undefined) });
      }
      const nm = p.match(/^\/api\/notifications(?:\/(\d+))?$/);
      if (nm && req.method === 'DELETE') {
        return sendJSON(res, 200, {
          notifications: nm[1] ? ns.removeNotification(dir, Number(nm[1])) : ns.clearNotifications(dir),
        });
      }

      // mutations
      if (req.method === 'POST' && p === '/api/cards') {
        const body = await readBody(req);
        try {
          return sendJSON(res, 201, cs.toJSON(cs.createCard(dir, body)));
        } catch (e) {
          // epic #137: the 422 names WHICH gate refused — waiting carries the
          // unresolved deps, blocked carries the sticker's reason.
          if (e.name === 'WaitingError') return sendJSON(res, 422, { error: e.message, waiting: e.waiting });
          if (e.name === 'BlockedError') return sendJSON(res, 422, { error: e.message, reason: e.reason });
          throw e;
        }
      }
      const m = p.match(/^\/api\/cards\/(\d+)(\/archive|\/restore|\/detail)?$/);
      if (m) {
        const id = Number(m[1]);
        if (!cs.findCardFile(dir, id)) return sendJSON(res, 404, { error: `no card #${id}` });
        if (req.method === 'GET' && m[2] === '/detail') {
          const detail = cs.cardDetail(dir, id);
          // card #35: file mtime for the popup's "Last modified" fallback when
          // the card predates the `updated` frontmatter field.
          const mtime = fs.statSync(detail.path).mtime.toISOString();
          return sendJSON(res, 200, { ...detail, mtime });
        }
        if (req.method === 'PATCH' && !m[2]) {
          const changes = await readBody(req);
          try {
            return sendJSON(res, 200, cs.toJSON(cs.updateCard(dir, id, changes)));
          } catch (e) {
            if (e.name === 'WaitingError') return sendJSON(res, 422, { error: e.message, waiting: e.waiting });
            if (e.name === 'BlockedError') return sendJSON(res, 422, { error: e.message, reason: e.reason });
            throw e;
          }
        }
        if (req.method === 'POST' && m[2] === '/archive') return sendJSON(res, 200, cs.toJSON(cs.archiveCard(dir, id)));
        if (req.method === 'POST' && m[2] === '/restore') return sendJSON(res, 200, cs.toJSON(cs.restoreCard(dir, id)));
        if (req.method === 'DELETE' && !m[2]) { cs.deleteCard(dir, id); return sendJSON(res, 200, { ok: true }); }
      }

      res.writeHead(404); res.end('not found');
    } catch (err) {
      sendJSON(res, 500, { error: String((err && err.message) || err) });
    }
  });
}

function start(dir, port, attempts = 20) {
  // The dir must exist (checked by the CLI entry below); an empty board is allowed
  // so you can create the first card from the app.
  const srv = createServer(dir);
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempts > 0) { return start(dir, port + 1, attempts - 1); }
    console.error(e.message); process.exit(1);
  });
  const pidPath = path.join(dir, '.kanban-app.pid');
  srv.listen(port, '127.0.0.1', () => {
    fs.writeFileSync(pidPath, `${process.pid}\n${port}\n`);
    const cleanup = () => { try { fs.unlinkSync(pidPath); } catch (_) {} process.exit(0); };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    console.log(`Kanban app: http://localhost:${port}  (board: ${dir})`);
  });
  return srv;
}

if (require.main === module) {
  const dir = process.argv[2] || 'kanban';
  if (!fs.existsSync(dir)) { console.error(`Board dir not found: ${dir}`); process.exit(1); }
  const port = Number(process.argv[3]) || 7777;
  start(dir, port);
}

module.exports = { createServer, start };
