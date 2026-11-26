// 홈페이지 예약 (원장님별 진료 예약) — 외부 의존성 없음
// 데이터: DATA_DIR/bookings.json, DATA_DIR/booking-settings.json, DATA_DIR/photos/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SLOT_CHOICES = [10, 15, 20, 30, 40, 60];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// 서버가 어느 나라에 있든 한국 시간 기준으로 계산
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
const kstMs = (date, time) => Date.parse(`${date}T${time}:00+09:00`);
const validDate = (d) => typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const fmtKo = (d, t) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일(${WEEK[weekday(d)]})${t ? ' ' + t : ''}`;

function defaultHours(satEnd = '14:00') {
  return { 0: null, 1: ['10:00', '19:00'], 2: ['10:00', '19:00'], 3: ['10:00', '19:00'], 4: ['10:00', '19:00'], 5: ['10:00', '19:00'], 6: ['10:00', satEnd] };
}
// 원장님 이름·소개는 코드에 두지 않고 관리자 화면(/admin → 원장님·진료시간)에서 입력합니다.
function defaultSettings() {
  const doc = (id, title) => ({ id, name: '', title, desc: '', photo: '', active: true, hours: defaultHours(), lunchStart: '13:00', lunchEnd: '14:00', slot: 30, perSlot: 1, closed: [] });
  return {
    notice: '예약 접수 후 병원에서 확인 연락을 드리면 확정됩니다. 당일 예약·변경은 전화로 문의해 주세요.',
    phone: '', maxDaysAhead: 30, minHoursAhead: 1, closedDates: [],
    doctors: [doc('d1', '원장'), doc('d2', '원장'), doc('d3', '원장')],
  };
}

module.exports = function createBooking({ DATA_DIR, writeJson, tgSend, PUBLIC_URL }) {
  const BOOK_FILE = path.join(DATA_DIR, 'bookings.json');
  const SET_FILE = path.join(DATA_DIR, 'booking-settings.json');
  const PHOTO_DIR = path.join(DATA_DIR, 'photos');
  const RETENTION_DAYS = Number(process.env.BOOKING_RETENTION_DAYS) || 180;

  const load = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
  let bookings = load(BOOK_FILE, []);
  let settings = load(SET_FILE, null) || defaultSettings();
  const saveBookings = () => writeJson(BOOK_FILE, bookings);
  const saveSettings = () => writeJson(SET_FILE, settings);

  // 보관 기간이 지난 예약은 이름·연락처·메모를 지웁니다 (통계용 날짜/원장만 남김)
  function purgeOld() {
    const cut = addDays(kstToday(), -RETENTION_DAYS);
    let n = 0;
    for (const b of bookings) if (b.date < cut && (b.name || b.phone || b.memo)) { b.name = ''; b.phone = ''; b.memo = ''; b.staffNote = ''; n++; }
    if (n) saveBookings();
  }
  purgeOld();
  setInterval(purgeOld, 24 * 3600e3).unref();

  const docName = (d) => [d.name, d.title].filter(Boolean).join(' ') || '원장님';
  const findDoc = (id) => settings.doctors.find((d) => d.id === id);
  const active = (b) => b.status !== 'cancelled';
  const taken = (docId, date, time) => bookings.filter((b) => b.doctorId === docId && b.date === date && b.time === time && active(b)).length;

  function dayOpen(doc, date) {
    const today = kstToday();
    if (!validDate(date) || date < today || date > addDays(today, settings.maxDaysAhead)) return null;
    if (settings.closedDates.includes(date) || doc.closed.includes(date)) return null;
    return doc.hours[weekday(date)] || null;
  }
  function slotsFor(doc, date) {
    const hrs = dayOpen(doc, date);
    if (!hrs) return [];
    const [s, e] = hrs.map(toMin);
    const ls = doc.lunchStart ? toMin(doc.lunchStart) : -1, le = doc.lunchEnd ? toMin(doc.lunchEnd) : -1;
    const earliest = Date.now() + settings.minHoursAhead * 3600e3;
    const out = [];
    for (let t = s; t + doc.slot <= e; t += doc.slot) {
      if (ls >= 0 && t < le && t + doc.slot > ls) continue;
      const time = toHHMM(t);
      if (kstMs(date, time) < earliest) continue;
      out.push({ time, left: Math.max(0, doc.perSlot - taken(doc.id, date, time)) });
    }
    return out;
  }

  const publicDoc = (d) => ({ id: d.id, name: d.name, title: d.title, desc: d.desc, photo: d.photo ? '/photos/' + d.photo : '' });
  const patientView = (b) => {
    const d = findDoc(b.doctorId);
    return { id: b.id, doctor: d ? docName(d) : b.doctorName, date: b.date, time: b.time, status: b.status, name: b.name, createdAt: b.createdAt,
      canCancel: active(b) && b.status !== 'done' && kstMs(b.date, b.time) > Date.now() };
  };

  // ---- 설정 검증 ----
  function cleanSettings(b, str) {
    const old = settings;
    const time = (v) => (typeof v === 'string' && TIME_RE.test(v) ? v : '');
    const dates = (v) => (Array.isArray(v) ? [...new Set(v.filter(validDate))].sort().slice(-300) : []);
    const doctors = (Array.isArray(b.doctors) ? b.doctors : []).slice(0, 10).map((d) => {
      const id = typeof d.id === 'string' && /^[a-z0-9]{1,16}$/.test(d.id) ? d.id : 'd' + crypto.randomBytes(4).toString('hex');
      const prev = old.doctors.find((x) => x.id === id);
      const hours = {};
      for (let i = 0; i < 7; i++) {
        const h = d.hours && d.hours[i];
        hours[i] = Array.isArray(h) && time(h[0]) && time(h[1]) && toMin(h[0]) < toMin(h[1]) ? [h[0], h[1]] : null;
      }
      const ls = time(d.lunchStart), le = time(d.lunchEnd);
      const lunchOk = ls && le && toMin(ls) < toMin(le);
      return {
        id, name: str(d.name, 20), title: str(d.title, 20), desc: str(d.desc, 400),
        photo: d.photo === '' ? '' : (prev ? prev.photo : ''),
        active: d.active !== false, hours,
        lunchStart: lunchOk ? ls : '', lunchEnd: lunchOk ? le : '',
        slot: SLOT_CHOICES.includes(Number(d.slot)) ? Number(d.slot) : 30,
        perSlot: Math.min(10, Math.max(1, Math.round(Number(d.perSlot)) || 1)),
        closed: dates(d.closed),
      };
    });
    if (new Set(doctors.map((d) => d.id)).size !== doctors.length) throw new Error('dup');
    return {
      notice: str(b.notice, 500), phone: str(b.phone, 30),
      maxDaysAhead: Math.min(90, Math.max(1, Math.round(Number(b.maxDaysAhead)) || 30)),
      minHoursAhead: Math.min(72, Math.max(0, Number(b.minHoursAhead) || 0)),
      closedDates: dates(b.closedDates), doctors,
    };
  }

  async function handle(req, res, url, ctx) {
    const { ip, send, readBody, limited, isAdmin, sign, safeEq, str } = ctx;
    const p = url.pathname, q = url.searchParams, M = req.method;

    // ---------- 환자용 ----------
    if (M === 'GET' && p === '/api/booking/info') {
      return send(res, 200, { notice: settings.notice, phone: settings.phone, maxDaysAhead: settings.maxDaysAhead,
        doctors: settings.doctors.filter((d) => d.active).map(publicDoc) });
    }
    if (M === 'GET' && p === '/api/booking/days') {
      const doc = findDoc(q.get('doctor') || '');
      if (!doc || !doc.active) return send(res, 404, { error: '원장님 정보를 찾을 수 없어요.' });
      const today = kstToday(), days = [];
      for (let i = 0; i <= settings.maxDaysAhead; i++) {
        const date = addDays(today, i);
        const sl = slotsFor(doc, date);
        days.push({ date, open: !!dayOpen(doc, date), left: sl.filter((s) => s.left > 0).length });
      }
      return send(res, 200, days);
    }
    if (M === 'GET' && p === '/api/booking/slots') {
      const doc = findDoc(q.get('doctor') || '');
      if (!doc || !doc.active) return send(res, 404, { error: '원장님 정보를 찾을 수 없어요.' });
      return send(res, 200, slotsFor(doc, q.get('date') || ''));
    }
    if (M === 'POST' && p === '/api/booking/reserve') {
      if (limited(ip, 'book', 6, 3600e3)) return send(res, 429, { error: '예약 시도가 너무 많아요. 전화로 문의해 주세요.' });
      const b = await readBody(req);
      const doc = findDoc(str(b.doctorId, 20));
      const date = str(b.date, 10), time = str(b.time, 5);
      const name = str(b.name, 20), phone = str(b.phone, 20).replace(/[^0-9]/g, '');
      if (!doc || !doc.active) return send(res, 400, { error: '원장님을 다시 선택해 주세요.' });
      if (!name) return send(res, 400, { error: '이름을 입력해 주세요.' });
      if (!/^0\d{8,10}$/.test(phone)) return send(res, 400, { error: '연락처(휴대폰 번호)를 정확히 입력해 주세요.' });
      if (b.consent !== true) return send(res, 400, { error: '개인정보 수집·이용에 동의해 주세요.' });
      const slot = slotsFor(doc, date).find((s) => s.time === time);
      if (!slot || slot.left <= 0) return send(res, 409, { error: '방금 마감된 시간이에요. 다른 시간을 선택해 주세요.' });
      const today = kstToday();
      if (bookings.filter((x) => x.phone === phone && active(x) && x.date >= today).length >= 3) {
        return send(res, 409, { error: '이미 예약이 여러 건 있어요. 변경은 전화로 문의해 주세요.' });
      }
      const id = crypto.randomBytes(6).toString('hex'), token = crypto.randomBytes(16).toString('hex');
      const rec = { id, tokenHash: sign('b' + token), createdAt: new Date().toISOString(), doctorId: doc.id, doctorName: docName(doc),
        date, time, name, phone, firstVisit: b.firstVisit === true, memo: str(b.memo, 500), status: 'pending', staffNote: '', source: 'web' };
      bookings.push(rec); saveBookings();
      // 알림에는 환자 이름·연락처·증상을 넣지 않습니다
      tgSend([`📅 새 예약 접수 (확인 필요)`, `${docName(doc)} · ${fmtKo(date, time)}`, rec.firstVisit ? '초진' : '재진',
        PUBLIC_URL ? `확인: ${PUBLIC_URL}/admin` : ''].filter(Boolean).join('\n'));
      return send(res, 201, { id, token, booking: patientView(rec) });
    }
    if ((M === 'GET' && p === '/api/booking/my') || (M === 'POST' && p === '/api/booking/cancel')) {
      const b = M === 'GET' ? { id: q.get('id'), t: q.get('t') } : await readBody(req);
      const r = bookings.find((x) => x.id === b.id);
      if (!r || typeof b.t !== 'string' || !safeEq(r.tokenHash, sign('b' + b.t))) return send(res, 404, { error: 'not found' });
      if (M === 'GET') return send(res, 200, patientView(r));
      if (!patientView(r).canCancel) return send(res, 400, { error: '취소할 수 없는 예약이에요. 전화로 문의해 주세요.' });
      r.status = 'cancelled'; r.cancelledBy = 'patient'; r.cancelledAt = new Date().toISOString(); saveBookings();
      tgSend(`❌ 예약 취소 (환자)\n${r.doctorName} · ${fmtKo(r.date, r.time)}`);
      return send(res, 200, patientView(r));
    }

    // ---------- 관리자용 ----------
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      if (M === 'GET' && p === '/api/admin/booking-settings') return send(res, 200, settings);
      if (M === 'PUT' && p === '/api/admin/booking-settings') {
        try { settings = cleanSettings(await readBody(req, 200_000), str); } catch { return send(res, 400, { error: '설정을 확인해 주세요.' }); }
        saveSettings();
        return send(res, 200, settings);
      }
      const ph = p.match(/^\/api\/admin\/doctors\/([a-z0-9]+)\/photo$/);
      if (ph && M === 'POST') {
        const doc = findDoc(ph[1]);
        if (!doc) return send(res, 404, { error: '먼저 원장님 정보를 저장해 주세요.' });
        const { dataUrl } = await readBody(req, 4_000_000);
        const m = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!m) return send(res, 400, { error: 'JPG/PNG 사진만 올릴 수 있어요.' });
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const file = `${doc.id}${Date.now().toString(36)}.${ext}`;
        fs.mkdirSync(PHOTO_DIR, { recursive: true });
        fs.writeFileSync(path.join(PHOTO_DIR, file), Buffer.from(m[2], 'base64'));
        if (doc.photo) fs.rm(path.join(PHOTO_DIR, doc.photo), () => {});
        doc.photo = file; saveSettings();
        return send(res, 200, settings);
      }
      if (M === 'GET' && p === '/api/admin/bookings') {
        return send(res, 200, bookings.map(({ tokenHash, ...r }) => r).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
      }
      // 전화 예약 등 직원이 직접 등록 (정원 초과 허용)
      if (M === 'POST' && p === '/api/admin/bookings') {
        const b = await readBody(req);
        const doc = findDoc(str(b.doctorId, 20));
        const date = str(b.date, 10), time = str(b.time, 5);
        if (!doc || !validDate(date) || !TIME_RE.test(time)) return send(res, 400, { error: '원장님·날짜·시간을 확인해 주세요.' });
        const rec = { id: crypto.randomBytes(6).toString('hex'), tokenHash: '', createdAt: new Date().toISOString(), doctorId: doc.id, doctorName: docName(doc),
          date, time, name: str(b.name, 20), phone: str(b.phone, 20).replace(/[^0-9]/g, ''), firstVisit: b.firstVisit === true,
          memo: str(b.memo, 500), status: 'confirmed', staffNote: '', source: 'staff' };
        bookings.push(rec); saveBookings();
        const { tokenHash, ...out } = rec;
        return send(res, 201, out);
      }
      const m = p.match(/^\/api\/admin\/bookings\/([a-f0-9]+)$/);
      if (m) {
        const r = bookings.find((x) => x.id === m[1]);
        if (!r) return send(res, 404, { error: 'not found' });
        if (M === 'PATCH') {
          const b = await readBody(req);
          if (['pending', 'confirmed', 'done', 'noshow', 'cancelled'].includes(b.status)) {
            if (b.status === 'cancelled' && r.status !== 'cancelled') { r.cancelledBy = 'staff'; r.cancelledAt = new Date().toISOString(); }
            r.status = b.status;
          }
          if (typeof b.staffNote === 'string') r.staffNote = str(b.staffNote, 500);
          saveBookings();
          const { tokenHash, ...out } = r;
          return send(res, 200, out);
        }
        if (M === 'DELETE') { bookings = bookings.filter((x) => x.id !== r.id); saveBookings(); return send(res, 200, { ok: true }); }
      }
    }
    return false;
  }

  return { handle, PHOTO_DIR, getSettings: () => settings, docName };
};
