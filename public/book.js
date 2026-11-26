// 홈페이지 진료 예약: 원장님 선택 → 날짜 → 시간 → 정보 입력 → 접수
(() => {
  const root = document.getElementById('app');
  const C = window.CLINIC || {};
  const KEY = 'my-bookings';
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const STATUS = { pending: '접수됨 (확인 중)', confirmed: '예약 확정', done: '진료 완료', noshow: '미내원', cancelled: '취소됨' };
  let info = null;
  const s = { step: 'doctors', doc: null, days: [], date: '', slots: [], time: '', form: { name: '', phone: '', firstVisit: null, memo: '', consent: false }, result: null };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  const docName = (d) => [d.name, d.title].filter(Boolean).join(' ') || '원장님';
  const wd = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
  const fmtDate = (date) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${WEEK[wd(date)]})`;
  const mine = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const telLink = () => (info && info.phone ? h('a', { href: 'tel:' + info.phone.replace(/[^0-9+]/g, '') }, '📞 ' + info.phone) : null);
  async function get(url) { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || '오류'); return j; }

  // 휴대폰 뒤로가기 버튼이 이전 단계로 돌아가도록
  function go(step, push = true) {
    s.step = step;
    if (push) history.pushState({ step }, '', '#' + step);
    draw(); window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', (e) => { s.step = (e.state && e.state.step) || 'doctors'; if (s.step === 'done') s.step = 'doctors'; draw(); });

  const header = (title, back = true) => h('div', { class: 'bk-head' },
    back && h('button', { class: 'back', 'aria-label': '뒤로', onclick: () => history.back() }, '←'), h('h1', {}, title));
  const miniDoc = (d) => h('div', { class: 'mini' },
    h('i', { style: d.photo ? `background-image:url('${d.photo}')` : '' }, d.photo ? '' : '🩺'),
    h('div', {}, h('b', {}, docName(d)), h('span', {}, [s.date && fmtDate(s.date), s.time].filter(Boolean).join(' ') || '진료 예약')));

  // ---------- 1. 원장님 선택 ----------
  function doctorsView() {
    const n = mine().length;
    return h('div', { class: 'card' },
      header(`${C.name || ''} 진료 예약`.trim(), false),
      info.notice && h('div', { class: 'note' }, info.notice),
      h('p', { class: 'sub' }, '진료받으실 원장님을 선택해 주세요.'),
      info.doctors.length ? info.doctors.map((d) => h('button', { class: 'doc', onclick: () => pickDoc(d) },
        h('div', { class: 'ph', style: d.photo ? `background-image:url('${d.photo}')` : '' }, d.photo ? '' : '🩺'),
        h('div', { class: 'bd' }, h('div', { class: 'nm' }, docName(d)), d.desc && h('div', { class: 'ds' }, d.desc), h('span', { class: 'go' }, '이 원장님께 예약하기 →'))))
        : h('p', { class: 'empty' }, '지금은 온라인 예약을 받고 있지 않아요.'),
      h('button', { class: 'btn ghost', onclick: () => go('mine') }, `내 예약 확인·취소${n ? ` (${n})` : ''}`),
      info.phone && h('p', { class: 'hint center' }, '전화 예약 ', telLink()));
  }
  async function pickDoc(d) {
    s.doc = d; s.date = ''; s.time = ''; s.days = [];
    go('date');
    try { s.days = await get('/api/booking/days?doctor=' + d.id); } catch (e) { s.days = []; s.err = e.message; }
    if (s.step === 'date') draw();
  }

  // ---------- 2. 날짜 ----------
  function dateView() {
    const body = [];
    if (!s.days.length) body.push(h('p', { class: 'empty' }, s.err || '불러오는 중…'));
    let month = '';
    let grid = null;
    s.days.forEach((d, i) => {
      const m = Number(d.date.slice(5, 7)) + '월';
      if (m !== month || !grid) {
        month = m; body.push(h('div', { class: 'month' }, `${d.date.slice(0, 4)}년 ${m}`));
        grid = h('div', { class: 'days' }, WEEK.map((w, k) => h('div', { class: 'wk' + (k === 0 ? ' sun' : k === 6 ? ' sat' : '') }, w)));
        for (let k = 0; k < wd(d.date); k++) grid.append(h('span'));
        body.push(grid);
      }
      const w = wd(d.date);
      const ok = d.left > 0;
      grid.append(h('button', { class: 'day' + (w === 0 ? ' sun' : w === 6 ? ' sat' : '') + (s.date === d.date ? ' on' : ''), disabled: !ok,
        'aria-label': fmtDate(d.date) + (ok ? '' : ' 예약 불가'), onclick: () => pickDate(d.date) },
        h('span', { class: 'd' }, String(Number(d.date.slice(8)))), h('small', {}, i === 0 ? '오늘' : !d.open ? '휴진' : ok ? '가능' : '마감')));
    });
    return h('div', { class: 'card' }, header('날짜 선택'), miniDoc(s.doc), ...body,
      h('p', { class: 'hint' }, '회색 날짜는 휴진이거나 예약이 마감된 날이에요.'));
  }
  async function pickDate(date) {
    s.date = date; s.time = ''; s.slots = [];
    go('time');
    try { s.slots = await get(`/api/booking/slots?doctor=${s.doc.id}&date=${date}`); } catch (e) { s.err = e.message; }
    if (s.step === 'time') draw();
  }

  // ---------- 3. 시간 ----------
  function timeView() {
    const am = s.slots.filter((x) => x.time < '12:00'), pm = s.slots.filter((x) => x.time >= '12:00');
    const grid = (list) => h('div', { class: 'times' }, list.map((x) => h('button', { class: 'tm' + (s.time === x.time ? ' on' : ''), disabled: x.left <= 0,
      'aria-label': x.time + (x.left > 0 ? '' : ' 마감'), onclick: () => { s.time = x.time; go('form'); } }, x.time)));
    return h('div', { class: 'card' }, header('시간 선택'), miniDoc(s.doc),
      !s.slots.length ? h('p', { class: 'empty' }, '불러오는 중…') : [
        am.length && h('div', { class: 'ampm' }, '오전'), am.length && grid(am),
        pm.length && h('div', { class: 'ampm' }, '오후'), pm.length && grid(pm)]);
  }

  // ---------- 4. 정보 입력 ----------
  function formView() {
    const f = s.form;
    const err = h('div', { class: 'err' });
    const name = h('input', { autocomplete: 'name', maxlength: 20, value: f.name, placeholder: '홍길동' });
    const phone = h('input', { type: 'tel', inputmode: 'numeric', autocomplete: 'tel', maxlength: 13, value: f.phone, placeholder: '010-0000-0000' });
    const memo = h('textarea', { rows: 3, maxlength: 500, placeholder: '예) 허리 통증 2주째, 교통사고 치료 문의 등 (선택)' });
    memo.value = f.memo;
    const consent = h('input', { type: 'checkbox' }); consent.checked = f.consent;
    const sync = () => { f.name = name.value; f.phone = phone.value; f.memo = memo.value; f.consent = consent.checked; };
    [name, phone, memo, consent].forEach((el) => el.addEventListener('input', sync));
    consent.addEventListener('change', sync);
    const fv = h('div', { class: 'chips' }, [[true, '처음 방문 (초진)'], [false, '다닌 적 있어요 (재진)']].map(([v, l]) =>
      h('button', { class: 'chip' + (f.firstVisit === v ? ' on' : ''), onclick: (e) => { f.firstVisit = v; [...fv.children].forEach((c) => c.classList.remove('on')); e.currentTarget.classList.add('on'); } }, l)));
    const submit = h('button', { class: 'btn primary', onclick: async () => {
      sync(); err.textContent = '';
      if (!f.name.trim()) return (err.textContent = '이름을 입력해 주세요.');
      if (!/^0\d{8,10}$/.test(f.phone.replace(/[^0-9]/g, ''))) return (err.textContent = '휴대폰 번호를 정확히 입력해 주세요.');
      if (f.firstVisit == null) return (err.textContent = '초진/재진을 선택해 주세요.');
      if (!f.consent) return (err.textContent = '개인정보 수집·이용에 동의해 주세요.');
      submit.disabled = true; submit.textContent = '접수 중…';
      try {
        const r = await fetch('/api/booking/reserve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doctorId: s.doc.id, date: s.date, time: s.time, name: f.name, phone: f.phone, firstVisit: f.firstVisit, memo: f.memo, consent: true }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || '접수하지 못했어요.');
        localStorage.setItem(KEY, JSON.stringify([{ id: j.id, t: j.token }, ...mine()].slice(0, 10)));
        s.result = j.booking; s.form.memo = '';
        history.replaceState({ step: 'doctors' }, '', '#'); go('done', false);
      } catch (e) { err.textContent = e.message; submit.disabled = false; submit.textContent = '예약 접수하기'; }
    } }, '예약 접수하기');
    return h('div', { class: 'card' }, header('예약자 정보'), miniDoc(s.doc),
      h('label', { class: 'field' }, '이름', name),
      h('label', { class: 'field' }, '휴대폰 번호', phone),
      h('div', { class: 'field' }, '방문 구분'), fv,
      h('label', { class: 'field' }, '증상·요청사항 (선택)', memo),
      h('label', { class: 'consent' }, consent, h('span', {}, h('b', {}, '[필수] 개인정보 수집·이용 동의'), h('br'),
        `수집 항목: 이름, 휴대폰 번호, 증상 메모 · 목적: 진료 예약 확인 및 안내 연락 · 보관: 예약일로부터 180일 후 파기. 동의하지 않으시면 전화로 예약해 주세요.`)),
      err, submit);
  }

  // ---------- 5. 완료 ----------
  const summary = (b) => h('div', { class: 'sum' },
    h('div', {}, h('span', {}, '원장님'), h('b', {}, b.doctor)),
    h('div', {}, h('span', {}, '일시'), h('b', {}, `${fmtDate(b.date)} ${b.time}`)),
    h('div', {}, h('span', {}, '예약자'), h('b', {}, b.name || '-')),
    h('div', {}, h('span', {}, '상태'), h('span', { class: 'st ' + b.status }, STATUS[b.status] || b.status)));
  function doneView() {
    return h('div', { class: 'card center' }, h('div', { class: 'logo' }, '✅'), h('h1', {}, '예약이 접수되었어요'),
      h('p', { class: 'lead' }, '병원에서 확인 후 연락드리면 예약이 확정됩니다.'), summary(s.result),
      h('div', { class: 'note' }, '변경·취소는 "내 예약 확인"에서 하실 수 있어요. 이 기기(브라우저)에서만 조회되니 필요하면 화면을 캡처해 두세요.'),
      h('button', { class: 'btn primary', onclick: () => go('mine') }, '내 예약 확인'),
      h('button', { class: 'btn link', onclick: () => { history.replaceState({ step: 'doctors' }, '', '#'); go('doctors', false); } }, '처음으로'));
  }

  // ---------- 내 예약 ----------
  function mineView() {
    const box = h('div', {}, h('p', { class: 'empty' }, '불러오는 중…'));
    (async () => {
      const list = mine();
      if (!list.length) { box.replaceChildren(h('p', { class: 'empty' }, '이 기기에서 접수한 예약이 없어요.')); return; }
      const keep = [], cards = [];
      for (const m of list) {
        try {
          const b = await get(`/api/booking/my?id=${m.id}&t=${m.t}`);
          keep.push(m);
          cards.push(h('div', {}, summary(b), b.canCancel && h('button', { class: 'btn ghost', onclick: async (e) => {
            if (!confirm(`${fmtDate(b.date)} ${b.time} 예약을 취소할까요?`)) return;
            e.currentTarget.disabled = true;
            const r = await fetch('/api/booking/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, t: m.t }) });
            const j = await r.json(); if (!r.ok) alert(j.error || '취소하지 못했어요.');
            draw();
          } }, '이 예약 취소하기')));
        } catch { /* 삭제된 예약은 목록에서 제외 */ }
      }
      localStorage.setItem(KEY, JSON.stringify(keep));
      box.replaceChildren(...(cards.length ? cards : [h('p', { class: 'empty' }, '조회되는 예약이 없어요.')]));
    })();
    return h('div', { class: 'card' }, header('내 예약 확인'), box,
      info.phone && h('p', { class: 'hint center' }, '변경 문의 ', telLink()));
  }

  function draw() {
    if (!info) return;
    if (s.step !== 'doctors' && s.step !== 'mine' && !s.doc) s.step = 'doctors';
    if (s.step === 'done' && !s.result) s.step = 'doctors';
    s.err = s.err && s.step === 'date' ? s.err : '';
    const v = { doctors: doctorsView, date: dateView, time: timeView, form: formView, done: doneView, mine: mineView }[s.step] || doctorsView;
    root.replaceChildren(v());
  }

  (async () => {
    try { info = await get('/api/booking/info'); } catch {
      root.replaceChildren(h('div', { class: 'card center' }, h('div', { class: 'logo' }, '📅'), h('h1', {}, '예약 화면을 불러오지 못했어요'),
        h('p', { class: 'lead' }, '잠시 후 다시 열어 주세요.'))); return;
    }
    document.title = `${C.name ? C.name + ' ' : ''}진료 예약`;
    const start = location.hash === '#mine' ? 'mine' : 'doctors';
    history.replaceState({ step: start }, '', start === 'mine' ? '#mine' : location.pathname);
    s.step = start; draw();
  })();
})();
