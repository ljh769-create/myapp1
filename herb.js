// 한약 진행 관리 (직원용) — 환자 1명 1회차 = 카드 1장, 상태는 서버 한 곳에서만 관리
// 규칙(서버에서 강제):
//  1) 처방전 받음 상태가 아니면 조제 시작 불가
//  2) 다른 사람이 조제중인 카드는 손댈 수 없음 (중복 조제 방지)
//  3) 조제완료(보관 위치 필수)가 아니면 발송/수령 처리 불가
//  4) 같은 환자·같은 회차 카드가 진행 중이면 새로 만들 수 없음
const fs = require('fs');
const alimtalk = require('./alimtalk');
const photoRead = require('./photo-read');
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
  db.adConsent = dict(db.adConsent);   // 광고성(이벤트) 정보 수신 동의 { at, by } — 알림톡 동의와 별개
  for (const s of db.stock) { s.cat = s.cat || '탕약'; s.min = Number(s.min) || 0; }
  for (const [name, unit, qty] of DEFAULT_PACK) {
    if (!db.stock.some((x) => x.name === name)) db.stock.push({ id: rid(), name, qty, unit, cat: '포장재', min: 0, updatedAt: null, by: '' });
  }

  // 재고 변경은 전부 여기로: 누가, 왜, 얼마나 바꿨는지 남김
  function stockChange(s, delta, by, reason) {
    s.qty = Math.round((s.qty + delta) * 10) / 10;
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
        '#{택배사}': '로젠택배', '#{송장번호}': o.tracking || '', '#{조회링크}': o.tracking ? TRACK_URL + o.tracking : '',
      });
      rec.ok = r.ok; rec.error = r.ok ? '' : r.error;
    }
    o.messages = [...(o.messages || []), rec];
    save();
    return rec;
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
      });
    }
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  // 직원 텔레그램방에 하루 한 번(오전 9시 이후) 확인할 환자 알림
  let sending = false;
  async function digest() {
    if (!notify || sending) return;
    const today = kstDate(), hour = kstHour();
    if (hour < 9 || hour >= 20 || db.lastDigest === today) return;
    const due = followups(today).filter((x) => x.due);
    if (!due.length) return;
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
      return send(res, 200, { contacts, alimtalk: alimtalk.enabled('shipped'), photoRead: photoRead.enabled(), trackUrl: TRACK_URL, orders: db.orders, stock: db.stock, stockLog: db.stockLog.slice(-60).reverse(), staff: db.staff, statuses: STATUSES, next: NEXT, followups: followups(), today: kstDate(), cycle: CYCLE, clinicName });
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
      const total = int(b.total, 1, 99);
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
        status, createdAt: now(), createdBy: by, updatedAt: now(), version: 1,
        history: [{ at: now(), by, from: null, to: status, note: '카드 생성' }],
      };
      const ph = str(b.phone, 20).replace(/[^0-9]/g, '');
      const ad = b.adConsent === true ? true : undefined;
      if (ph && /^01\d{8,9}$/.test(ph)) setContact(patient, ph, b.consent === true ? true : undefined, by, ad);
      else if (db.phones[patient]) setContact(patient, undefined, b.consent === true ? true : undefined, by, ad);
      db.orders.push(o); save();
      return send(res, 201, o);
    }

    const m = p.match(/^\/api\/herb\/orders\/([a-f0-9]+)(\/move)?$/);
    if (m) {
      const o = db.orders.find((x) => x.id === m[1]);
      if (!o) return send(res, 404, { error: '카드를 찾을 수 없어요. 새로고침 해주세요.' });
      if (needActor()) return;
      const b = await readBody(req);

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
            history: [{ at: now(), by, from: null, to: 'need_rx', note: `${o.round}회차 발송 후 자동 생성` }],
          };
          db.orders.push(nextCard);
        }
        save();
        const msg = to === 'sent' && o.delivery === '택배' ? await notifyShipped(o, by) : null;
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

  return { handle, digest };
};
