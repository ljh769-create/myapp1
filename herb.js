// 한약 진행 관리 (직원용) — 환자 1명 1회차 = 카드 1장, 상태는 서버 한 곳에서만 관리
// 규칙(서버에서 강제):
//  1) 처방전 받음 상태가 아니면 조제 시작 불가
//  2) 다른 사람이 조제중인 카드는 손댈 수 없음 (중복 조제 방지)
//  3) 조제완료(보관 위치 필수)가 아니면 발송/수령 처리 불가
//  4) 같은 환자·같은 회차 카드가 진행 중이면 새로 만들 수 없음
const fs = require('fs');
const alimtalk = require('./alimtalk');
const photoRead = require('./photo-read');
const createPush = require('./push');
// 로젠 배송조회 주소 (송장번호가 뒤에 붙음). 바뀌면 환경변수로 교체
const TRACK_URL = process.env.LOGEN_TRACK_URL || 'https://www.ilogen.com/web/personal/trace/';
const path = require('path');
const crypto = require('crypto');

const STATUSES = {
  need_rx: '처방전 필요',
  rx_ready: '처방전 받음',
  compounding: '조제중',
  done: '조제완료·보관',
  sent: '발송·수령 완료',
  hold: '보류',
  recall: '회수 필요',
};
const OPEN = ['need_rx', 'rx_ready', 'compounding', 'done', 'hold', 'recall'];

// 어느 상태에서 어느 상태로 갈 수 있는지
const NEXT = {
  need_rx: ['rx_ready', 'hold'],
  rx_ready: ['compounding', 'need_rx', 'hold'],
  compounding: ['done', 'rx_ready'],
  done: ['sent', 'hold'],
  sent: ['recall'],
  hold: ['need_rx', 'rx_ready', 'done'],
  recall: ['done', 'need_rx', 'hold'],
};

// 포장재: 조제완료·발송 때 사용량이 자동 차감됨
const DEFAULT_PACK = [['파우치', '장', 0], ['택배 박스', '개', 0], ['쌍화탕 박스', '개', 0]];
const DEFAULT_STOCK = [
  ['삼소음', 1], ['평진탕', 1], ['기력보강탕', 0], ['녹용접골탕', 2], ['당귀수산', 4],
  ['혈력보강', 0], ['마황행인', 0.2], ['생생탕', 4], ['좋은꿈청심탕', 4], ['생맥산', 1], ['쌍화탕', 19],
];

