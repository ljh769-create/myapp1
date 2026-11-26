// 관리자: 예약 관리 / 원장님·진료시간 설정
window.AdminBooking = (({ h, api, redraw }) => {
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const STATUS = { pending: ['확인 필요', 'pending'], confirmed: ['확정', 'confirmed'], done: ['내원 완료', 'done'], noshow: ['노쇼', 'noshow'], cancelled: ['취소', 'cancelled'] };
  let bookings = [], settings = null, view = 'upcoming', docFilter = '', loaded = false;
  const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const fmtDate = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${WEEK[new Date(d + 'T00:00:00Z').getUTCDay()]})`;
  const docName = (d) => [d.name, d.title].filter(Boolean).join(' ') || '원장님';
  const phoneFmt = (p) => (p || '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');

  async function load() {
    [bookings, settings] = await Promise.all([api('/bookings'), api('/booking-settings')]);
    loaded = true;
  }
  const pendingCount = () => bookings.filter((b) => b.status === 'pending' && b.date >= today()).length;

  // ---------------- 예약 목록 ----------------
  function card(b) {
    const doc = settings.doctors.find((d) => d.id === b.doctorId);
    const [label, cls] = STATUS[b.status] || [b.status, ''];
    const note = h('textarea', { rows: 1, maxlength: 500, placeholder: '🔒 직원 메모 (예: 문자 발송함)' });
    note.value = b.staffNote || '';
    note.addEventListener('change', async () => Object.assign(b, await api('/bookings/' + b.id, { method: 'PATCH', body: { staffNote: note.value } })));
    const set = (status) => async () => { Object.assign(b, await api('/bookings/' + b.id, { method: 'PATCH', body: { status } })); redraw(); };
    const btn = (status, text, extra = '') => b.status !== status && h('button', { class: 'sbtn ' + extra, onclick: set(status) }, text);
    return h('article', { class: 'rv bk ' + cls },
      h('div', { class: 'bkrow' },
        h('b', { class: 'bktime' }, b.time),
        h('div', { class: 'bkmain' },
          h('div', {}, h('b', {}, b.name || '(이름 없음)'), ' ',
            b.phone && h('a', { href: 'tel:' + b.phone }, phoneFmt(b.phone)), ' ',
            h('span', { class: 'tag' }, b.firstVisit ? '초진' : '재진'),
            b.source === 'staff' && h('span', { class: 'tag' }, '직원 등록')),
          h('div', { class: 'meta' }, h('span', {}, doc ? docName(doc) : b.doctorName), h('span', { class: 'st ' + cls }, label)))),
      b.memo && h('div', { class: 'q' }, h('small', {}, '환자 메모'), b.memo),
      b.status === 'cancelled' && h('div', { class: 'meta' }, `취소: ${b.cancelledBy === 'patient' ? '환자가 직접' : '직원'} · ${new Date(b.cancelledAt || b.createdAt).toLocaleString('ko-KR')}`),
      note,
      h('div', { class: 'row' },
        btn('confirmed', '✓ 확정', 'p'), btn('done', '내원 완료'), btn('noshow', '노쇼'), btn('cancelled', '취소', 'd'),
        b.status === 'cancelled' && h('button', { class: 'sbtn d', onclick: async () => { if (confirm('예약 기록을 완전히 삭제할까요?')) { await api('/bookings/' + b.id, { method: 'DELETE' }); bookings = bookings.filter((x) => x.id !== b.id); redraw(); } } }, '삭제'),
        h('span', { class: 'meta' }, '접수 ' + new Date(b.createdAt).toLocaleString('ko-KR'))));
  }

  function addForm() {
    const doc = h('select', {}, settings.doctors.map((d) => h('option', { value: d.id }, docName(d))));
    const date = h('input', { type: 'date', value: today() });
    const time = h('input', { type: 'time', value: '10:00', step: 600 });
    const name = h('input', { placeholder: '이름' });
    const phone = h('input', { placeholder: '연락처', inputmode: 'numeric' });
    const memo = h('input', { placeholder: '메모 (선택)' });
    const fv = h('select', {}, h('option', { value: '0' }, '재진'), h('option', { value: '1' }, '초진'));
    const box = h('details', { class: 'panel' }, h('summary', {}, '➕ 전화 예약 직접 등록 (해당 시간이 온라인에서 마감 처리됨)'),
      h('div', { class: 'formgrid' }, doc, date, time, fv, name, phone, memo),
      h('button', { class: 'sbtn p', onclick: async () => {
        const r = await api('/bookings', { method: 'POST', body: { doctorId: doc.value, date: date.value, time: time.value, name: name.value, phone: phone.value, memo: memo.value, firstVisit: fv.value === '1' } });
        if (r.error) return alert(r.error);
        bookings.push(r); redraw();
      } }, '등록'));
    return box;
  }

  function bookingsTab() {
    if (!loaded) { load().then(redraw).catch(() => {}); return h('p', { class: 'sub' }, '불러오는 중…'); }
    const t = today();
    const filters = {
      today: ['오늘', (b) => b.date === t && b.status !== 'cancelled'],
      tomorrow: ['내일', (b) => b.date === addDays(t, 1) && b.status !== 'cancelled'],
      upcoming: ['다가오는 예약', (b) => b.date >= t && b.status !== 'cancelled'],
      pending: [`확인 필요 (${pendingCount()})`, (b) => b.date >= t && b.status === 'pending'],
      past: ['지난 예약', (b) => b.date < t],
      cancelled: ['취소됨', (b) => b.status === 'cancelled'],
    };
    let shown = bookings.filter(filters[view][1]).filter((b) => !docFilter || b.doctorId === docFilter);
    if (view === 'past' || view === 'cancelled') shown = shown.slice().reverse();
    const groups = [];
    shown.forEach((b) => { const g = groups[groups.length - 1]; if (g && g.date === b.date) g.items.push(b); else groups.push({ date: b.date, items: [b] }); });
    const dsel = h('select', { onchange: (e) => { docFilter = e.target.value; redraw(); } }, h('option', { value: '' }, '전체 원장님'),
      settings.doctors.map((d) => h('option', { value: d.id, selected: docFilter === d.id }, docName(d))));
    return h('div', {},
      h('div', { class: 'tabs' }, Object.entries(filters).map(([k, [l]]) => h('button', { class: view === k ? 'on' : '', onclick: () => { view = k; redraw(); } }, l)),
        dsel, h('button', { onclick: async () => { await load(); redraw(); } }, '↻ 새로고침')),
      addForm(),
      groups.length ? groups.map((g) => h('section', {}, h('h3', { class: 'bkdate' }, `${fmtDate(g.date)} · ${g.items.length}건`), g.items.map(card)))
        : h('p', { class: 'sub' }, '해당하는 예약이 없어요.'));
  }

  // ---------------- 원장님·진료시간 설정 ----------------
  function resizeToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = 1200, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src); resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject; img.src = URL.createObjectURL(file);
    });
  }

  function doctorEditor(d, i, draft) {
    const inp = (key, ph, attrs = {}) => { const el = h('input', { placeholder: ph, ...attrs }); el.value = d[key] ?? ''; el.addEventListener('input', () => { d[key] = attrs.type === 'number' ? Number(el.value) : el.value; }); return el; };
    const desc = h('textarea', { rows: 3, maxlength: 400, placeholder: '소개 (예: 한의학 박사 / 전신 추나 교정 / 체형검사 …)' }); desc.value = d.desc;
    desc.addEventListener('input', () => { d.desc = desc.value; });
    const act = h('input', { type: 'checkbox' }); act.checked = d.active; act.addEventListener('change', () => { d.active = act.checked; });
    const slot = h('select', { onchange: (e) => { d.slot = Number(e.target.value); } }, [10, 15, 20, 30, 40, 60].map((m) => h('option', { value: m, selected: d.slot === m }, `${m}분 간격`)));
    const hours = h('table', { class: 'hours' }, [1, 2, 3, 4, 5, 6, 0].map((w) => {
      const on = h('input', { type: 'checkbox' }); on.checked = !!d.hours[w];
      const st = h('input', { type: 'time', value: d.hours[w] ? d.hours[w][0] : '10:00', step: 600 });
      const en = h('input', { type: 'time', value: d.hours[w] ? d.hours[w][1] : '19:00', step: 600 });
      const upd = () => { d.hours[w] = on.checked ? [st.value, en.value] : null; st.disabled = en.disabled = !on.checked; };
      [on, st, en].forEach((el) => el.addEventListener('change', upd)); st.disabled = en.disabled = !on.checked;
      return h('tr', {}, h('td', {}, h('label', {}, on, ' ' + WEEK[w])), h('td', {}, st), h('td', {}, '~'), h('td', {}, en));
    }));
    const closed = h('textarea', { rows: 2, placeholder: '이 원장님 휴진일 (예: 2026-12-24, 2026-12-31)' }); closed.value = d.closed.join(', ');
    closed.addEventListener('input', () => { d.closed = closed.value.split(/[\s,]+/).filter(Boolean); });
    const photoIn = h('input', { type: 'file', accept: 'image/*' });
    photoIn.addEventListener('change', async () => {
      if (!photoIn.files[0]) return;
      if (!settings.doctors.find((x) => x.id === d.id)) return alert('새로 추가한 원장님은 먼저 "설정 저장"을 누른 뒤 사진을 올려주세요.');
      const r = await api(`/doctors/${d.id}/photo`, { method: 'POST', body: { dataUrl: await resizeToDataUrl(photoIn.files[0]) } });
      if (r.error) return alert(r.error);
      settings = r; const nd = r.doctors.find((x) => x.id === d.id); d.photo = nd.photo; redraw();
    });
    const move = (dir) => () => { const j = i + dir; if (j < 0 || j >= draft.doctors.length) return; [draft.doctors[i], draft.doctors[j]] = [draft.doctors[j], draft.doctors[i]]; redraw(); };
    return h('div', { class: 'panel docedit' },
      h('div', { class: 'docphoto', style: d.photo ? `background-image:url('/photos/${d.photo}')` : '' }, d.photo ? '' : '사진 없음'),
      h('div', { class: 'docfields' },
        h('div', { class: 'formgrid' }, inp('name', '이름 (예: 홍길동)', { maxlength: 20 }), inp('title', '직함 (예: 대표원장)', { maxlength: 20 })),
        desc,
        h('div', { class: 'row' }, h('label', { class: 'sbtn' }, '📷 사진 올리기', photoIn),
          d.photo && h('button', { class: 'sbtn', onclick: () => { d.photo = ''; redraw(); } }, '사진 빼기'),
          h('label', { class: 'sbtn' }, act, ' 온라인 예약 받기'),
          h('button', { class: 'sbtn', onclick: move(-1) }, '↑'), h('button', { class: 'sbtn', onclick: move(1) }, '↓'),
          h('button', { class: 'sbtn d', onclick: () => { if (confirm(`${docName(d)}을(를) 목록에서 뺄까요? (저장해야 반영)`)) { draft.doctors.splice(i, 1); redraw(); } } }, '삭제')),
        h('h4', {}, '진료 요일·시간'), hours,
        h('div', { class: 'formgrid' },
          h('label', {}, '점심 시작', inp('lunchStart', '', { type: 'time', step: 600 })),
          h('label', {}, '점심 끝', inp('lunchEnd', '', { type: 'time', step: 600 })),
          h('label', {}, '예약 간격', slot),
          h('label', {}, '시간당 정원', inp('perSlot', '', { type: 'number', min: 1, max: 10 }))),
        closed));
  }

  let draft = null;
  function settingsTab() {
    if (!loaded) { load().then(redraw).catch(() => {}); return h('p', { class: 'sub' }, '불러오는 중…'); }
    if (!draft) draft = JSON.parse(JSON.stringify(settings));
    const field = (key, label, attrs = {}) => { const el = h(attrs.rows ? 'textarea' : 'input', attrs); el.value = Array.isArray(draft[key]) ? draft[key].join(', ') : draft[key];
      el.addEventListener('input', () => { draft[key] = key === 'closedDates' ? el.value.split(/[\s,]+/).filter(Boolean) : attrs.type === 'number' ? Number(el.value) : el.value; });
      return h('label', { class: 'field' }, label, el); };
    const msg = h('span', { class: 'meta' });
    const saveBtn = h('button', { class: 'btn primary savebar', onclick: async () => {
      const r = await api('/booking-settings', { method: 'PUT', body: draft });
      if (r.error) { msg.textContent = r.error; return; }
      settings = r; draft = JSON.parse(JSON.stringify(r)); redraw();
      alert('저장했어요. 예약 페이지에 바로 반영됩니다.');
    } }, '💾 설정 저장');
    const link = location.origin + '/booking';
    return h('div', {},
      h('div', { class: 'panel' }, h('h3', {}, '🔗 예약 페이지 주소'),
        h('p', { class: 'sub' }, '홈페이지·네이버 플레이스·인스타 프로필의 "예약하기" 버튼에 이 주소를 연결하세요. QR 코드 탭에 넣으면 예약용 QR도 만들 수 있어요.'),
        h('div', { class: 'row' }, h('a', { href: link, target: '_blank' }, link),
          h('button', { class: 'sbtn', onclick: () => navigator.clipboard.writeText(link).then(() => alert('복사했어요')) }, '복사'))),
      h('div', { class: 'panel' }, h('h3', {}, '공통 설정'),
        field('notice', '예약 화면 안내 문구', { rows: 2, maxlength: 500 }),
        field('phone', '병원 전화번호 (예약 화면에 표시)', { placeholder: '02-000-0000' }),
        h('div', { class: 'formgrid' },
          field('maxDaysAhead', '며칠 뒤까지 예약 받기', { type: 'number', min: 1, max: 90 }),
          field('minHoursAhead', '최소 몇 시간 전까지 예약 가능', { type: 'number', min: 0, max: 72, step: 0.5 })),
        field('closedDates', '병원 전체 휴진일 (공휴일 등, 쉼표로 구분)', { rows: 2, placeholder: '2026-12-25, 2027-01-01' })),
      h('h3', {}, '👨‍⚕️ 원장님'),
      draft.doctors.map((d, i) => doctorEditor(d, i, draft)),
      h('button', { class: 'sbtn', onclick: () => { draft.doctors.push({ id: '', name: '', title: '원장', desc: '', photo: '', active: true, hours: JSON.parse(JSON.stringify(draft.doctors[0] ? draft.doctors[0].hours : {})), lunchStart: '13:00', lunchEnd: '14:00', slot: 30, perSlot: 1, closed: [] }); redraw(); } }, '➕ 원장님 추가'),
      saveBtn, msg);
  }

  return { bookingsTab, settingsTab, pendingCount: () => (loaded ? pendingCount() : 0), load: () => load().then(() => { draft = null; }) };
});
