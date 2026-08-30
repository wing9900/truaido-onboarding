/**
 * A mock of the Google Apps Script web app, for testing.
 *
 * Phase 1 is live and has taken a real checkout. A test submission against the
 * deployed endpoint writes a real row into the production sheet and emails the
 * owner. So nothing is ever tested against it. This runs the REAL code from
 * apps-script.gs, loaded into a sandbox with stand-ins for the Apps Script
 * globals, over an in-memory sheet. Testing a reimplementation of the endpoint
 * would prove nothing about the endpoint.
 *
 *   node test/mock-endpoint.js [port]
 *
 * It also serves the repo, so index.html and phase2.html can be opened against
 * it. Two extra routes exist for tests and for nothing else:
 *
 *   GET  /__dump     the sheet as JSON, plus the log and any mail sent
 *   POST /__reset    empty sheet, empty log
 *
 * Query flags on /exec, to reproduce failures that are otherwise hard to get:
 *
 *   ?cors=0     omit the CORS header, so the browser cannot read the reply.
 *               This is the Apps Script quirk the no-cors fallback exists for.
 *   ?fail=1     return a 500.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ===================================================================== *
 * A sheet, near enough.
 *
 * The one behavior worth modeling faithfully is the format trap: Sheets turns
 * a numeric-looking string into a number unless the cell is plain text, which
 * is how ZIP 02134 becomes 2134 and a Massachusetts EIN starting 04- becomes
 * 4. Cells formatted '@' keep the string. If a test writes a leading zero into
 * a column nobody plain-texted, this stub eats it exactly like Sheets does.
 * ===================================================================== */
function makeSheet(name, id) {
  const cells = [];             // cells[row][col], both 1-based
  const colFormat = {};         // column -> number format
  const cellFormat = {};        // "r,c" -> number format
  let maxRows = 1000;
  let maxCols = 26;
  let lastRow = 0;

  const formatAt = (r, c) => cellFormat[r + ',' + c] || colFormat[c] || '';

  const coerce = (v, r, c) => {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'string') return v;
    if (formatAt(r, c) === '@') return v;
    if (/^-?\d+(\.\d+)?$/.test(v.trim()) && v.trim() !== '') return Number(v);
    return v;
  };

  const put = (r, c, v) => {
    if (!cells[r]) cells[r] = [];
    cells[r][c] = coerce(v, r, c);
    if (r > lastRow && String(cells[r][c]) !== '') lastRow = r;
    if (c > maxCols) maxCols = c;
  };

  const get = (r, c) => (cells[r] && cells[r][c] !== undefined ? cells[r][c] : '');

  function range(row, col, numRows, numCols) {
    const nr = numRows === undefined ? 1 : numRows;
    const nc = numCols === undefined ? 1 : numCols;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < nr; r++) {
          const line = [];
          for (let c = 0; c < nc; c++) line.push(get(row + r, col + c));
          out.push(line);
        }
        return out;
      },
      setValues(v) {
        for (let r = 0; r < nr; r++) {
          for (let c = 0; c < nc; c++) put(row + r, col + c, v[r][c]);
        }
        return this;
      },
      getValue() { return get(row, col); },
      setValue(v) { put(row, col, v); return this; },
      setNumberFormat(f) {
        /* A range that spans the whole sheet is a column format; anything
           smaller is per cell. That is the distinction ensureSheet relies on. */
        if (nr >= maxRows && nc === 1) colFormat[col] = f;
        else {
          for (let r = 0; r < nr; r++) {
            for (let c = 0; c < nc; c++) cellFormat[(row + r) + ',' + (col + c)] = f;
          }
        }
        return this;
      },
      setFontWeight() { return this; }
    };
  }

  return {
    getName: () => name,
    getSheetId: () => id,
    getMaxRows: () => maxRows,
    getMaxColumns: () => maxCols,
    insertColumnsAfter: (after, n) => { maxCols = Math.max(maxCols, after + n); },
    setFrozenRows: () => {},
    hideSheet: () => {},
    getLastRow: () => lastRow,
    getRange: range,
    appendRow(values) {
      const r = lastRow + 1;
      values.forEach((v, i) => put(r, i + 1, v));
      lastRow = r;
    },
    /* test hooks */
    _dump() {
      const out = [];
      for (let r = 1; r <= lastRow; r++) {
        const line = [];
        for (let c = 1; c <= maxCols; c++) line.push(get(r, c));
        out.push(line);
      }
      return out;
    },
    _clear() {
      cells.length = 0;
      lastRow = 0;
      for (const k of Object.keys(cellFormat)) delete cellFormat[k];
    }
  };
}

function makeBook() {
  const sheets = {};
  let nextId = 100;
  return {
    getUrl: () => 'https://docs.google.com/spreadsheets/d/MOCK/edit',
    toast: () => {},
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n, nextId++)),
    _sheets: sheets
  };
}

/* ===================================================================== *
 * Load the real endpoint
 * ===================================================================== */
function loadEndpoint() {
  const book = makeBook();
  const mail = [];

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: (to, subject, body) => mail.push({ to, subject, body }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ _text: s, setMimeType() { return this; }, getContent() { return this._text; } })
    },
    Utilities: { getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'.replace(/[a-f]/g, () => 'abcdef0123456789'[Math.floor(Math.random() * 16)]) },
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script.gs'), 'utf8'), sandbox, { filename: 'apps-script.gs' });

  return { sandbox, book, mail };
}

let endpoint = loadEndpoint();

/* ===================================================================== *
 * Server
 * ===================================================================== */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gs': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function body(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, type, payload, headers) => {
    res.writeHead(code, Object.assign({ 'Content-Type': type }, headers || {}));
    res.end(payload);
  };

  if (url.pathname === '/exec') {
    const cors = url.searchParams.get('cors') === '0'
      ? {}
      : { 'Access-Control-Allow-Origin': '*' };

    if (req.method === 'OPTIONS') {
      /* Apps Script cannot answer a preflight. Neither does this, on purpose:
         a form that starts sending application/json should fail here too. */
      return send(405, 'text/plain', 'no preflight', cors);
    }
    if (url.searchParams.get('fail') === '1') {
      return send(500, 'text/plain', 'boom', cors);
    }
    if (req.method === 'GET') {
      return send(200, 'application/json', endpoint.sandbox.doGet().getContent(), cors);
    }

    const raw = await body(req);
    let out;
    try {
      out = endpoint.sandbox.doPost({ postData: { contents: raw }, parameter: {} }).getContent();
    } catch (err) {
      out = JSON.stringify({ ok: false, error: String(err) });
    }
    return send(200, 'application/json', out, cors);
  }

  if (url.pathname === '/__dump') {
    const sheets = {};
    for (const [name, sh] of Object.entries(endpoint.book._sheets)) sheets[name] = sh._dump();
    return send(200, 'application/json', JSON.stringify({ sheets, mail: endpoint.mail }, null, 2),
      { 'Access-Control-Allow-Origin': '*' });
  }

  if (url.pathname === '/__reset') {
    endpoint = loadEndpoint();
    return send(200, 'application/json', '{"ok":true}', { 'Access-Control-Allow-Origin': '*' });
  }

  /* static */
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(404, 'text/plain', 'not found');
  }
  send(200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
});

const PORT = Number(process.argv[2] || 8787);
server.listen(PORT, () => {
  console.log('mock endpoint on http://127.0.0.1:' + PORT + '/exec');
  console.log('forms on        http://127.0.0.1:' + PORT + '/index.html and /phase2.html');
});

module.exports = { server };
