const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8080;
const ROOT = __dirname;
const USERDATA_DIR = path.join(ROOT, 'userdata');
const STATS_FILE = path.join(USERDATA_DIR, 'stats.json');
const QUESTIONS_FILE = path.join(USERDATA_DIR, 'questions.json');
const BANKS_FILE = path.join(USERDATA_DIR, 'banks.json');
const ACTIVE_BANK_FILE = path.join(USERDATA_DIR, 'active_bank.json');

if (!fs.existsSync(USERDATA_DIR)) {
  fs.mkdirSync(USERDATA_DIR, { recursive: true });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf'
  };
  return types[ext] || 'application/octet-stream';
}

function readStats() {
  if (!fs.existsSync(STATS_FILE)) {
    return { question_stats: {}, sessions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
  } catch {
    return { question_stats: {}, sessions: [] };
  }
}

function writeStats(data) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function readBanks() {
  if (!fs.existsSync(BANKS_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(BANKS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeBanks(data) {
  fs.writeFileSync(BANKS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function readActiveBank() {
  if (!fs.existsSync(ACTIVE_BANK_FILE)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(ACTIVE_BANK_FILE, 'utf-8'));
    return data.name || null;
  } catch {
    return null;
  }
}

function writeActiveBank(name) {
  fs.writeFileSync(ACTIVE_BANK_FILE, JSON.stringify({ name }), 'utf-8');
}

function migrateLegacyQuestions() {
  if (fs.existsSync(BANKS_FILE)) return;
  if (!fs.existsSync(QUESTIONS_FILE)) return;
  try {
    const questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'));
    if (!Array.isArray(questions) || questions.length === 0) return;
    const banks = { '默认题库': questions };
    writeBanks(banks);
    writeActiveBank('默认题库');
  } catch {}
}

function getActiveQuestions() {
  const banks = readBanks();
  const activeName = readActiveBank();
  if (activeName && banks[activeName]) {
    return banks[activeName];
  }
  const names = Object.keys(banks);
  if (names.length > 0) {
    writeActiveBank(names[0]);
    return banks[names[0]];
  }
  return null;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

migrateLegacyQuestions();

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  function json(data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  // API: GET /api/stats
  if (pathname === '/api/stats' && req.method === 'GET') {
    json(readStats());
    return;
  }

  // API: POST /api/stats
  if (pathname === '/api/stats' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body) {
      writeStats(body);
      json({ success: true });
    } else {
      json({ error: 'Invalid JSON' }, 400);
    }
    return;
  }

  // API: GET /api/questions (returns active bank questions)
  if (pathname === '/api/questions' && req.method === 'GET') {
    const questions = getActiveQuestions();
    if (questions) {
      json(questions);
    } else {
      json({ error: 'no_questions' }, 404);
    }
    return;
  }

  // API: POST /api/questions (replaces active bank questions)
  if (pathname === '/api/questions' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body || !Array.isArray(body)) {
      json({ error: 'Invalid questions data' }, 400);
      return;
    }
    const banks = readBanks();
    let activeName = readActiveBank();
    if (!activeName || !banks[activeName]) {
      activeName = '默认题库';
    }
    banks[activeName] = body;
    writeBanks(banks);
    writeActiveBank(activeName);
    json({ success: true, bankName: activeName });
    return;
  }

  // API: GET /api/banks (list all banks metadata)
  if (pathname === '/api/banks' && req.method === 'GET') {
    if (query.name) {
      const banks = readBanks();
      if (banks[query.name]) {
        json({ name: query.name, questions: banks[query.name] });
      } else {
        json({ error: 'Bank not found' }, 404);
      }
      return;
    }
    const banks = readBanks();
    const activeName = readActiveBank();
    const list = Object.entries(banks).map(([name, questions]) => {
      const chapters = [...new Set(questions.map(q => q.chapter))];
      return {
        name,
        questionCount: questions.reduce((s, ch) => s + (ch.questions ? ch.questions.length : 0), 0),
        chapterCount: chapters.length,
        isActive: name === activeName
      };
    });
    json(list);
    return;
  }

  // API: POST /api/banks (create new bank)
  if (pathname === '/api/banks' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body || !body.name || !body.questions) {
      json({ error: 'Missing name or questions' }, 400);
      return;
    }
    const banks = readBanks();
    if (banks[body.name]) {
      json({ error: '题库名称已存在' }, 409);
      return;
    }
    banks[body.name] = body.questions;
    writeBanks(banks);
    json({ success: true });
    return;
  }

  // API: PUT /api/banks (update existing bank)
  if (pathname === '/api/banks' && req.method === 'PUT') {
    const body = await parseBody(req);
    if (!body || !body.name || !body.questions) {
      json({ error: 'Missing name or questions' }, 400);
      return;
    }
    const banks = readBanks();
    if (!banks[body.name]) {
      json({ error: '题库不存在' }, 404);
      return;
    }
    banks[body.name] = body.questions;
    writeBanks(banks);
    json({ success: true });
    return;
  }

  // API: DELETE /api/banks (delete a bank)
  if (pathname === '/api/banks' && req.method === 'DELETE') {
    const body = await parseBody(req);
    if (!body || !body.name) {
      json({ error: 'Missing name' }, 400);
      return;
    }
    const banks = readBanks();
    if (!banks[body.name]) {
      json({ error: '题库不存在' }, 404);
      return;
    }
    delete banks[body.name];
    writeBanks(banks);
    const activeName = readActiveBank();
    if (activeName === body.name) {
      const remaining = Object.keys(banks);
      if (remaining.length > 0) {
        writeActiveBank(remaining[0]);
      } else {
        if (fs.existsSync(ACTIVE_BANK_FILE)) {
          fs.unlinkSync(ACTIVE_BANK_FILE);
        }
      }
    }
    json({ success: true });
    return;
  }

  // API: POST /api/banks/active (set active bank)
  if (pathname === '/api/banks/active' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body || !body.name) {
      json({ error: 'Missing name' }, 400);
      return;
    }
    const banks = readBanks();
    if (!banks[body.name]) {
      json({ error: '题库不存在' }, 404);
      return;
    }
    writeActiveBank(body.name);
    json({ success: true });
    return;
  }

  // API: POST /api/banks/rename (rename a bank)
  if (pathname === '/api/banks/rename' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body || !body.oldName || !body.newName) {
      json({ error: 'Missing oldName or newName' }, 400);
      return;
    }
    const newName = body.newName.trim();
    if (!newName) {
      json({ error: '题库名称不能为空' }, 400);
      return;
    }
    const banks = readBanks();
    if (!banks[body.oldName]) {
      json({ error: '原题库不存在' }, 404);
      return;
    }
    if (body.oldName !== newName && banks[newName]) {
      json({ error: '题库名称已存在' }, 409);
      return;
    }
    banks[newName] = banks[body.oldName];
    if (body.oldName !== newName) {
      delete banks[body.oldName];
    }
    writeBanks(banks);
    const activeName = readActiveBank();
    if (activeName === body.oldName) {
      writeActiveBank(newName);
    }
    json({ success: true, newName });
    return;
  }

  // Static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(ROOT, decodeURIComponent(filePath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});