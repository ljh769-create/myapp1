// 한의원 치료 후기 앱 서버 (외부 의존성 없음, Node 18+)
// 실행: ADMIN_PASSWORD=비밀번호 node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'reviews.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

fs.mkdirSync(DATA_DIR, { recursive: true });
let reviews = [];
try { reviews = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { reviews = []; }

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reviews, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, limit = 50_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---- 관리자 인증 (서명된 토큰, 12시간) ----
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}
function makeToken() {
  const exp = String(Date.now() + 12 * 3600 * 1000);
  return `${exp}.${sign(exp)}`;
}
function safeEq(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function isAdmin(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [exp, sig] = t.split('.');
  return !!(exp && sig && Number(exp) > Date.now() && safeEq(sig, sign(exp)));
}

// ---- 간단한 요청 제한 (IP당) ----
const hits = new Map();
function limited(ip, key, max, windowMs) {
  const k = key + ip, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 3600 * 1000).unref();

// ---- 입력 정리 ----
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
};
const strList = (v, maxItems, maxLen) =>
  Array.isArray(v) ? v.slice(0, maxItems).map((s) => str(s, maxLen)).filter(Boolean) : [];

function cleanReview(b) {
  const r = b.ratings || {};
  return {
    treatments: strList(b.treatments, 12, 20),
    visitCount: str(b.visitCount, 20),
    ratings: {
      improvement: num(r.improvement, 1, 5),
      explain: num(r.explain, 1, 5),
      respect: num(r.respect, 1, 5),
      wait: num(r.wait, 1, 5),
      clean: num(r.clean, 1, 5),
    },
    nps: num(b.nps, 0, 10),
    goodTags: strList(b.goodTags, 12, 30),
    goodText: str(b.goodText, 1000),
    badTags: strList(b.badTags, 12, 30),
    badText: str(b.badText, 1000),
    learnTags: strList(b.learnTags, 12, 30),
    learnText: str(b.learnText, 1000),
    contact: {
      name: str(b.contact && b.contact.name, 30),
      phone: str(b.contact && b.contact.phone, 30),
    },
  };
}

// 환자에게 보여줄 공개 정보(답글)만 반환
const publicView = (r) => ({ id: r.id, createdAt: r.createdAt, reply: r.reply || null });

async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress || '';
  const p = url.pathname;

  if (req.method === 'POST' && p === '/api/reviews') {
    if (limited(ip, 'post', 10, 3600 * 1000)) return send(res, 429, { error: '잠시 후 다시 시도해 주세요.' });
    const body = await readBody(req);
    const review = cleanReview(body);
    if (review.ratings.improvement == null && review.nps == null && !review.goodText && !review.badText) {
      return send(res, 400, { error: '내용이 비어 있어요.' });
    }
    const id = crypto.randomBytes(6).toString('hex');
    const token = crypto.randomBytes(16).toString('hex');
    reviews.push({
      id, tokenHash: sign('t' + token), createdAt: new Date().toISOString(),
      ...review, reply: null, read: false, note: '',
    });
    save();
    return send(res, 201, { id, token });
  }

  // 환자가 자기 후기의 답글 확인 (id + 비밀 토큰)
  if (req.method === 'GET' && p === '/api/my') {
    const id = url.searchParams.get('id') || '';
    const token = url.searchParams.get('t') || '';
    const r = reviews.find((x) => x.id === id);
    if (!r || !safeEq(r.tokenHash, sign('t' + token))) return send(res, 404, { error: 'not found' });
    return send(res, 200, publicView(r));
  }

  if (req.method === 'POST' && p === '/api/admin/login') {
    if (limited(ip, 'login', 8, 15 * 60 * 1000)) return send(res, 429, { error: '시도가 너무 많아요. 잠시 후 다시 해주세요.' });
    const { password } = await readBody(req);
    if (typeof password === 'string' && safeEq(sign(password), sign(ADMIN_PASSWORD))) {
      return send(res, 200, { token: makeToken() });
    }
    return send(res, 401, { error: '비밀번호가 맞지 않아요.' });
  }

  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET' && p === '/api/admin/reviews') {
      return send(res, 200, reviews.map(({ tokenHash, ...r }) => r).reverse());
    }
    const m = p.match(/^\/api\/admin\/reviews\/([a-f0-9]+)$/);
    if (m) {
      const r = reviews.find((x) => x.id === m[1]);
      if (!r) return send(res, 404, { error: 'not found' });
      if (req.method === 'PATCH') {
        const b = await readBody(req);
        if (typeof b.reply === 'string') {
          const text = str(b.reply, 1000);
          r.reply = text ? { text, at: new Date().toISOString() } : null;
        }
        if (typeof b.read === 'boolean') r.read = b.read;
        if (typeof b.note === 'string') r.note = str(b.note, 1000);
        save();
        const { tokenHash, ...out } = r;
        return send(res, 200, out);
      }
      if (req.method === 'DELETE') {
        reviews = reviews.filter((x) => x.id !== r.id);
        save();
        return send(res, 200, { ok: true });
      }
    }
  }
  return send(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/admin') rel = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found');
    const ext = path.extname(file);
    const noCache = ext === '.html' || file.endsWith('sw.js');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof SyntaxError || e.message === 'too large') return send(res, 400, { error: 'bad request' });
    console.error(e);
    send(res, 500, { error: '서버에 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
}).listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}  (관리자: /admin)`);
  if (ADMIN_PASSWORD === 'changeme') console.warn('⚠ ADMIN_PASSWORD 환경변수를 꼭 바꿔주세요!');
});