// 출발일부터 CYCLE 일마다 확인 알람
const CYCLE = 15;
// 결제 패키지: 총 일수 (총 회차 = 일수 ÷ CYCLE, 올림)
const PKG_PRESETS = [30, 60, 90, 180];
const pkgDaysOf = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= CYCLE && n <= 730 ? n : 0; };
const pkgRounds = (days) => Math.ceil(days / CYCLE);
const kstDate = (t = Date.now()) => new Date(new Date(t).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const kstHour = () => new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && addDays(d, 0) === d;
// 외부(텔레그램)로 나가는 이름은 가립니다: 김철수 → 김○수
const maskName = (n) => (n.length <= 1 ? n : n.length === 2 ? n[0] + '○' : n[0] + '○'.repeat(n.length - 2) + n[n.length - 1]);

module.exports = function createHerb({ dataDir, password, secret, send, readBody, limited, safeEq, clinicName = '', publicUrl = '', notify = null }) {
  const FILE = path.join(dataDir, 'herb.json');
  let db;
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = null; }
  if (!db) {
    db = {
      orders: [],
      stock: DEFAULT_STOCK.map(([name, qty]) => ({ id: rid(), name, qty, unit: '박스', updatedAt: null, by: '' })),
      staff: ['실장', '성열', '수정'],
    };
  }
  // 예전 데이터 보정: 구분/최소수량/기록 필드, 기본 포장재 추가
  db.stockLog = db.stockLog || [];
  // 이름은 환자가 입력한 문자열이라, 기본 객체 속성과 섞이지 않게 prototype 없는 객체에 담음
  const dict = (o) => Object.assign(Object.create(null), o);
  db.departures = dict(db.departures); // 직접 등록한 출발일
  db.follow = dict(db.follow);         // 알람 확인/종료 상태
  db.phones = dict(db.phones);
  db.consent = dict(db.consent);       // 알림톡 수신 동의 { at, by }
  db.adConsent = dict(db.adConsent);
  db.dosageByFormula = dict(db.dosageByFormula); // 처방별 마지막 복용법 (다음 카드 자동 채움)
  db.surveys = dict(db.surveys);       // 15일 설문 { token: { patient, base, dueDate, at, answer, answeredAt } }
  db.pushSubs = Array.isArray(db.pushSubs) ? db.pushSubs : []; // 직원 휴대폰 푸시 구독 { endpoint, keys, staff, at }
  const push = createPush(dataDir);
  // 직원 휴대폰으로 알림. 잠금화면에 보이므로 이름은 가려서 넣을 것. except: 이 일을 한 본인 기기는 제외
  function pushAll(title, body, except = '', tag = '') {
    const subs = db.pushSubs.filter((x) => !except || x.staff !== except);
    if (!subs.length) return;
    Promise.all(subs.map(async (sub) => [sub, await push.sendOne(sub, { title, body, tag, url: '/herb' })])).then((rs) => {
      const gone = rs.filter(([, r]) => r === 'gone').map(([x]) => x.endpoint);
      if (gone.length) { db.pushSubs = db.pushSubs.filter((x) => !gone.includes(x.endpoint)); save(); }
    }).catch((e) => console.error('푸시 오류:', e.message));
  }
  const who = (o) => `${maskName(o.patient)} ${o.round ? o.round + (o.total ? '/' + o.total : '회차') : ''}`.trim();   // 광고성(이벤트) 정보 수신 동의 { at, by } — 알림톡 동의와 별개
  for (const s of db.stock) { s.cat = s.cat || '탕약'; s.min = Number(s.min) || 0; }
  for (const [name, unit, qty] of DEFAULT_PACK) {
    if (!db.stock.some((x) => x.name === name)) db.stock.push({ id: rid(), name, qty, unit, cat: '포장재', min: 0, updatedAt: null, by: '' });
  }

  // 재고 변경은 전부 여기로: 누가, 왜, 얼마나 바꿨는지 남김
  function stockChange(s, delta, by, reason) {
    const lowAt = (q) => (s.min > 0 ? q <= s.min : q <= 0);
    const wasLow = lowAt(s.qty);
    s.qty = Math.round((s.qty + delta) * 10) / 10;
    if (!wasLow && lowAt(s.qty)) pushAll('📦 재고 부족', `${s.name} ${s.qty}${s.unit} 남음 — 주문/제작 필요`, '', 'stock-' + s.id);
    s.updatedAt = now(); s.by = by;
    db.stockLog.push({ at: now(), by, id: s.id, name: s.name, delta: Math.round(delta * 10) / 10, after: s.qty, reason });
    if (db.stockLog.length > 2000) db.stockLog = db.stockLog.slice(-2000);
  }
  // [{id, qty}] 형태의 사용량을 차감하고 카드에 기록
  function applyUse(o, use, by, reason) {
    if (!Array.isArray(use)) return [];
    const done = [];
    for (const u of use.slice(0, 10)) {
      const s = db.stock.find((x) => x.id === u.id);
      const q = Number(u.qty);
      if (!s || !Number.isFinite(q) || q <= 0 || q > 10000) continue;
      stockChange(s, -q, by, `${o.patient} ${o.round || ''}회차 ${reason}`);
      done.push({ name: s.name, qty: q });
    }
    if (done.length) o.used = [...(o.used || []), ...done.map((d) => ({ ...d, at: now(), by }))];
    return done;
  }

  function save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, FILE);
  }
  function rid() { return crypto.randomBytes(6).toString('hex'); }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const int = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const now = () => new Date().toISOString();

  // ---- 인증: 직원 공용 비밀번호 + 본인 이름 ----
  const sign = (p) => crypto.createHmac('sha256', secret).update('herb:' + p).digest('hex');
  function makeToken() { const exp = String(Date.now() + 14 * 24 * 3600 * 1000); return `${exp}.${sign(exp)}`; }
  function authed(req) {
    const h = req.headers.authorization || '';
    const [exp, sig] = (h.startsWith('Bearer ') ? h.slice(7) : '').split('.');
    return !!(exp && sig && Number(exp) > Date.now() && safeEq(sig, sign(exp)));
  }
  const actorOf = (req) => {
    try { return decodeURIComponent(str(req.headers['x-staff'], 60)).slice(0, 20); } catch { return ''; }
  };

  function log(o, by, to, note) {
    o.history.push({ at: now(), by, from: o.status, to, note: note || '' });
    o.status = to;
    o.updatedAt = now();
    o.version++;
  }
  const dupOf = (patient, round, exceptId) => db.orders.find((x) =>
    x.id !== exceptId && OPEN.includes(x.status) && x.patient === patient && round != null && x.round === round);

  const DOSAGE_DEFAULT = '하루 3회, 식후 30분에 1팩씩 드세요. 냉장 보관하고 따뜻하게 데워 드세요.';
  const dosageText = (o) => o.dosage || DOSAGE_DEFAULT;
  const rememberDosage = (o) => { if (o.formula && o.dosage) db.dosageByFormula[o.formula] = o.dosage; };
  const cleanTrack = (v) => String(v ?? '').replace(/[^0-9]/g, '').slice(0, 20);
  const trackDup = (t, exceptId) => t && db.orders.find((x) => x.id !== exceptId && x.tracking === t);
  const contactOf = (patient) => ({ phone: db.phones[patient] || '', consent: !!db.consent[patient], adConsent: !!db.adConsent[patient] });
  function setContact(patient, phone, consent, by, adConsent) {
    if (adConsent === true && !db.adConsent[patient]) db.adConsent[patient] = { at: now(), by };
    if (adConsent === false) delete db.adConsent[patient];
    if (phone !== undefined) { if (phone) db.phones[patient] = phone; else delete db.phones[patient]; }
    if (consent === true && !db.consent[patient]) db.consent[patient] = { at: now(), by };
    if (consent === false) delete db.consent[patient];
  }
  // 발송 알림톡: 연락처 + 수신동의 + 설정이 모두 있을 때만. 결과는 카드 기록에 남김
  async function notifyShipped(o, by) {
    const c = contactOf(o.patient);
    const why = !alimtalk.enabled('shipped') ? '알림톡 미설정' : !c.phone ? '연락처 없음' : !c.consent ? '수신동의 없음' : '';
    const rec = { at: now(), type: '발송안내', by, ok: false, error: why };
    if (!why) {
      const r = await alimtalk.send('shipped', c.phone, {
        '#{이름}': o.patient, '#{처방}': o.formula || '한약', '#{회차}': o.round ? `${o.round}${o.total ? '/' + o.total : ''}회차` : '',
        '#{복용법}': dosageText(o), '#{택배사}': '로젠택배', '#{송장번호}': o.tracking || '', '#{조회링크}': o.tracking ? TRACK_URL + o.tracking : '',
      });
      rec.ok = r.ok; rec.error = r.ok ? '' : r.error;
    }
    o.messages = [...(o.messages || []), rec];
    save();
    return rec;
  }

  // ---- 조제 사진: DATA_DIR/photos 에 저장, 환자에게는 추측 불가능한 비공개 링크로만 보여줌 ----
  const PHOTO_DIR = path.join(dataDir, 'photos');
  const PHOTO_DAYS = 60; // 링크 유효기간
  const baseUrl = (req) => publicUrl || (req ? `https://${req.headers.host}` : '');
  function cleanupPhotos() {
    const limit = Date.now() - PHOTO_DAYS * 86400000;
    let changed = false;
    for (const o of db.orders) {
      if (!o.photos || !o.photos.length || Date.parse(o.photos[o.photos.length - 1].at) > limit) continue;
      for (const ph of o.photos) fs.rm(path.join(PHOTO_DIR, ph.file), () => {});
      o.photos = []; o.photoToken = ''; changed = true;
    }
    if (changed) save();
  }
  // 결제 첫날 시작 인사: 이 환자의 첫 카드(또는 1회차)일 때 한 번
  async function notifyWelcome(o, by) {
    const c = contactOf(o.patient);
    const why = !alimtalk.enabled('welcome') ? '알림톡 미설정' : !c.phone ? '연락처 없음' : !c.consent ? '수신동의 없음' : '';
    const rec = { at: now(), type: '시작인사', by, ok: false, error: why };
    if (!why) {
      const r = await alimtalk.send('welcome', c.phone, {
        '#{이름}': o.patient, '#{처방}': o.formula || '한약',
        '#{기간}': o.pkgDays ? `${o.pkgDays}일` : (o.total ? `${o.total * CYCLE}일` : '처방 기간'),
        '#{복용법}': dosageText(o), '#{총회차}': o.total ? `${o.total}회` : '-', '#{종료일}': o.pkgEnd || (o.total ? addDays(kstDate(), o.total * CYCLE) : '-'),
      });
      rec.ok = r.ok; rec.error = r.ok ? '' : r.error;
    }
    o.messages = [...(o.messages || []), rec];
    save();
    return rec;
  }

  async function notifyPhoto(o, by, req) {
    const c = contactOf(o.patient);
    const why = !alimtalk.enabled('photo') ? '알림톡 미설정' : !c.phone ? '연락처 없음' : !c.consent ? '수신동의 없음' : !o.photoToken ? '사진 없음' : '';
    const rec = { at: now(), type: '조제사진', by, ok: false, error: why };
    if (!why) {
      const r = await alimtalk.send('photo', c.phone, {
        '#{이름}': o.patient, '#{처방}': o.formula || '한약', '#{회차}': o.round ? `${o.round}${o.total ? '/' + o.total : ''}회차` : '',
        '#{사진링크}': `${baseUrl(req)}/p/${o.photoToken}`,
      });
      rec.ok = r.ok; rec.error = r.ok ? '' : r.error;
    }
    o.messages = [...(o.messages || []), rec];
    save();
    return rec;
  }
  // 환자용 사진 페이지: /p/<token>, /p/<token>/<n>.jpg
  function publicPage(req, res, url) {
    const m = url.pathname.match(/^\/p\/([a-f0-9]{32})(?:\/(\d+)\.jpg)?$/);
    const o = m && db.orders.find((x) => x.photoToken === m[1]);
    const head = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'private, max-age=300' };
    if (!o || !o.photos || !o.photos.length) { res.writeHead(404, { ...head, 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<meta name=viewport content="width=device-width"><p style="font:18px sans-serif;padding:30px">사진이 없거나 보관 기간이 지났어요.</p>'); }
    if (m[2] !== undefined) {
      const ph = o.photos[Number(m[2])];
      if (!ph) { res.writeHead(404, head); return res.end(); }
      return fs.readFile(path.join(PHOTO_DIR, ph.file), (err, buf) => {
        if (err) { res.writeHead(404, head); return res.end(); }
        res.writeHead(200, { ...head, 'Content-Type': 'image/jpeg' }); res.end(buf);
      });
    }
    const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    res.writeHead(200, { ...head, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'" });
    res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>한약 조제 사진</title>
<style>body{margin:0;font-family:sans-serif;background:#f6f4ef;color:#23302b}.w{max-width:560px;margin:0 auto;padding:20px 16px 40px}h1{font-size:21px;color:#245647}img{width:100%;border-radius:14px;margin:10px 0;background:#fff}.m{color:#6b7872;font-size:15px;line-height:1.6}</style></head>
<body><div class="w"><h1>🌿 ${e(clinicName || '한의원')} 한약 조제 사진</h1>
<p class="m">${e(maskName(o.patient))}님의 ${e(o.formula || '한약')} ${o.round ? e(o.round + (o.total ? '/' + o.total : '') + '회차') : ''}<br>조제일 ${e(kstDate(o.photos[0].at))}</p>
${o.photos.map((_, i) => `<img src="/p/${o.photoToken}/${i}.jpg" alt="조제 사진 ${i + 1}">`).join('')}
<div style="background:#fff;border:1px solid #dde3df;border-radius:14px;padding:14px 16px;margin:12px 0"><b>💊 복용법</b><p style="margin:6px 0 0;font-size:17px;line-height:1.6;white-space:pre-wrap">${e(dosageText(o))}</p></div>
<p class="m">받으신 뒤 바로 냉장 보관해 주세요. 궁금한 점은 카카오톡 채널로 남겨 주세요.<br>이 사진은 ${PHOTO_DAYS}일 동안만 볼 수 있어요.</p></div></body></html>`);
  }

  // ---- 15일 설문: 알림톡 링크로 열리는 짧은 설문 (/s/<token>) ----
  const Q = {
    taking: ['잘 먹고 있어요', '가끔 빼먹어요', '거의 못 먹었어요'],
    feel: ['좋아졌어요', '비슷해요', '아직 모르겠어요', '불편해졌어요'],
    side: ['없어요', '속이 불편해요', '변이 묽어요', '기타 (아래에 적어 주세요)'],
  };
  function makeSurvey(item) {
    const token = crypto.randomBytes(16).toString('hex');
    db.surveys[token] = { patient: item.patient, base: item.base, dueDate: item.dueDate, at: now(), answer: null, answeredAt: null };
    const keys = Object.keys(db.surveys);
    if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete db.surveys[k];
    return token;
  }
  const surveyOf = (patient, base) => Object.values(db.surveys).filter((x) => x.patient === patient && x.base === base)
    .sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  const needsCall = (a) => !!a && (a.feel === Q.feel[3] || (a.side && a.side !== Q.side[0]) || a.call === 'yes' || a.taking === Q.taking[2]);
  async function sendFollowKakao(item, by) {
    const c = contactOf(item.patient);
    const why = !alimtalk.enabled('followup') ? '알림톡 미설정' : !c.phone ? '연락처 없음' : !c.consent ? '수신동의 없음' : '';
    if (why) return { ok: false, error: why };
    const last = db.orders.filter((o) => o.patient === item.patient && o.status === 'sent').sort((a, b2) => (b2.sentAt || '').localeCompare(a.sentAt || ''))[0];
    const token = makeSurvey(item);
    const r = await alimtalk.send('followup', c.phone, {
      '#{이름}': item.patient, '#{처방}': (last && last.formula) || '한약', '#{경과일}': String(item.days),
      '#{설문링크}': `${baseUrl()}/s/${token}`,
    });
    if (!r.ok) delete db.surveys[token];
    db.follow[item.patient] = { ...(db.follow[item.patient] || { base: item.base }), lastKakao: now(), lastKakaoBy: by, lastKakaoOk: r.ok, kakaoFor: item.dueDate };
    save();
    return r;
  }
  function readForm(req) {
    return new Promise((ok, no) => {
      let d = ''; req.on('data', (c) => { d += c; if (d.length > 20000) { no(new Error('too large')); req.destroy(); } });
      req.on('end', () => ok(Object.fromEntries(new URLSearchParams(d)))); req.on('error', no);
    });
  }
  async function surveyPage(req, res, url) {
    const m = url.pathname.match(/^\/s\/([a-f0-9]{32})$/);
    const sv = m && db.surveys[m[1]];
    const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const page = (body) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
      res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>복용 확인</title>
<style>body{margin:0;font-family:sans-serif;background:#f6f4ef;color:#23302b}.w{max-width:560px;margin:0 auto;padding:20px 16px 40px}h1{font-size:21px;color:#245647}fieldset{border:1px solid #dde3df;border-radius:14px;background:#fff;margin:12px 0;padding:12px 14px}legend{font-weight:700;padding:0 4px}label{display:block;padding:9px 0;font-size:17px}input[type=radio]{transform:scale(1.3);margin-right:10px}textarea{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid #dde3df;border-radius:10px}button{width:100%;font:inherit;font-size:18px;font-weight:700;padding:15px;border:0;border-radius:12px;background:#2f6f5e;color:#fff;margin-top:10px}.m{color:#6b7872}</style></head><body><div class="w">${body}</div></body></html>`);
    };
    const expired = !sv || Date.now() - Date.parse(sv.at) > 30 * 86400000;
    if (expired) return page('<p class="m">설문 기간이 지났어요. 궁금한 점은 카카오톡 채널로 남겨 주세요.</p>');
    const title = `<h1>🌿 ${e(clinicName || '한의원')} 한약 복용 확인</h1>`;
    if (sv.answer) return page(`${title}<p>답해 주셔서 감사합니다. 🙏<br>확인 후 필요하면 연락드릴게요.</p>`);
    if (req.method === 'POST') {
      const ip = req.socket.remoteAddress || '';
      if (limited(ip, 'survey', 20, 3600 * 1000)) return page('<p>잠시 후 다시 시도해 주세요.</p>');
      const f = await readForm(req);
      const pick = (k) => (Q[k].includes(f[k]) ? f[k] : '');
      sv.answer = { taking: pick('taking'), feel: pick('feel'), side: pick('side'), memo: str(f.memo, 500), call: f.call === 'yes' ? 'yes' : 'no' };
      sv.answeredAt = now(); save();
      const alert = needsCall(sv.answer);
      pushAll(alert ? '⚠ 설문: 연락 필요' : '📝 설문 응답', `${maskName(sv.patient)} — ${sv.answer.feel || '-'} · 부작용 ${sv.answer.side || '-'}${sv.answer.call === 'yes' ? ' · 연락 원함' : ''}`, '', 'survey-' + m[1]);
      return page(`${title}<p>답해 주셔서 감사합니다. 🙏<br>${alert ? '불편하신 부분은 곧 연락드릴게요.' : '남은 한약도 꾸준히 드세요.'}</p>`);
    }
    const radios = (k, label) => `<fieldset><legend>${label}</legend>${Q[k].map((v, i) => `<label><input type="radio" name="${k}" value="${e(v)}" ${i === 0 && k === 'side' ? '' : ''} required>${e(v)}</label>`).join('')}</fieldset>`;
    return page(`${title}<p class="m">${e(maskName(sv.patient))}님, 한약 드신 지 보름쯤 되었어요. 1분이면 끝나요.</p>
<form method="post">${radios('taking', '1. 한약은 잘 드시고 있나요?')}${radios('feel', '2. 처음과 비교해 몸 상태는 어떠세요?')}${radios('side', '3. 드시면서 불편한 점이 있나요?')}
<fieldset><legend>4. 하고 싶은 말 (선택)</legend><textarea name="memo" rows="3" maxlength="500"></textarea>
<label><input type="checkbox" name="call" value="yes"> 한의원에서 전화 주세요</label></fieldset>
<button>보내기</button></form><p class="m">진료 내용 상담은 이 설문 대신 한의원으로 직접 연락해 주세요.</p>`);
  }

  // 환자별 "가장 최근에 기록한 출발"을 기준으로 15일 알람 계산
  function followups(today = kstDate()) {
    const latest = new Map();
    const put = (patient, c) => { const cur = latest.get(patient); if (!cur || c.rec > cur.rec) latest.set(patient, c); };
    for (const o of db.orders) {
      if (o.status === 'sent' && o.sentAt) put(o.patient, { base: kstDate(o.sentAt), rec: o.sentAt, round: o.round, total: o.total, manual: false });
    }
    for (const [patient, d] of Object.entries(db.departures)) put(patient, { base: d.date, rec: d.setAt, round: null, total: null, manual: true });
    const list = [];
    for (const [patient, c] of latest) {
      const f = db.follow[patient] && db.follow[patient].base === c.base ? db.follow[patient] : null;
      if (f && f.stopped) continue;
      const days = Math.max(0, dayDiff(today, c.base));
      const nextNo = ((f && f.ack) || 0) + 1;       // 아직 확인 안 한 첫 번째 알람
      const dueDate = addDays(c.base, nextNo * CYCLE);
      const due = today >= dueDate;
      list.push({
        patient, base: c.base, days, round: c.round, total: c.total, manual: c.manual,
        dueDate, due, late: due ? dayDiff(today, dueDate) : 0, left: due ? 0 : dayDiff(dueDate, today),
        phone: db.phones[patient] || '', ackBy: (f && f.ackBy) || '',
        survey: (() => { const sv = surveyOf(patient, c.base); return sv ? { at: sv.at, answer: sv.answer, answeredAt: sv.answeredAt, alert: needsCall(sv.answer) } : null; })(),
        kakaoAt: db.follow[patient] && db.follow[patient].base === c.base ? db.follow[patient].lastKakao || '' : '',
      });
    }
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  // 직원 텔레그램방에 하루 한 번(오전 9시 이후) 확인할 환자 알림
  let sending = false;
  // 회차별 '조제할 차례' 알림: 조제 예정일이 된 카드마다 한 번씩 (6회차면 6번)
  function roundReminders(today) {
    const ready = db.orders.filter((o) => ['need_rx', 'rx_ready'].includes(o.status) && o.dueDate && o.dueDate <= today && o.dueNotified !== o.dueDate);
    for (const o of ready) {
      o.dueNotified = o.dueDate;
      pushAll(`🌿 ${o.round || ''}회차 조제할 차례`, `${who(o)} ${o.formula || ''}${o.status === 'need_rx' ? ' — 처방전 먼저 확인' : ''}`, '', 'due-' + o.id);
    }
    if (ready.length) save();
  }

  async function digest() {
    if (sending) return;
    const today = kstDate(), hour = kstHour();
    if (hour < 9 || hour >= 20) return;
    roundReminders(today);
    cleanupPhotos();
    // 15일 알람 날: 수신동의한 환자에게 안부 + 설문 카톡 자동 발송 (알람 회차마다 한 번)
    if (alimtalk.enabled('followup')) {
      for (const x of followups(today).filter((y) => y.due)) {
        const f = db.follow[x.patient];
        if (f && f.base === x.base && f.kakaoFor === x.dueDate) continue;
        const c = contactOf(x.patient);
        if (!c.phone || !c.consent) continue;
        await sendFollowKakao(x, '자동');
      }
    }
    const due = followups(today).filter((x) => x.due);
    if (!due.length) return;
    // 휴대폰 푸시: 하루 한 번 아침 요약 (15일 확인 + 로젠 접수 대기)
    if (db.lastPushDigest !== today && db.pushSubs.length) {
      const ship = db.orders.filter((o) => o.delivery === '택배' && !o.tracking && ['compounding', 'done'].includes(o.status)).length;
      pushAll(`⏰ 오늘 확인할 환자 ${due.length}명`, `${due.slice(0, 5).map((x) => maskName(x.patient)).join(', ')}${due.length > 5 ? ` 외 ${due.length - 5}명` : ''}${ship ? ` · 로젠 접수 대기 ${ship}건` : ''}`, '', 'digest');
      db.lastPushDigest = today; save();
    }
    if (!notify || db.lastDigest === today) return;
    sending = true;
    try {
      const lines = [`⏰ 한약 ${CYCLE}일 확인 ${due.length}명`,
        ...due.slice(0, 40).map((x) => `· ${maskName(x.patient)} — 출발 ${x.base.slice(5).replace('-', '.')} (${x.days}일째)${x.late ? ` · ${x.late}일 지남` : ''}`),
        due.length > 40 ? `외 ${due.length - 40}명` : '',
        publicUrl ? `확인하기: ${publicUrl}/herb` : ''].filter(Boolean);
      if (await notify(lines.join('\n'))) { db.lastDigest = today; save(); }
    } finally { sending = false; }
  }

  async function handle(req, res, url) {
    const p = url.pathname;
    const ip = req.socket.remoteAddress || '';

    if (req.method === 'POST' && p === '/api/herb/login') {
      if (limited(ip, 'herblogin', 8, 15 * 60 * 1000)) return send(res, 429, { error: '시도가 너무 많아요. 잠시 후 다시 해주세요.' });
      const b = await readBody(req);
      if (typeof b.password === 'string' && safeEq(sign('pw' + b.password), sign('pw' + password))) {
        return send(res, 200, { token: makeToken() });
      }
      return send(res, 401, { error: '비밀번호가 맞지 않아요.' });
    }
    if (!authed(req)) return send(res, 401, { error: 'unauthorized' });

    const by = actorOf(req);
    const needActor = () => { if (!by) { send(res, 400, { error: '먼저 본인 이름을 선택해 주세요.' }); return true; } return false; };

    if (req.method === 'GET' && p === '/api/herb/state') {
      const contacts = Object.create(null);
      for (const o of db.orders) contacts[o.patient] = contactOf(o.patient);
      return send(res, 200, { contacts, alimtalk: alimtalk.enabled('shipped'), kakaoPhoto: alimtalk.enabled('photo'), kakaoWelcome: alimtalk.enabled('welcome'), kakaoFollow: alimtalk.enabled('followup'), photoRead: photoRead.enabled(), pushDevices: db.pushSubs.map((x) => x.staff), trackUrl: TRACK_URL, orders: db.orders, stock: db.stock, stockLog: db.stockLog.slice(-60).reverse(), staff: db.staff, dosageByFormula: db.dosageByFormula, dosageDefault: DOSAGE_DEFAULT, statuses: STATUSES, next: NEXT, pkgPresets: PKG_PRESETS, cycle: CYCLE, followups: followups(), today: kstDate(), cycle: CYCLE, clinicName });
    }

    if (req.method === 'PUT' && p === '/api/herb/staff') {
      const b = await readBody(req);
      const list = Array.isArray(b.staff) ? [...new Set(b.staff.map((s) => str(s, 20)).filter(Boolean))].slice(0, 30) : null;
      if (!list || !list.length) return send(res, 400, { error: '이름을 한 명 이상 넣어 주세요.' });
      db.staff = list; save();
      return send(res, 200, { staff: db.staff });
    }

    // 15일 알람: 출발 등록 / 확인 / 종료 / 연락처
    const fm = p.match(/^\/api\/herb\/follow(\/ack|\/stop|\/phone)?$/);
    if (fm && req.method === 'POST') {
      if (needActor()) return;
      const b = await readBody(req);
      const patient = str(b.patient, 30);
      if (!patient) return send(res, 400, { error: '환자 이름을 넣어 주세요.' });
      const phone = str(b.phone, 20).replace(/[^0-9+]/g, '');
      if (!fm[1]) {
        const date = b.date || kstDate();
        if (!isDate(date)) return send(res, 400, { error: '출발일이 올바르지 않아요.' });
        if (date > kstDate()) return send(res, 400, { error: '출발일은 오늘이나 지난 날짜로 넣어 주세요.' });
        db.departures[patient] = { date, setAt: now(), by };
        delete db.follow[patient];
        if (phone) db.phones[patient] = phone;
      } else {
        const item = followups().find((x) => x.patient === patient);
        if (!item) return send(res, 404, { error: '알람을 찾을 수 없어요. 새로고침 해주세요.' });
        if (fm[1] === '/phone') {
          if (phone) db.phones[patient] = phone; else delete db.phones[patient];
        } else {
          if (b.base !== item.base || (fm[1] === '/ack' && b.dueDate !== item.dueDate)) {
            return send(res, 409, { error: '방금 다른 직원이 바꿨어요. 새로고침 후 다시 해주세요.' });
          }
          if (fm[1] === '/ack') {
            if (!item.due) return send(res, 400, { error: '아직 알람 날짜가 아니에요.' });
            // 밀린 알람이 여러 번이어도 한 번 확인하면 다음 15일 시점으로 넘어감
            db.follow[patient] = { base: item.base, ack: Math.floor(item.days / CYCLE), ackBy: by, ackAt: now() };
          } else {
            db.follow[patient] = { base: item.base, stopped: true, ackBy: by, ackAt: now() };
          }
        }
      }
      save();
      return send(res, 200, { followups: followups() });
    }

    // 15일 알람: 카카오 알림톡으로 안부 보내기
    if (req.method === 'POST' && p === '/api/herb/follow/kakao') {
      if (needActor()) return;
      const b = await readBody(req);
      const item = followups().find((x) => x.patient === str(b.patient, 30));
      if (!item) return send(res, 404, { error: '알람을 찾을 수 없어요.' });
      const r = await sendFollowKakao(item, by);
      return r.ok ? send(res, 200, { ok: true }) : send(res, r.error && /미설정|없음/.test(r.error) ? 400 : 502, { error: `카톡을 보낼 수 없어요: ${r.error}` });
    }

    // 푸시 알림 구독
    if (p === '/api/herb/push/key' && req.method === 'GET') return send(res, 200, { key: push.publicKey });
    if (p === '/api/herb/push/subscribe' && req.method === 'POST') {
      if (needActor()) return;
      const b = await readBody(req, 10_000);
      const sub = b.sub || {};
      const ok = typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
        && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
      if (!ok) return send(res, 400, { error: '알림 등록 정보가 올바르지 않아요.' });
      db.pushSubs = db.pushSubs.filter((x) => x.endpoint !== sub.endpoint);
      db.pushSubs.push({ endpoint: sub.endpoint, keys: { p256dh: str(sub.keys.p256dh, 200), auth: str(sub.keys.auth, 100) }, staff: by, at: now() });
      if (db.pushSubs.length > 100) db.pushSubs = db.pushSubs.slice(-100);
      save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/herb/push/unsubscribe' && req.method === 'POST') {
      const b = await readBody(req, 10_000);
      db.pushSubs = db.pushSubs.filter((x) => x.endpoint !== b.endpoint); save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/herb/push/test' && req.method === 'POST') {
      const b = await readBody(req, 10_000);
      const sub = db.pushSubs.find((x) => x.endpoint === b.endpoint);
      if (!sub) return send(res, 404, { error: '이 폰은 알림이 등록되어 있지 않아요.' });
      const r = await push.sendOne(sub, { title: '🔔 알림 테스트', body: '이 폰으로 한약 진행 알림이 옵니다.', tag: 'test', url: '/herb' });
      return r === 'ok' ? send(res, 200, { ok: true }) : send(res, 502, { error: '보내지 못했어요. 알림을 다시 켜 주세요.' });
    }

    // 사진에서 카드 정보 읽기 (사진은 저장하지 않음)
    if (req.method === 'POST' && p === '/api/herb/scan') {
      if (needActor()) return;
      if (limited(ip, 'herbscan', 60, 3600 * 1000)) return send(res, 429, { error: '사진 읽기가 너무 많아요. 잠시 후 다시 해주세요.' });
      const b = await readBody(req, 8_000_000);
      const img = typeof b.image === 'string' ? b.image.replace(/^data:image\/\w+;base64,/, '') : '';
      if (!img || !/^[A-Za-z0-9+/=]+$/.test(img.slice(0, 200))) return send(res, 400, { error: '사진이 없어요.' });
      const r = await photoRead.read(img);
      if (!r.ok) return send(res, 422, { error: r.error });
      const d = r.data;
      const NOTNAME = /^(이름|성명|환자|환자명|처방|처방명|처방전|차트|진료|접수|수납|내원|예약|택배|직수|원장|담당|메모|한약|탕약|회차|총회차)$/;
      const name = (v) => (typeof v === 'string' && /^[가-힣]{2,5}$/.test(v.trim()) && !NOTNAME.test(v.trim()) ? v.trim() : '');
      const ph = String(d.phone || '').replace(/[^0-9]/g, '');
      return send(res, 200, {
        patient: name(d.patient),
        otherNames: (Array.isArray(d.otherNames) ? d.otherNames : []).map(name).filter(Boolean).slice(0, 6),
        formula: str(d.formula, 60), round: int(d.round, 1, 99), total: int(d.total, 1, 99),
        phone: /^01\d{8,9}$/.test(ph) ? ph : '', chartNo: str(d.chartNo, 12).replace(/[^0-9]/g, ''),
        delivery: ['택배', '직수', '내원'].includes(d.delivery) ? d.delivery : '', memo: str(d.memo, 200),
      });
    }

    // 환자 연락처·수신동의
    if (req.method === 'POST' && p === '/api/herb/contact') {
      if (needActor()) return;
      const b = await readBody(req);
      const patient = str(b.patient, 30);
      if (!patient) return send(res, 400, { error: '환자 이름을 넣어 주세요.' });
      const phone = b.phone === undefined ? undefined : str(b.phone, 20).replace(/[^0-9]/g, '');
      if (phone && !/^01\d{8,9}$/.test(phone)) return send(res, 400, { error: '휴대폰 번호를 확인해 주세요 (010으로 시작).' });
      setContact(patient, phone, typeof b.consent === 'boolean' ? b.consent : undefined, by, typeof b.adConsent === 'boolean' ? b.adConsent : undefined);
      save();
      return send(res, 200, contactOf(patient));
    }

    // 새 카드
    if (req.method === 'POST' && p === '/api/herb/orders') {
      if (needActor()) return;
      const b = await readBody(req);
      const patient = str(b.patient, 30);
      if (!patient) return send(res, 400, { error: '환자 이름을 넣어 주세요.' });
      const round = int(b.round, 1, 99);
      const pkgDays = pkgDaysOf(b.pkgDays);
      const total = pkgDays ? pkgRounds(pkgDays) : int(b.total, 1, 99);
      const status = b.hasRx ? 'rx_ready' : 'need_rx';
      const dup = dupOf(patient, round);
      if (dup && !b.force) {
        return send(res, 409, { error: `${patient}님 ${round}회차 카드가 이미 있어요 (${STATUSES[dup.status]}). 중복 조제 위험!`, dupId: dup.id });
      }
      const o = {
        id: rid(), patient, formula: str(b.formula, 60), round, total,
        delivery: ['택배', '직수', '내원'].includes(b.delivery) ? b.delivery : '택배',
        kind: ['자보', '비급여', '기타'].includes(b.kind) ? b.kind : '비급여',
        note: str(b.note, 300), assignee: '', location: '', sentAt: null,
        dueDate: isDate(b.dueDate) ? b.dueDate : kstDate(),
        dosage: str(b.dosage, 300) || (str(b.formula, 60) && db.dosageByFormula[str(b.formula, 60)]) || '',
        pkgDays, pkgStart: pkgDays ? kstDate() : '', pkgEnd: pkgDays ? addDays(kstDate(), pkgDays) : '',
        status, createdAt: now(), createdBy: by, updatedAt: now(), version: 1,
        history: [{ at: now(), by, from: null, to: status, note: '카드 생성' }],
      };
      const firstOfPatient = !db.orders.some((x) => x.patient === patient && OPEN.includes(x.status)) && (round === 1 || !db.orders.some((x) => x.patient === patient));
      const ph = str(b.phone, 20).replace(/[^0-9]/g, '');
      const ad = b.adConsent === true ? true : undefined;
      if (ph && /^01\d{8,9}$/.test(ph)) setContact(patient, ph, b.consent === true ? true : undefined, by, ad);
      else if (db.phones[patient]) setContact(patient, undefined, b.consent === true ? true : undefined, by, ad);
      db.orders.push(o); rememberDosage(o); save();
      if (status === 'rx_ready') pushAll('🌿 조제할 약', `${who(o)} ${o.formula || ''} — 새 카드`, by, 'rx-' + o.id);
      const welcome = firstOfPatient && b.welcome !== false ? await notifyWelcome(o, by) : null;
      return send(res, 201, { ...o, welcome });
    }

    const m = p.match(/^\/api\/herb\/orders\/([a-f0-9]+)(\/move)?$/);
    if (m) {
      const o = db.orders.find((x) => x.id === m[1]);
      if (!o) return send(res, 404, { error: '카드를 찾을 수 없어요. 새로고침 해주세요.' });
      if (needActor()) return;
      const b = await readBody(req, 12_000_000); // 조제 사진 포함

      // 화면을 오래 열어둔 사이 다른 사람이 바꿨으면 거절
      if (b.version != null && b.version !== o.version) {
        return send(res, 409, { error: '방금 다른 직원이 이 카드를 바꿨어요. 새로고침 후 다시 해주세요.', order: o });
      }

      if (m[2] && req.method === 'POST') {
        const to = b.to;
        if (!NEXT[o.status] || !NEXT[o.status].includes(to)) {
          return send(res, 400, { error: `'${STATUSES[o.status]}'에서 '${STATUSES[to] || to}'(으)로 바로 갈 수 없어요.` });
        }
        if (to === 'compounding') {
          if (o.status === 'compounding' && o.assignee && o.assignee !== by) {
            return send(res, 409, { error: `${o.assignee}님이 이미 조제중이에요.` });
          }
          o.assignee = by;
        }
        if (o.status === 'compounding' && o.assignee && o.assignee !== by && to !== 'done') {
          return send(res, 409, { error: `${o.assignee}님이 조제중인 카드예요. 본인만 되돌릴 수 있어요.` });
        }
        if (to === 'done') {
          const loc = str(b.location, 40);
          if (!loc && o.status !== 'hold' && o.status !== 'recall') return send(res, 400, { error: '보관 위치를 적어 주세요 (예: 냉동 A칸).' });
          if (loc) o.location = loc;
          if (o.status === 'compounding' && !o.assignee) o.assignee = by;
        }
        if (to === 'rx_ready' && o.status === 'compounding') o.assignee = '';
        if (to === 'sent' && o.delivery === '택배') {
          const t = b.tracking !== undefined ? cleanTrack(b.tracking) : o.tracking;
          if (!t || t.length < 8) return send(res, 400, { error: '로젠 송장번호를 먼저 넣어 주세요. 접수 안 된 택배는 보낼 수 없어요.' });
          const d = trackDup(t, o.id);
          if (d) return send(res, 409, { error: `이 송장번호는 ${d.patient}님 카드에 이미 있어요. 박스가 바뀌지 않았는지 확인!` });
          o.tracking = t;
        }
        if (to === 'sent') o.sentAt = now();
        const used = (to === 'done' || to === 'sent') ? applyUse(o, b.use, by, to === 'done' ? '조제' : '발송') : [];
        const usedTxt = used.length ? ' [사용: ' + used.map((u) => `${u.name} ${u.qty}`).join(', ') + ']' : '';
        log(o, by, to, str(b.note, 200) + usedTxt);
        // 이번 회차를 보내면 다음 회차 카드를 '처방전 필요'로 자동 생성 (환자마다 매번 새로 만들 필요 없음)
        let nextCard = null;
        if (to === 'sent' && o.round && o.total && o.round < o.total && !dupOf(o.patient, o.round + 1)) {
          nextCard = {
            id: rid(), patient: o.patient, formula: o.formula, round: o.round + 1, total: o.total,
            delivery: o.delivery, kind: o.kind, note: '', assignee: '', location: '', sentAt: null,
            status: 'need_rx', createdAt: now(), createdBy: by, updatedAt: now(), version: 1,
            dueDate: addDays(kstDate(o.sentAt), CYCLE), // 다음 회차 조제할 날 (직전 발송 + 15일)
            pkgDays: o.pkgDays || 0, pkgStart: o.pkgStart || '', pkgEnd: o.pkgEnd || '', dosage: o.dosage || '',
            history: [{ at: now(), by, from: null, to: 'need_rx', note: `${o.round}회차 발송 후 자동 생성 (조제 예정 ${addDays(kstDate(o.sentAt), CYCLE)})` }],
          };
          db.orders.push(nextCard);
        }
        save();
        const msg = to === 'sent' && o.delivery === '택배' ? await notifyShipped(o, by) : null;
        if (to === 'rx_ready' && ['need_rx', 'hold'].includes(o.history[o.history.length - 1].from)) pushAll('🌿 조제할 약', `${who(o)} ${o.formula || ''} — 처방전 받음`, by, 'rx-' + o.id);
        if (to === 'done' && o.delivery === '택배' && !o.tracking) pushAll('📦 로젠 접수 필요', `${who(o)} 조제완료 — 택배 접수 후 송장 입력`, by, 'ship-' + o.id);
        if (to === 'recall') pushAll('⚠ 회수 필요', `${who(o)} — ${str(b.note, 60) || '사유 확인'}`, by, 'recall-' + o.id);
        if (msg && !msg.ok && msg.error !== '알림톡 미설정') pushAll('💬 알림톡 안 보냄', `${who(o)} — ${msg.error}`, '', 'msg-' + o.id);
        return send(res, 200, { ...o, nextCard: nextCard ? { id: nextCard.id, round: nextCard.round } : null, msg });
      }

      if (!m[2] && req.method === 'PATCH') {
        const changes = [];
        if (typeof b.patient === 'string' && str(b.patient, 30) && str(b.patient, 30) !== o.patient) { o.patient = str(b.patient, 30); changes.push('이름'); }
        if (typeof b.formula === 'string' && str(b.formula, 60) !== o.formula) { o.formula = str(b.formula, 60); changes.push('처방'); }
        if (b.round !== undefined && int(b.round, 1, 99) !== o.round) {
          const r = int(b.round, 1, 99);
          const dup = dupOf(o.patient, r, o.id);
          if (dup) return send(res, 409, { error: `${o.patient}님 ${r}회차 카드가 이미 있어요.` });
          o.round = r; changes.push('회차');
        }
        if (b.total !== undefined && int(b.total, 1, 99) !== o.total) { o.total = int(b.total, 1, 99); changes.push('총회차'); }
        if (['택배', '직수', '내원'].includes(b.delivery) && b.delivery !== o.delivery) { o.delivery = b.delivery; changes.push('수령방법'); }
        if (['자보', '비급여', '기타'].includes(b.kind) && b.kind !== o.kind) { o.kind = b.kind; changes.push('구분'); }
        if (typeof b.note === 'string' && str(b.note, 300) !== o.note) { o.note = str(b.note, 300); changes.push('메모'); }
        if (typeof b.location === 'string' && str(b.location, 40) !== o.location) { o.location = str(b.location, 40); changes.push('보관위치'); }
        if (typeof b.dosage === 'string' && str(b.dosage, 300) !== (o.dosage || '')) { o.dosage = str(b.dosage, 300); rememberDosage(o); changes.push('복용법'); }
        if (b.pkgDays !== undefined && pkgDaysOf(b.pkgDays) !== (o.pkgDays || 0)) {
          const d = pkgDaysOf(b.pkgDays);
          o.pkgDays = d;
          o.pkgStart = d ? (o.pkgStart || kstDate(o.createdAt)) : '';
          o.pkgEnd = d ? addDays(o.pkgStart, d) : '';
          if (d) o.total = pkgRounds(d);
          changes.push(d ? `패키지 ${d}일` : '패키지 없음');
        }
        if (isDate(b.dueDate) && b.dueDate !== o.dueDate) { o.dueDate = b.dueDate; o.dueNotified = null; changes.push(`조제 예정 ${b.dueDate}`); }
        if (b.tracking !== undefined && cleanTrack(b.tracking) !== (o.tracking || '')) {
          const t = cleanTrack(b.tracking);
          if (t && t.length < 8) return send(res, 400, { error: '송장번호가 너무 짧아요.' });
          const d = trackDup(t, o.id);
          if (d) return send(res, 409, { error: `이 송장번호는 ${d.patient}님 카드에 이미 있어요. 박스가 바뀌지 않았는지 확인!` });
          o.tracking = t; changes.push(t ? `송장 ${t}` : '송장 삭제');
        }
        if (changes.length) {
          o.history.push({ at: now(), by, from: o.status, to: o.status, note: '수정: ' + changes.join(', ') });
          o.updatedAt = now(); o.version++; save();
        }
        return send(res, 200, o);
      }

      if (!m[2] && req.method === 'POST' && b.photos !== undefined) {
        const imgs = Array.isArray(b.photos) ? b.photos.slice(0, 4) : [];
        const bufs = imgs.map((x) => Buffer.from(String(x).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
          .filter((x) => x.length > 1000 && x.length < 3_000_000 && x[0] === 0xff && x[1] === 0xd8); // JPEG만
        if (!bufs.length && !b.sendOnly) return send(res, 400, { error: '사진이 없어요.' });
        if (bufs.length) {
          fs.mkdirSync(PHOTO_DIR, { recursive: true });
          o.photoToken = o.photoToken || crypto.randomBytes(16).toString('hex');
          o.photos = o.photos || [];
          for (const buf of bufs) {
            if (o.photos.length >= 8) break;
            const file = `${o.id}-${crypto.randomBytes(4).toString('hex')}.jpg`;
            fs.writeFileSync(path.join(PHOTO_DIR, file), buf);
            o.photos.push({ file, at: now(), by });
          }
          o.history.push({ at: now(), by, from: o.status, to: o.status, note: `조제 사진 ${bufs.length}장` });
          o.updatedAt = now(); o.version++; save();
        }
        const msg = b.notify === false ? null : await notifyPhoto(o, by, req);
        return send(res, 200, { photos: o.photos.length, link: `${baseUrl(req)}/p/${o.photoToken}`, msg });
      }

      if (!m[2] && req.method === 'POST' && b.resend === true) {
        if (o.status !== 'sent' || o.delivery !== '택배') return send(res, 400, { error: '발송된 택배 카드만 다시 보낼 수 있어요.' });
        const r = await notifyShipped(o, by);
        return send(res, 200, { msg: r });
      }

      if (!m[2] && req.method === 'DELETE') {
        if (o.status !== 'need_rx' && o.status !== 'rx_ready') {
          return send(res, 400, { error: '조제가 시작된 카드는 지울 수 없어요. 보류로 옮겨 주세요.' });
        }
        db.orders = db.orders.filter((x) => x.id !== o.id); save();
        return send(res, 200, { ok: true });
      }
    }

    // 재고
    if (req.method === 'POST' && p === '/api/herb/stock') {
      if (needActor()) return;
      const b = await readBody(req);
      const name = str(b.name, 30);
      if (!name) return send(res, 400, { error: '약 이름을 넣어 주세요.' });
      if (db.stock.some((s) => s.name === name)) return send(res, 409, { error: '이미 있는 약이에요.' });
      const s = {
        id: rid(), name, qty: Number(b.qty) || 0, unit: str(b.unit, 10) || '박스',
        cat: b.cat === '포장재' ? '포장재' : '탕약', min: Math.max(0, Number(b.min) || 0), updatedAt: now(), by,
      };
      db.stock.push(s);
      db.stockLog.push({ at: now(), by, id: s.id, name, delta: s.qty, after: s.qty, reason: '품목 추가' });
      save();
      return send(res, 201, s);
    }
    const sm = p.match(/^\/api\/herb\/stock\/([a-f0-9]+)$/);
    if (sm) {
      const s = db.stock.find((x) => x.id === sm[1]);
      if (!s) return send(res, 404, { error: 'not found' });
      if (needActor()) return;
      if (req.method === 'PATCH') {
        const b = await readBody(req);
        if (b.min !== undefined) {
          const m = Number(b.min);
          if (!Number.isFinite(m) || m < 0 || m > 100000) return send(res, 400, { error: '최소 수량이 올바르지 않아요.' });
          s.min = m;
        }
        if (typeof b.unit === 'string' && str(b.unit, 10)) s.unit = str(b.unit, 10);
        // delta: 입고(+)/사용(−),  qty: 실사(직접 센 수량)로 맞추기
        if (b.delta !== undefined) {
          const d = Number(b.delta);
          if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 100000) return send(res, 400, { error: '수량이 올바르지 않아요.' });
          stockChange(s, d, by, str(b.reason, 60) || (d > 0 ? '입고' : '사용'));
        } else if (b.qty !== undefined) {
          const q = Number(b.qty);
          if (!Number.isFinite(q) || q < 0 || q > 100000) return send(res, 400, { error: '수량이 올바르지 않아요.' });
          stockChange(s, Math.round(q * 10) / 10 - s.qty, by, '실사(직접 셈)');
        }
        save();
        return send(res, 200, s);
      }
      if (req.method === 'DELETE') { db.stock = db.stock.filter((x) => x.id !== s.id); save(); return send(res, 200, { ok: true }); }
    }

    // 엑셀/구글시트로 옮길 수 있는 CSV
    if (req.method === 'GET' && p === '/api/herb/export.csv') {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['환자', '처방', '회차', '총회차', '구분', '수령방법', '상태', '조제담당', '보관위치', '송장번호', '메모', '최근변경', '최근변경자']];
      for (const o of db.orders) {
        const last = o.history[o.history.length - 1] || {};
        rows.push([o.patient, o.formula, o.round, o.total, o.kind, o.delivery, STATUSES[o.status], o.assignee, o.location, o.tracking || '', o.note, o.updatedAt, last.by]);
      }
      const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="herb-orders.csv"',
        'Cache-Control': 'no-store',
      });
      return res.end(csv);
    }

    return send(res, 404, { error: 'not found' });
  }

  return { handle, digest, publicPage, surveyPage };
};
