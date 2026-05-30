/**
 * Tic-Tac-Toe backend.
 *
 * Zero external dependencies — uses only Node's built-in modules.
 * Responsibilities:
 *   - Serve the static front-end from /public
 *   - Store a configuration file the player can edit (GET/PUT /api/config)
 *   - Persist the running scoreboard (GET/POST/DELETE /api/scores)
 *
 * Run with:  node server.js   (then open http://localhost:3000)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT      = process.env.PORT || 3000;
const PUBLIC    = path.join(__dirname, 'public');
// DATA_DIR can point at a mounted persistent volume in production
// (e.g. Railway volume or Render disk) so config/scores survive restarts.
const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

// ---------------------------------------------------------------------------
// Defaults & validation
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  playerName:   'CADET',
  playerSymbol: '▲',
  cpuSymbol:    '■',
  // the enemy faction: 'borg' | 'klingon' | 'romulan' | 'computer'
  opponent:     'borg',
  // who plays the first move of each game: 'you' | 'computer' | 'alternate'
  firstMove:    'alternate',
  // 'perfect'  -> unbeatable minimax (the true Kobayashi Maru, no-win scenario)
  // 'hard'     -> minimax 80% of the time, random otherwise (Kirk subroutine)
  // 'medium'   -> minimax 50% of the time
  // 'easy'     -> always random
  difficulty:   'perfect',
  // milliseconds the computer "thinks" before moving
  cpuDelayMs:   480,
  // red-alert klaxon + flash when the enemy is one move from winning
  redAlert:     true,
  // LCARS audio cues
  sound:        true,
  theme: {
    playerColor: '#ffcc66',   // Starfleet golden-tanoi
    cpuColor:    '#66cc66',   // (faction overrides this in the UI)
    accent:      '#ff9900'    // LCARS golden-orange
  }
};

const DEFAULT_SCORES = { you: 0, draw: 0, cpu: 0 };

const DIFFICULTIES = ['perfect', 'hard', 'medium', 'easy'];
const FIRST_MOVES   = ['you', 'computer', 'alternate'];
const OPPONENTS     = ['borg', 'klingon', 'romulan', 'computer'];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Coerce arbitrary input into a valid config, falling back to defaults. */
function sanitizeConfig(input) {
  const c = (input && typeof input === 'object') ? input : {};
  const t = (c.theme && typeof c.theme === 'object') ? c.theme : {};

  const str = (v, fallback, max = 24) =>
    (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : fallback;

  const sym = (v, fallback) => {
    const s = (typeof v === 'string') ? v.trim() : '';
    return s ? [...s][0] : fallback;            // first character / glyph only
  };

  const hex = (v, fallback) => (typeof v === 'string' && HEX.test(v)) ? v : fallback;

  const num = (v, fallback, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };

  const oneOf = (v, list, fallback) => list.includes(v) ? v : fallback;

  const bool = (v, fallback) => (typeof v === 'boolean') ? v : fallback;

  return {
    playerName:   str(c.playerName,   DEFAULT_CONFIG.playerName),
    playerSymbol: sym(c.playerSymbol, DEFAULT_CONFIG.playerSymbol),
    cpuSymbol:    sym(c.cpuSymbol,    DEFAULT_CONFIG.cpuSymbol),
    opponent:     oneOf(c.opponent,   OPPONENTS,     DEFAULT_CONFIG.opponent),
    firstMove:    oneOf(c.firstMove,  FIRST_MOVES,   DEFAULT_CONFIG.firstMove),
    difficulty:   oneOf(c.difficulty, DIFFICULTIES,  DEFAULT_CONFIG.difficulty),
    cpuDelayMs:   num(c.cpuDelayMs, DEFAULT_CONFIG.cpuDelayMs, 0, 3000),
    redAlert:     bool(c.redAlert, DEFAULT_CONFIG.redAlert),
    sound:        bool(c.sound,    DEFAULT_CONFIG.sound),
    theme: {
      playerColor: hex(t.playerColor, DEFAULT_CONFIG.theme.playerColor),
      cpuColor:    hex(t.cpuColor,    DEFAULT_CONFIG.theme.cpuColor),
      accent:      hex(t.accent,      DEFAULT_CONFIG.theme.accent)
    }
  };
}

function sanitizeScores(input) {
  const s = (input && typeof input === 'object') ? input : {};
  const n = v => Math.max(0, Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0);
  return { you: n(s.you), draw: n(s.draw), cpu: n(s.cpu) };
}

// ---------------------------------------------------------------------------
// Tiny JSON file store
// ---------------------------------------------------------------------------

function ensureFile(file, fallback) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    }
  } catch (err) {
    console.error('Could not initialise', file, err.message);
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

ensureFile(CONFIG_FILE, DEFAULT_CONFIG);
ensureFile(SCORES_FILE, DEFAULT_SCORES);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

function serveStatic(req, res) {
  // Map URL path to a file inside PUBLIC, preventing path traversal.
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

async function handleApi(req, res, pathname) {
  // --- Config ---
  if (pathname === '/api/config') {
    if (req.method === 'GET') {
      return sendJson(res, 200, sanitizeConfig(readJson(CONFIG_FILE, DEFAULT_CONFIG)));
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      const clean = sanitizeConfig(body);
      writeJson(CONFIG_FILE, clean);
      return sendJson(res, 200, clean);
    }
    if (req.method === 'DELETE') {                 // reset to defaults
      writeJson(CONFIG_FILE, DEFAULT_CONFIG);
      return sendJson(res, 200, DEFAULT_CONFIG);
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  // --- Scores ---
  if (pathname === '/api/scores') {
    if (req.method === 'GET') {
      return sendJson(res, 200, sanitizeScores(readJson(SCORES_FILE, DEFAULT_SCORES)));
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      const clean = sanitizeScores(body);
      writeJson(SCORES_FILE, clean);
      return sendJson(res, 200, clean);
    }
    if (req.method === 'DELETE') {                 // reset scoreboard
      writeJson(SCORES_FILE, DEFAULT_SCORES);
      return sendJson(res, 200, DEFAULT_SCORES);
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  // --- Record a single game result, server increments the counter ---
  if (pathname === '/api/scores/record' && req.method === 'POST') {
    const body = await readBody(req);
    const outcome = body && body.outcome;         // 'you' | 'draw' | 'cpu'
    const scores = sanitizeScores(readJson(SCORES_FILE, DEFAULT_SCORES));
    if (['you', 'draw', 'cpu'].includes(outcome)) {
      scores[outcome] += 1;
      writeJson(SCORES_FILE, scores);
      return sendJson(res, 200, scores);
    }
    return sendJson(res, 400, { error: 'outcome must be you|draw|cpu' });
  }

  // --- Expose the option lists so the UI can build its form dynamically ---
  if (pathname === '/api/options' && req.method === 'GET') {
    return sendJson(res, 200, { difficulties: DIFFICULTIES, firstMoves: FIRST_MOVES, opponents: OPPONENTS });
  }

  return sendJson(res, 404, { error: 'Unknown endpoint' });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else {
      serveStatic(req, res);
    }
  } catch (err) {
    sendJson(res, 400, { error: err.message || 'Bad request' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🎮  Tic-Tac-Toe server running`);
  console.log(`      → http://localhost:${PORT}\n`);
  console.log(`      Config:  ${CONFIG_FILE}`);
  console.log(`      Scores:  ${SCORES_FILE}\n`);
});
