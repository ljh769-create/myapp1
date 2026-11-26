(() => {
  const root = document.getElementById('admin');
  const C = window.CLINIC;
  const TK = 'admin-token';
  let token = sessionStorage.getItem(TK) || '';
  let reviews = [], tab = 'book', filter = 'all';

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  async function api(path, opt = {}) {
    const r = await fetch('/api/admin' + path, {
      ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
    });
    if (r.status === 401) { sessionStorage.removeItem(TK); token = ''; login(); throw new Error('401'); }
    return r.json();
  }

  function login(msg) {
    const err = h('div', { class: 'err' }, msg || '');
    const pw = h('input', { type: 'password', placeholder: '관리자 비밀번호', autocomplete: 'current-password' });
    const go = async () => {
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
      const j = await r.json();
      if (!r.ok) { err.textContent = j.error || '로그인 실패'; return; }
      token = j.token; sessionStorage.setItem(TK, token); start();
    };
    pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    root.replaceChildren(h('div', { class: 'loginbox' }, h('h1', {}, '🌿 예약·후기 관리'), pw, err,
      h('button', { class: 'btn primary', onclick: go }, '로그인')));
    pw.focus();
  }

  const AB = window.AdminBooking({ h, api, redraw: () => draw() });
  async function start() {
    [reviews] = await Promise.all([api('/reviews'), AB.load()]);
    draw();
  }

  // ----- 통계 -----
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const fmt = (n, d = 1) => (n == null ? '-' : n.toFixed(d));
  function countTags(key) {
    const m = {};
    reviews.forEach((r) => (r[key] || []).forEach((t) => { m[t] = (m[t] || 0) + 1; }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }
  function npsScore() {
    const v = reviews.map((r) => r.nps).filter((n) => n != null);
    if (!v.length) return null;
    const pro = v.filter((n) => n >= 9).length, det = v.filter((n) => n <= 6).length;
    return Math.round(((pro - det) / v.length) * 100);
  }
  function bars(rows, max, cls = '', suffix = '') {
    return rows.map(([lab, val, shown]) => h('div', { class: 'bar ' + cls },
      h('div', { class: 'lab' }, lab),
      h('div', { class: 'track' }, h('i', { style: `width:${max ? (val / max) * 100 : 0}%` })),
      h('div', { class: 'val' }, shown ?? String(val) + suffix)));
  }

  function summary() {
    const R = (k) => reviews.map((r) => r.ratings && r.ratings[k]).filter((n) => n != null);
    const items = [['improvement', '증상 호전'], ['explain', '설명 충분'], ['respect', '존중·편안'], ['wait', '대기시간'], ['clean', '청결']];
    const avgs = items.map(([k, l]) => [l, avg(R(k)) || 0, fmt(avg(R(k)))]);
    const lowest = avgs.filter((a) => a[1] > 0).sort((a, b) => a[1] - b[1])[0];
    const unread = reviews.filter((r) => !r.reply).length;
    const learnTexts = reviews.filter((r) => r.learnText).slice(0, 8);
    const bad = countTags('badTags').filter(([t]) => t !== '없어요');
    const learn = countTags('learnTags');
    const good = countTags('goodTags');
    return h('div', {},
      h('div', { class: 'grid' },
        h('div', { class: 'stat' }, h('b', {}, String(reviews.length)), h('span', {}, '받은 후기')),
        h('div', { class: 'stat' }, h('b', {}, String(unread)), h('span', {}, '답글 대기')),
        h('div', { class: 'stat' }, h('b', {}, npsScore() == null ? '-' : String(npsScore())), h('span', {}, '추천지수 (NPS, -100~100)')),
        h('div', { class: 'stat' }, h('b', {}, fmt(avg(R('improvement')))), h('span', {}, '증상 호전 평균 (5점)'))),
      h('div', { class: 'panel' }, h('h3', {}, '항목별 평균 (5점 만점)'), bars(avgs, 5),
        lowest && h('p', { class: 'sub' }, `💡 가장 점수가 낮은 항목은 "${lowest[0]}"(${fmt(lowest[1])})이에요. 팀 회의 주제로 삼아보세요.`)),
      h('div', { class: 'panel' }, h('h3', {}, '👍 환자들이 좋아한 점'), bars(good.slice(0, 8).map(([t, n]) => [t, n]), good[0] ? good[0][1] : 0)),
      h('div', { class: 'panel' }, h('h3', {}, '🔧 개선할 점 (우리가 배울 것)'),
        bad.length ? bars(bad.slice(0, 8).map(([t, n]) => [t, n]), bad[0][1], 'warn') : h('p', { class: 'sub' }, '아직 없어요.')),
      h('div', { class: 'panel' }, h('h3', {}, '🌱 환자들이 더 알고 싶어하는 주제 (안내문·교육 소재)'),
        learn.length ? bars(learn.slice(0, 8).map(([t, n]) => [t, n]), learn[0][1]) : h('p', { class: 'sub' }, '아직 없어요.'),
        learnTexts.map((r) => h('div', { class: 'q' }, '· ' + r.learnText))));
  }

  // ----- 후기 목록 / 답글 -----
  function reviewCard(r) {
    const ra = r.ratings || {};
    const ta = h('textarea', { rows: 3, maxlength: 1000, placeholder: '환자에게 보일 답글을 적어주세요. 환자 앱에서 바로 확인됩니다.' });
    ta.value = r.reply ? r.reply.text : '';
    const status = h('span', { class: 'meta' });
    const saveReply = async () => {
      const u = await api('/reviews/' + r.id, { method: 'PATCH', body: { reply: ta.value, read: true } });
      Object.assign(r, u); status.textContent = '저장됨 ✓'; card.classList.remove('new');
    };
    const note = h('textarea', { rows: 2, maxlength: 1000, placeholder: '🔒 직원용 메모 (환자에게 보이지 않음) - 예: 다음 회의에서 대기시간 논의' });
    note.value = r.note || '';
    note.addEventListener('change', () => api('/reviews/' + r.id, { method: 'PATCH', body: { note: note.value } }).then((u) => Object.assign(r, u)));
    const q = (label, text) => text && h('div', { class: 'q' }, h('small', {}, label), text);
    const tags = (a, cls = '') => (a || []).map((t) => h('span', { class: 'tag ' + cls }, t));
    const card = h('article', { class: 'rv' + (r.read ? '' : ' new') },
      h('div', { class: 'meta' },
        h('span', {}, new Date(r.createdAt).toLocaleString('ko-KR') + ' · ' + [r.visitCount, ...(r.treatments || [])].filter(Boolean).join(' / ')),
        h('span', {}, `호전 ${ra.improvement ?? '-'} · 설명 ${ra.explain ?? '-'} · 존중 ${ra.respect ?? '-'} · 대기 ${ra.wait ?? '-'} · 청결 ${ra.clean ?? '-'}` + (r.nps != null ? ` · 추천 ${r.nps}/10` : ''))),
      h('div', {}, tags(r.goodTags), tags((r.badTags || []).filter((t) => t !== '없어요'), 'bad'), tags(r.learnTags)),
      q('👍 좋았던 점', r.goodText), q('🔧 아쉬운 점', r.badText), q('🌱 알고 싶은 것', r.learnText),
      (r.contact && (r.contact.name || r.contact.phone)) && h('div', { class: 'q' }, h('small', {}, '📞 연락 희망'), `${r.contact.name || ''} ${r.contact.phone || ''}`),
      ta, note,
      h('div', { class: 'row' },
        h('button', { class: 'sbtn p', onclick: saveReply }, r.reply ? '답글 수정' : '답글 보내기'),
        h('button', { class: 'sbtn', onclick: async () => { const u = await api('/reviews/' + r.id, { method: 'PATCH', body: { read: !r.read } }); Object.assign(r, u); draw(); } }, r.read ? '안 읽음으로' : '읽음 표시'),
        h('button', { class: 'sbtn d', onclick: async () => { if (confirm('이 후기를 삭제할까요? 되돌릴 수 없어요.')) { await api('/reviews/' + r.id, { method: 'DELETE' }); reviews = reviews.filter((x) => x.id !== r.id); draw(); } } }, '삭제'),
        status));
    return card;
  }

  function list() {
    const f = { all: () => true, noreply: (r) => !r.reply, bad: (r) => (r.badTags || []).some((t) => t !== '없어요') || r.badText, low: (r) => Object.values(r.ratings || {}).some((v) => v != null && v <= 2) || (r.nps != null && r.nps <= 6) }[filter];
    const sel = h('div', { class: 'tabs' }, [['all', '전체'], ['noreply', '답글 안 단 것'], ['bad', '아쉬운 점 있음'], ['low', '낮은 점수']].map(([k, l]) =>
      h('button', { class: filter === k ? 'on' : '', onclick: () => { filter = k; draw(); } }, l)));
    const shown = reviews.filter(f);
    return h('div', {}, sel, shown.length ? shown.map(reviewCard) : h('p', { class: 'sub' }, '해당하는 후기가 없어요.'));
  }

  // ----- QR -----
  function qrSvg(url, size) {
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    const tmp = document.createElement('div'); tmp.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    const svg = tmp.firstElementChild; svg.setAttribute('width', size); svg.setAttribute('height', size); return svg;
  }
  function qrTab() {
    const input = h('input', { value: location.origin + '/', type: 'url' });
    const box = h('div', { class: 'qrbox' });
    const poster = h('div', { class: 'poster' });
    const draw2 = () => {
      const url = input.value.trim();
      if (!/^https?:\/\//.test(url)) { box.replaceChildren(h('p', { class: 'err' }, 'https:// 로 시작하는 주소를 입력하세요.')); return; }
      box.replaceChildren(qrSvg(url, 240), h('div', {},
        h('p', {}, '환자분이 휴대폰 카메라로 이 QR을 찍으면 후기 앱이 열려요. 열린 뒤 "홈 화면에 추가"를 하면 앱처럼 쓸 수 있어요.'),
        h('div', { class: 'row' },
          h('button', { class: 'sbtn p', onclick: () => window.print() }, '🖨 안내 포스터 인쇄'),
          h('button', { class: 'sbtn', onclick: () => dl(url) }, '⬇ QR 이미지 저장'))));
      poster.replaceChildren(h('h1', {}, `${C.name}\n치료받으시느라 수고하셨어요`), qrSvg(url, 420),
        h('p', {}, '휴대폰 카메라로 QR을 찍고 후기를 남겨주세요 (2~3분)'), h('p', {}, '여러분의 이야기가 더 좋은 진료를 만듭니다 🌿'));
    };
    const dl = (url) => {
      const svg = qrSvg(url, 1024), s = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 1024;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1024, 1024); x.drawImage(img, 0, 0, 1024, 1024);
        const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = url.includes('/booking') ? 'booking-qr.png' : 'review-qr.png'; a.click();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    };
    input.addEventListener('input', draw2); draw2();
    return h('div', {}, h('div', { class: 'panel' },
      h('h3', {}, '후기 앱 주소'), h('p', { class: 'sub' }, '서버를 인터넷에 올린 뒤의 실제 주소(https://…)를 넣으세요. 로컬 주소(localhost)는 환자 폰에서 열리지 않아요.'),
      input), h('div', { class: 'panel' }, box), poster);
  }

  function csv() {
    const head = ['일시', '방문', '치료', '호전', '설명', '존중', '대기', '청결', '추천', '좋았던점', '아쉬운점', '알고싶은것', '이름', '연락처', '답글'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = reviews.map((r) => [r.createdAt, r.visitCount, (r.treatments || []).join('/'), ...['improvement', 'explain', 'respect', 'wait', 'clean'].map((k) => r.ratings && r.ratings[k]), r.nps,
      [...(r.goodTags || []), r.goodText].join(' '), [...(r.badTags || []), r.badText].join(' '), [...(r.learnTags || []), r.learnText].join(' '),
      r.contact && r.contact.name, r.contact && r.contact.phone, r.reply && r.reply.text]);
    const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'reviews.csv'; a.click();
  }

  function draw() {
    const pend = AB.pendingCount();
    const tabs = [['book', `📅 예약${pend ? ` · 확인 ${pend}` : ''}`], ['docs', '👨‍⚕️ 원장님·진료시간'], ['summary', '📊 후기 요약'], ['list', `💬 후기 (${reviews.length})`], ['qr', '📱 QR 코드']];
    root.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'top' }, h('h1', {}, `🌿 ${C.name} 예약·후기 관리`),
        h('div', { class: 'row' }, h('button', { class: 'sbtn', onclick: csv }, '엑셀(CSV) 내보내기'),
          h('button', { class: 'sbtn', onclick: () => { sessionStorage.removeItem(TK); token = ''; login(); } }, '로그아웃'))),
      h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; draw(); } }, l))),
      tab === 'book' ? AB.bookingsTab() : tab === 'docs' ? AB.settingsTab() : tab === 'summary' ? summary() : tab === 'list' ? list() : qrTab()));
    const poster = root.querySelector('.poster'); if (poster) root.append(poster);
  }

  token ? start().catch(() => {}) : login();
})();
