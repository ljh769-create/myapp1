// 한약 진행 관리 (직원용 화면)
(() => {
  const $app = document.getElementById('app');
  const LS = { token: 'herbToken', me: 'herbMe' };
  let S = { orders: [], stock: [], staff: [], statuses: {}, next: {}, followups: [] };
  let tab = 'alarm';
  let q = '';
  let showSent = false;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => localStorage.getItem(LS.me) || '';
  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();
  const packs = () => S.stock.filter((x) => x.cat === '포장재');
  const low = () => S.stock.filter((x) => x.min > 0 ? x.qty <= x.min : x.qty <= 0);
  // 조제/발송 때 쓴 포장재 입력칸 (직전에 쓴 값을 기억)
  const USE_KEY = (kind) => 'herbUse_' + kind;
  function useHTML(kind, defaults) {
    const saved = JSON.parse(localStorage.getItem(USE_KEY(kind)) || '{}');
    const items = packs();
    if (!items.length) return '';
    return `<div class="f"><span>사용한 포장재 (재고에서 자동 차감)</span><div class="uses">${items.map((x) => {
      const v = saved[x.id] ?? defaults(x) ?? '';
      return `<label class="use"><em>${esc(x.name)}</em><input type="number" min="0" inputmode="numeric" data-use="${x.id}" value="${esc(v)}"><small>${esc(x.unit)} · 남은 ${x.qty}</small></label>`;
    }).join('')}</div></div>`;
  }
  function readUse(el, kind) {
    const use = [], keep = {};
    el.querySelectorAll('[data-use]').forEach((i) => { keep[i.dataset.use] = i.value; const q = Number(i.value); if (q > 0) use.push({ id: i.dataset.use, qty: q }); });
    localStorage.setItem(USE_KEY(kind), JSON.stringify(keep));
    return use;
  }
  const contact = (n) => (S.contacts && S.contacts[n]) || { phone: '', consent: false };
  const needTrack = (o) => o.delivery === '택배' && !o.tracking && ['compounding', 'done'].includes(o.status);
  const maskPhone = (p) => (p ? p.replace(/^(\d{3})\d+(\d{4})$/, '$1-****-$2') : '');
  const msgWhy = (n) => { const c = contact(n); return !S.alimtalk ? '알림톡 미설정' : !c.phone ? '연락처 없음' : !c.consent ? '수신동의 없음' : ''; };
  // 송장번호 입력 (휴대폰 크롬은 카메라로 바코드 스캔 가능)
  function openTrack(id, after) {
    const o = S.orders.find((x) => x.id === id);
    if (!o) return;
    sheet(`<h3>${esc(o.patient)} ${esc(roundTxt(o))} 로젠 송장번호</h3>
      <p class="sub">로젠 앱에서 접수한 뒤 송장번호를 넣어 주세요. 송장이 있어야 발송할 수 있어요.</p>
      <label class="f"><span>송장번호</span><input id="trk" inputmode="numeric" autocomplete="off" value="${esc(o.tracking || '')}" placeholder="숫자만"></label>
      ${'BarcodeDetector' in window ? '<p><button type="button" class="ab" id="scan">📷 바코드 스캔</button></p><video id="cam" playsinline style="display:none;width:100%;border-radius:12px"></video>' : ''}
      <div class="okrow"><button class="ab" data-close>취소</button><button class="ab p" id="ok">저장</button></div>`, (el) => {
      let stream;
      const stop = () => stream && stream.getTracks().forEach((t) => t.stop());
      el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) stop(); });
      const scan = el.querySelector('#scan');
      if (scan) scan.onclick = async () => {
        try {
          const det = new BarcodeDetector({ formats: ['code_128', 'code_39', 'itf', 'ean_13', 'qr_code'] });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          const v = el.querySelector('#cam'); v.srcObject = stream; v.style.display = 'block'; await v.play();
          const tick = async () => {
            if (!el.isConnected || !stream.active) return;
            const r = await det.detect(v).catch(() => []);
            const hit = r.map((x) => x.rawValue.replace(/[^0-9]/g, '')).find((x) => x.length >= 8);
            if (hit) { el.querySelector('#trk').value = hit; stop(); v.style.display = 'none'; toast('스캔했어요: ' + hit); } else requestAnimationFrame(tick);
          };
          tick();
        } catch { toast('카메라를 쓸 수 없어요. 직접 입력해 주세요.', true); }
      };
      el.querySelector('#ok').onclick = async () => {
        try { await api('PATCH', `/api/herb/orders/${id}`, { version: o.version, tracking: el.querySelector('#trk').value }); stop(); el.remove(); toast('송장번호 저장'); await load(); after && after(); }
        catch (e) { toast(e.message, true); }
      };
    });
  }
  // 사진을 긴 변 1600px JPEG로 줄여 base64로
  function shrink(file, max = 1600) {
    return new Promise((ok, no) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); no(new Error('사진을 열 수 없어요.')); };
      img.src = url;
    });
  }
  const photoInput = (id) => `<label class="ab" style="display:block;text-align:center;min-height:48px;line-height:30px;cursor:pointer">📷 한약 사진 찍기<input type="file" accept="image/*" capture="environment" multiple id="${id}" hidden></label><div class="thumbs" id="${id}-prev"></div>`;
  function bindPhotoInput(el, id) {
    const inp = el.querySelector('#' + id), prev = el.querySelector('#' + id + '-prev'), files = [];
    if (!inp) return () => [];
    inp.onchange = () => {
      for (const f of inp.files) if (files.length < 4) files.push(f);
      prev.innerHTML = files.map((f) => `<img src="${URL.createObjectURL(f)}">`).join('') + (files.length ? `<small>${files.length}장 · 더 찍으려면 다시 누르세요</small>` : '');
      inp.value = '';
    };
    return () => files;
  }
  async function uploadPhotos(id, files, notify = true) {
    const photos = []; for (const f of files) photos.push(await shrink(f, 1280));
    return api('POST', `/api/herb/orders/${id}`, { photos, notify });
  }
  const msgToast = (m, okText) => (m ? (m.ok ? okText : m.error === '알림톡 미설정' ? '' : ` · 카톡 안 보냄(${m.error})`) : '');
  const md2 = (d) => (d ? `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}` : '');
  const roundTxt = (o) => (o.round ? `${o.round}${o.total ? '/' + o.total : '회차'}` : '');

  function toast(msg, err) {
    document.querySelectorAll('.toast').forEach((x) => x.remove());
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' e' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), err ? 4500 : 2200);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (localStorage.getItem(LS.token) || ''),
        'X-Staff': encodeURIComponent(me()),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { localStorage.removeItem(LS.token); render(); throw new Error('다시 로그인해 주세요.'); }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.blob();
    if (!res.ok) { const e = new Error(data.error || '오류가 났어요.'); e.data = data; e.status = res.status; throw e; }
    return data;
  }

  async function load() {
    try { S = await api('GET', '/api/herb/state'); if (!document.querySelector('.sheet')) render(); openPending(); } catch (e) { if (localStorage.getItem(LS.token)) toast(e.message, true); }
  }

  // ---------- 화면 ----------
  function render() {
    if (!localStorage.getItem(LS.token)) return renderLogin();
    if (!me()) return renderPickMe();
    const counts = Object.fromEntries(Object.keys(S.statuses).map((k) => [k, S.orders.filter((o) => o.status === k).length]));
    $app.innerHTML = `
      <div class="hw">
        <div class="htop">
          <h1>🌿 한약 진행</h1>
          <div class="me">지금 사용자: <b>${esc(me())}</b> · <a href="#" data-a="whoami">바꾸기</a></div>
        </div>
        <div class="htabs">
          ${[['alarm', `⏰ 15일 알람${dueCount() ? ` (${dueCount()})` : ''}`], ['board', `진행판`], ['patients', '환자'], ['today', '오늘 요약(단톡용)'], ['stock', '상비 재고'], ['settings', '설정']]
            .map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
        </div>
        <div id="body"></div>
      </div>
      ${tab === 'board' ? '<button class="fab" data-a="new">＋ 새 한약</button>' : ''}
      ${tab === 'alarm' ? '<button class="fab" data-a="depart">＋ 출발 등록</button>' : ''}`;
    const body = $app.querySelector('#body');
    if (tab === 'alarm') body.innerHTML = alarmHTML();
    if (tab === 'board') body.innerHTML = boardHTML(counts);
    if (tab === 'today') body.innerHTML = todayHTML();
    if (tab === 'stock') body.innerHTML = stockHTML();
    if (tab === 'patients') body.innerHTML = patientsHTML();
    if (tab === 'settings') body.innerHTML = settingsHTML();
    if (tab === 'settings') pushStatus();
    const s = body.querySelector('.search');
    if (s) { s.value = q; s.oninput = () => { q = s.value.trim(); const pos = s.selectionStart; render(); const n = $app.querySelector('.search'); n.focus(); n.setSelectionRange(pos, pos); }; }
  }

  function renderLogin() {
    $app.innerHTML = `
      <div class="loginbox">
        <h1>🌿 한약 진행</h1>
        <p class="lead">직원 공용 비밀번호를 입력하세요.</p>
        <form id="lf">
          <label class="f"><input type="password" name="pw" autocomplete="current-password" placeholder="비밀번호" required></label>
          <div class="err" id="le"></div>
          <button class="ab p" style="width:100%;min-height:50px;font-size:17px">들어가기</button>
        </form>
      </div>`;
    $app.querySelector('#lf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const { token } = await api('POST', '/api/herb/login', { password: e.target.pw.value });
        localStorage.setItem(LS.token, token);
        await load();
        render();
      } catch (err) { $app.querySelector('#le').textContent = err.message; }
    };
  }

  function renderPickMe() {
    $app.innerHTML = `
      <div class="loginbox">
        <h1>누구세요?</h1>
        <p class="lead">조제·발송 기록에 이 이름이 남습니다. 이 휴대폰은 본인만 쓰세요.</p>
        <div class="seg" style="margin:16px 0">
          ${S.staff.map((n) => `<button data-me="${esc(n)}">${esc(n)}</button>`).join('')}
        </div>
        <p class="hint">이름이 없으면 <b>설정</b>에서 추가할 수 있어요. 먼저 아무 이름이나 골라 들어간 뒤 바꿔 주세요.</p>
      </div>`;
  }

  // ---------- 15일 알람 ----------
  const dueCount = () => (S.followups || []).filter((x) => x.due).length;
  const md = (d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
  const smsText = (x) => `[${S.clinicName || '한의원'}] ${x.patient}님, 한약 보내드린 지 ${x.days}일 되었어요. 드시면서 불편한 점은 없으신가요? 편하게 연락 주세요.`;
  function followCard(x) {
    const k = esc(x.patient);
    return `<div class="hcard ${x.due ? 'recall' : 'done'}">
      <div><span class="nm">${k}</span>${x.round ? `<span class="rd">${x.round}${x.total ? '/' + x.total : ''}회차</span>` : ''}
        <span class="badge ${x.due ? 'r' : ''}">${x.due ? (x.late ? `${x.late}일 지남` : '오늘 확인') : `${x.left}일 남음`}</span></div>
      <div class="meta">출발 ${md(x.base)} · 오늘 ${x.days}일째 · 알람일 ${md(x.dueDate)}${x.ackBy ? ' · 지난 확인 ' + esc(x.ackBy) : ''}</div>
      ${x.kakaoAt ? `<div class="who">💬 안부·설문 카톡 ${fmt(x.kakaoAt)}</div>` : ''}
      ${x.survey ? (x.survey.answer
        ? `<div class="note" style="${x.survey.alert ? 'background:#fde5e2' : ''}">${x.survey.alert ? '⚠ <b>연락 필요</b> · ' : '📝 '}설문 ${fmt(x.survey.answeredAt)}<br>복용: ${esc(x.survey.answer.taking)} · 상태: ${esc(x.survey.answer.feel)} · 불편: ${esc(x.survey.answer.side)}${x.survey.answer.call === 'yes' ? ' · <b>전화 원함</b>' : ''}${x.survey.answer.memo ? '<br>' + esc(x.survey.answer.memo) : ''}</div>`
        : '<div class="who">📝 설문 아직 답 없음</div>') : ''}
      <div class="acts">
        ${x.due ? `<button class="ab p" data-follow="ack" data-p="${k}">확인 완료</button>` : ''}
        ${!x.phone ? `<button class="ab" data-follow="phone" data-p="${k}">연락처 넣기</button>`
          : S.kakaoFollow ? (contact(x.patient).consent ? `<button class="ab" data-follow="kakao" data-p="${k}">💬 카톡 보내기</button>` : `<button class="ab" data-pcontact="${k}">수신동의 넣기</button>`)
          : `<a class="ab" href="sms:${esc(x.phone)}?&body=${encodeURIComponent(smsText(x))}">📱 문자 보내기</a>`}
        <button class="ab" data-follow="copy" data-p="${k}">문구 복사</button>
        <button class="ab" data-follow="again" data-p="${k}">새로 출발</button>
        <button class="ab w" data-follow="stop" data-p="${k}">알람 끝내기</button>
        ${x.phone ? `<button class="ab" data-follow="phone" data-p="${k}">번호 수정</button>` : ''}
      </div></div>`;
  }
  function alarmHTML() {
    const list = S.followups || [], due = list.filter((x) => x.due), later = list.filter((x) => !x.due);
    return `<div class="rule">한약이 <b>출발한 날</b>부터 <b>${S.cycle || 15}일마다</b> 알람이 떠요. 환자에게 연락한 뒤 <b>확인 완료</b>를 누르면 다음 ${S.cycle || 15}일 뒤에 다시 알려드려요. 진행판에서 발송한 약은 자동으로 들어와요.</div>
      <div class="cols">
        <div class="col need_rx"><h2>지금 확인할 환자 <span>${due.length}</span></h2>${due.map(followCard).join('') || '<div class="empty">없음</div>'}</div>
        <div class="col"><h2>다음 알람 대기 <span>${later.length}</span></h2>${later.map(followCard).join('') || '<div class="empty">없음</div>'}</div>
      </div>`;
  }
  function openDepart(name = '') {
    sheet(`<h3>한약 출발 등록</h3>
      <form id="df">
        <label class="f"><span>환자 이름 *</span><input name="patient" required maxlength="30" autocomplete="off" value="${esc(name)}"></label>
        <label class="f"><span>한약 출발일 (이름 넣는 날이 아니라 약이 나간 날)</span><input name="date" type="date" required max="${S.today}" value="${S.today}"></label>
        <label class="f"><span>휴대폰 번호 (선택 · 문자 보낼 때만)</span><input name="phone" type="tel" maxlength="20"></label>
        <div class="err" id="de"></div>
        <div class="okrow"><button type="button" class="ab" data-close>취소</button><button class="ab p">등록</button></div>
      </form>`, (el) => {
      const f = el.querySelector('#df');
      f.onsubmit = async (e) => {
        e.preventDefault();
        try { await api('POST', '/api/herb/follow', { patient: f.patient.value, date: f.date.value, phone: f.phone.value }); el.remove(); toast('등록했어요'); load(); }
        catch (err) { el.querySelector('#de').textContent = err.message; }
      };
    });
  }
  async function follow(act, name) {
    const x = (S.followups || []).find((y) => y.patient === name);
    if (!x) return load();
    if (act === 'again') return openDepart(name);
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(smsText(x)); toast('문구를 복사했어요'); } catch { prompt('아래 문구를 복사하세요', smsText(x)); }
      return;
    }
    const body = { patient: name, base: x.base, dueDate: x.dueDate };
    if (act === 'kakao') {
      try { await api('POST', '/api/herb/follow/kakao', { patient: name }); toast(`${name}님께 카톡을 보냈어요. 답이 오면 확인 완료를 눌러 주세요.`); }
      catch (e) { toast(e.message, true); }
      return;
    }
    if (act === 'phone') { const v = prompt(`${name}님 휴대폰 번호 (비우면 삭제)`, x.phone); if (v === null) return; body.phone = v; }
    if (act === 'stop' && !confirm(`${name}님 알람을 끝낼까요? (다시 출발 등록하면 새로 시작돼요)`)) return;
    try { await api('POST', `/api/herb/follow/${act}`, body); toast(act === 'ack' ? '확인했어요' : act === 'stop' ? '알람을 끝냈어요' : '저장했어요'); }
    catch (e) { toast(e.message, true); }
    load();
  }

  // ---------- 진행판 ----------
  const COLS = ['need_rx', 'rx_ready', 'compounding', 'done', 'recall', 'hold'];
  const match = (o) => !q || [o.patient, o.formula, o.note, o.assignee, o.location].some((v) => (v || '').includes(q));

  function boardHTML(counts) {
    const sent = S.orders.filter((o) => o.status === 'sent' && match(o)).sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
    const lw = low();
    return `
      ${lw.length ? `<div class="warnbox" data-tab="stock" style="cursor:pointer">⚠ <b>재고 부족 — 주문/제작 필요</b><br>${lw.map((x) => `${esc(x.name)} ${x.qty}${esc(x.unit)}${x.min ? ` (최소 ${x.min})` : ''}`).join(' · ')}</div>` : ''}
      ${(() => { const t = S.orders.filter(needTrack); return t.length ? `<div class="warnbox">📦 <b>로젠 접수할 택배 ${t.length}건</b>: ${t.map((o) => `<a href="#" data-track="${o.id}">${esc(o.patient)} ${esc(roundTxt(o))}</a>`).join(' · ')}</div>` : ''; })()}
      ${S.photoRead ? '<p><button class="ab p" data-a="newphoto" style="width:100%;min-height:50px;font-size:17px">📷 사진 찍어서 새 카드</button></p>' : ''}
      <div class="rule"><b>규칙</b> ① 조제 전에 <b>조제 시작</b>을 눌러 내 이름을 건다 ② 처방전 없으면 조제 버튼이 안 나온다 ③ <b>조제완료</b>(보관 위치 기록)가 된 약만 발송할 수 있다</div>
      <input class="search" type="search" placeholder="환자 이름·처방·메모 검색">
      <div class="cols">
        ${COLS.filter((k) => k !== 'hold' && k !== 'recall' || counts[k]).map((k) => {
          const list = S.orders.filter((o) => o.status === k && match(o)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
          return `<div class="col ${k}"><h2>${esc(S.statuses[k])} <span>${list.length}</span></h2>
            ${list.map(cardHTML).join('') || '<div class="empty">없음</div>'}</div>`;
        }).join('')}
      </div>
      <p style="margin-top:18px"><button class="ab" data-a="togglesent">${showSent ? '▲ 발송·수령 완료 숨기기' : `▼ 발송·수령 완료 보기 (${sent.length})`}</button></p>
      ${showSent ? `<div class="cols"><div class="col sent">${sent.slice(0, 100).map(cardHTML).join('') || '<div class="empty">없음</div>'}</div></div>` : ''}`;
  }

  function cardHTML(o) {
    const same = S.orders.filter((x) => x.id !== o.id && x.patient === o.patient && x.round === o.round && x.round && x.status !== 'sent');
    const mine = o.assignee === me();
    let acts = '';
    const b = (to, label, cls = '') => `<button class="ab ${cls}" data-move="${o.id}" data-to="${to}">${label}</button>`;
    switch (o.status) {
      case 'need_rx': acts = b('rx_ready', '처방전 받음', 'p') + b('hold', '보류'); break;
      case 'rx_ready': acts = b('compounding', '조제 시작 (내가 함)', 'p') + b('need_rx', '처방전 없음'); break;
      case 'compounding':
        acts = mine ? b('done', '조제완료', 'p') + b('rx_ready', '조제 취소') : b('done', `${esc(o.assignee)}님 대신 완료처리`);
        if (o.delivery === '택배') acts += `<button class="ab" data-track="${o.id}">${o.tracking ? '송장 수정' : '📦 송장 입력'}</button>`;
        break;
      case 'done':
        acts = needTrack(o)
          ? `<button class="ab p" data-track="${o.id}">📦 로젠 송장 입력</button>` + b('hold', '보류')
          : b('sent', o.delivery === '택배' ? '택배 발송함' : '환자 수령함', 'p') + (o.delivery === '택배' ? `<button class="ab" data-track="${o.id}">송장 수정</button>` : '') + b('hold', '보류');
        break;
      case 'sent': acts = b('recall', '회수 필요', 'w'); break;
      case 'hold': acts = b('need_rx', '처방전 필요로') + b('rx_ready', '처방전 받음으로') + b('done', '조제완료로'); break;
      case 'recall': acts = b('done', '회수함 → 보관', 'p') + b('need_rx', '처방전 필요로') + b('hold', '보류'); break;
    }
    return `<div class="hcard ${o.status}">
      <div><a href="#" class="nm" data-open="${o.id}">${esc(o.patient)}</a><span class="rd">${esc(roundTxt(o))}</span>
        <span class="badge">${esc(o.kind)}</span><span class="badge">${esc(o.delivery)}</span>
        ${same.length ? '<span class="badge r">⚠ 같은 회차 중복</span>' : ''}
        ${needTrack(o) ? '<span class="badge r">📦 로젠 접수 필요</span>' : ''}
        ${o.tracking ? `<span class="badge">✅ 송장 ${esc(o.tracking.slice(-4))}</span>` : ''}
        ${o.dueDate && ['need_rx', 'rx_ready'].includes(o.status) ? (o.dueDate > S.today ? `<span class="badge">📅 ${md2(o.dueDate)} 조제 예정</span>` : '<span class="badge r">📅 조제할 차례</span>') : ''}
        ${(o.photos || []).length ? `<span class="badge">📷 ${o.photos.length}</span>` : ''}
        ${o.delivery === '택배' && o.status !== 'sent' && msgWhy(o.patient) === '연락처 없음' ? '<span class="badge">📵 연락처 없음</span>' : ''}</div>
      <div class="meta">${esc(o.formula || '처방 미기재')}${o.location ? ' · 📦 ' + esc(o.location) : ''} · ${fmt(o.updatedAt)}</div>
      ${o.assignee ? `<div class="who">조제: <b>${esc(o.assignee)}</b></div>` : ''}
      ${o.status === 'sent' ? `<div class="who">${esc(o.delivery)} ${fmt(o.sentAt)} · ${esc(o.history[o.history.length - 1]?.by || '')}${(() => { const m = (o.messages || []).slice(-1)[0]; return m ? (m.ok ? ' · 💬 알림톡 보냄' : ` · <span style="color:#b3261e">💬 안 보냄(${esc(m.error)})</span>`) : ''; })()}</div>` : ''}
      ${o.note ? `<div class="note">${esc(o.note)}</div>` : ''}
      <div class="acts">${acts}${['done', 'sent'].includes(o.status) ? `<button class="ab" data-photo="${o.id}">📷 사진</button>` : ''}</div>
    </div>`;
  }
  function openPhoto(id) {
    const o = S.orders.find((x) => x.id === id); if (!o) return;
    const n = (o.photos || []).length;
    sheet(`<h3>${esc(o.patient)} ${esc(roundTxt(o))} 한약 사진</h3>
      ${n ? `<p class="sub">지금 ${n}장 · <a href="/p/${esc(o.photoToken)}" target="_blank">환자에게 보이는 화면 보기</a></p>` : ''}
      ${photoInput('aph')}
      ${S.kakaoPhoto ? (msgWhy(o.patient) ? `<div class="warnbox">💬 카톡 안 보냄: ${esc(msgWhy(o.patient))}</div>` : `<label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sendph" style="width:auto" checked> 환자에게 카톡으로 보내기 (${esc(maskPhone(contact(o.patient).phone))})</label>`) : '<p class="sub">카톡 사진 안내는 알림톡 설정 후 사용할 수 있어요.</p>'}
      <div class="okrow"><button class="ab" data-close>닫기</button>${n && S.kakaoPhoto && !msgWhy(o.patient) ? '<button class="ab" id="resendph">기존 사진 다시 보내기</button>' : ''}<button class="ab p" id="ok">저장</button></div>`, (el) => {
      const getPh = bindPhotoInput(el, 'aph');
      const send = !!el.querySelector('#sendph');
      el.querySelector('#ok').onclick = async () => {
        if (!getPh().length) return toast('사진을 먼저 찍어 주세요.', true);
        try { const r = await uploadPhotos(id, getPh(), send && el.querySelector('#sendph').checked); el.remove(); toast(`사진 ${r.photos}장 저장` + msgToast(r.msg, ' · 카톡 보냄'), r.msg && !r.msg.ok && r.msg.error !== '알림톡 미설정'); load(); }
        catch (e) { toast(e.message, true); }
      };
      const rs = el.querySelector('#resendph');
      if (rs) rs.onclick = async () => {
        try { const r = await api('POST', `/api/herb/orders/${id}`, { photos: [], sendOnly: true }); el.remove(); toast(r.msg && r.msg.ok ? '카톡 보냄' : '안 보냄: ' + (r.msg ? r.msg.error : ''), !(r.msg && r.msg.ok)); load(); }
        catch (e) { toast(e.message, true); }
      };
    });
  }

  // ---------- 오늘 요약 ----------
  function summaryText() {
    const d = new Date();
    const wd = '일월화수목금토'[d.getDay()];
    const by = (k) => S.orders.filter((o) => o.status === k);
    const line = (o, extra = '') => `${o.patient} ${roundTxt(o)}${o.formula ? ' ' + o.formula : ''}${extra}`;
    const sec = (title, list) => `- ${title}\n${list.length ? list.join('\n') : '(없음)'}`;
    const sentToday = S.orders.filter((o) => o.status === 'sent' && isToday(o.sentAt));
    const madeToday = S.orders.filter((o) => o.history.some((h) => h.to === 'done' && isToday(h.at) && h.from === 'compounding'));
    return [
      `< ${String(d.getFullYear()).slice(2)}. ${d.getMonth() + 1}. ${d.getDate()}. ${wd} >`,
      '',
      ...(dueCount() ? [sec('⏰ 15일 확인', S.followups.filter((x) => x.due).map((x) => `${x.patient} (출발 ${md(x.base)}, ${x.days}일째)`)), ''] : []),
      sec('필요처방전', by('need_rx').map((o) => line(o, o.note ? ` → ${o.note}` : ''))),
      '',
      sec('처방전 받음 (조제 전)', by('rx_ready').map((o) => line(o))),
      '',
      sec('조제중', by('compounding').map((o) => line(o, ` (${o.assignee})`))),
      '',
      sec('오늘 조제완료', madeToday.map((o) => {
        const h = [...o.history].reverse().find((x) => x.to === 'done' && x.from === 'compounding');
        return line(o, ` - ${o.assignee || h?.by || ''} 조제`);
      })),
      '',
      sec('보관 중 (발송 대기)', by('done').map((o) => line(o, ` [${o.location}] ${o.delivery}`))),
      '',
      '------------------------------',
      '보낸약',
      '',
      sec('택배', sentToday.filter((o) => o.delivery === '택배').map((o) => line(o, o.tracking ? ` (로젠 ${o.tracking})` : ''))),
      '',
      sec('직수/내원', sentToday.filter((o) => o.delivery !== '택배').map((o) => line(o))),
      ...(by('recall').length ? ['', sec('⚠ 회수 필요', by('recall').map((o) => line(o, o.note ? ` → ${o.note}` : '')))] : []),
      '',
      '------------------------------',
      '상비 탕약재고',
      S.stock.filter((s) => s.cat !== '포장재').map((s) => `${s.name} ${s.qty}`).join(' / '),
      '',
      '포장재',
      packs().map((s) => `${s.name} ${s.qty}${s.unit}`).join(' / '),
      ...(low().length ? ['', '⚠ 부족 (주문/제작 필요): ' + low().map((s) => `${s.name} ${s.qty}${s.unit}`).join(', ')] : []),
    ].join('\n');
  }
  function todayHTML() {
    return `<p class="sub">매일 손으로 복사하던 단톡방 양식을 앱이 대신 만들어요. 복사해서 단톡방에 붙여넣기만 하세요.</p>
      <p><button class="ab p" data-a="copy">📋 복사하기</button></p>
      <pre class="sum">${esc(summaryText())}</pre>`;
  }

  // ---------- 재고 ----------
  function stockHTML() {
    const row = (s) => {
      const isLow = s.min > 0 ? s.qty <= s.min : s.qty <= 0;
      return `<tr class="${isLow ? 'lowrow' : ''}">
        <td><b>${esc(s.name)}</b>${isLow ? ' <span class="badge r">부족</span>' : ''}<br><small style="color:var(--mut)">최소 ${s.min || '-'} ${esc(s.unit)} · <a href="#" data-stockmin="${s.id}">최소 설정</a></small></td>
        <td><div class="qty"><button class="ab" data-stock="${s.id}" data-d="-1">−</button><b class="${s.qty <= 0 ? 'zero' : ''}">${s.qty}</b><button class="ab" data-stock="${s.id}" data-d="1">＋</button></div>
          <div class="acts" style="margin-top:4px"><button class="ab" data-stockin="${s.id}">입고</button><button class="ab" data-stockset="${s.id}">실사</button></div></td>
        <td style="font-size:13px;color:var(--mut)">${s.updatedAt ? fmt(s.updatedAt) + '<br>' + esc(s.by) : '-'}</td></tr>`;
    };
    const table = (title, list) => `<h3 style="margin:16px 4px 8px">${title}</h3><table class="tbl"><tr><th>품목</th><th>수량</th><th>최근</th></tr>${list.map(row).join('') || '<tr><td colspan="3" class="empty">없음</td></tr>'}</table>`;
    return `<p class="sub">파우치·박스는 <b>조제완료/택배 발송 때 입력한 만큼 자동으로 빠져요.</b> 새로 들어오면 <b>입고</b>, 직접 세어 맞출 땐 <b>실사</b>. 최소 수량 아래로 내려가면 진행판 맨 위에 경고가 떠요.</p>
      ${table('📦 포장재', S.stock.filter((x) => x.cat === '포장재'))}
      ${table('🍵 상비 탕약', S.stock.filter((x) => x.cat !== '포장재'))}
      <p><button class="ab" data-a="addstock">＋ 품목 추가</button></p>
      <h3 style="margin:16px 4px 8px">최근 재고 변동</h3>
      <div class="hist">${(S.stockLog || []).slice(0, 40).map((l) => `<div><time>${fmt(l.at)}</time><b>${esc(l.by)}</b> ${esc(l.name)} ${l.delta > 0 ? '+' : ''}${l.delta} → ${l.after} · ${esc(l.reason)}</div>`).join('') || '<div class="empty">기록 없음</div>'}</div>`;
  }

  // ---------- 환자 (진행 중 / 진행 끝) ----------
  const OPEN_ST = ['need_rx', 'rx_ready', 'compounding', 'done', 'hold', 'recall'];
  function patientList() {
    const by = new Map();
    for (const o of S.orders) { if (!by.has(o.patient)) by.set(o.patient, []); by.get(o.patient).push(o); }
    return [...by].map(([name, list]) => {
      const sent = list.filter((o) => o.status === 'sent').sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
      const last = sent[0];
      const open = list.some((o) => OPEN_ST.includes(o.status));
      // 끝: 진행 중 카드가 없고, 마지막 발송이 마지막 회차(또는 회차 정보 없음)
      const done = !open && !!last && (!last.total || !last.round || last.round >= last.total);
      return { name, list, last, open, done, formulas: [...new Set(list.map((o) => o.formula).filter(Boolean))], c: contact(name) };
    });
  }
  const quarter = (d = new Date()) => `${d.getFullYear()}년 ${Math.floor(d.getMonth() / 3) + 1}분기`;
  function patientsHTML() {
    const all = patientList().filter((x) => !q || x.name.includes(q));
    const active = all.filter((x) => !x.done), done = all.filter((x) => x.done).sort((a, b) => (b.last.sentAt || '').localeCompare(a.last.sentAt || ''));
    const ev = done.filter((x) => x.c.phone && x.c.adConsent);
    const row = (x) => `<div class="hcard ${x.done ? 'sent' : 'rx_ready'}">
      <div><b class="nm">${esc(x.name)}</b> ${x.last ? `<span class="rd">${esc(roundTxt(x.last))}</span>` : ''}
        ${x.c.phone ? `<span class="badge">📱 ${esc(maskPhone(x.c.phone))}</span>` : '<span class="badge">📵 연락처 없음</span>'}
        ${x.c.adConsent ? '<span class="badge">이벤트 동의</span>' : ''}</div>
      <div class="meta">${esc(x.formulas.join(', ') || '처방 미기재')} · 카드 ${x.list.length}장${x.last ? ` · 마지막 발송 ${fmt(x.last.sentAt)}` : ''}</div>
      <div class="acts"><button class="ab" data-pcontact="${esc(x.name)}">연락처·동의</button>${x.done ? `<button class="ab" data-again="${esc(x.name)}">재처방 카드 만들기</button>` : ''}</div>
    </div>`;
    return `<input class="search" type="search" placeholder="환자 이름 검색">
      <div class="rule"><b>${quarter()} 이벤트 안내 대상</b>: 진행이 끝났고 <b>이벤트 수신 동의</b>를 받은 환자 <b>${ev.length}명</b>
        <br>이벤트·할인 안내는 광고라서 <b>이벤트 수신 동의</b>를 따로 받은 환자에게만 보낼 수 있어요. 문구는 의료광고 심의 기준을 지켜야 해요.
        <p style="margin:8px 0 0"><button class="ab p" data-a="evcsv" ${ev.length ? '' : 'disabled'}>⬇ 대상 명단 받기 (솔라피 대량발송용)</button></p></div>
      <div class="cols">
        <div class="col compounding"><h2>진행 중 <span>${active.length}</span></h2>${active.map(row).join('') || '<div class="empty">없음</div>'}</div>
        <div class="col"><h2>진행 끝 <span>${done.length}</span></h2>${done.map(row).join('') || '<div class="empty">없음</div>'}</div>
      </div>`;
  }
  function openContact(name) {
    const c = contact(name);
    sheet(`<h3>${esc(name)} 연락처·동의</h3>
      <form id="pc">
        <label class="f"><span>휴대폰 번호</span><input name="phone" type="tel" value="${esc(c.phone)}" placeholder="01012345678"></label>
        <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="consent" style="width:auto" ${c.consent ? 'checked' : ''}> 알림톡(조제·배송 안내) 수신 동의</label>
        <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="ad" style="width:auto" ${c.adConsent ? 'checked' : ''}> 이벤트·할인 안내(광고) 수신 동의 <small>(따로 받은 경우만)</small></label>
        <div class="okrow"><button type="button" class="ab" data-close>닫기</button><button class="ab p">저장</button></div>
      </form>`, (el) => {
      const f = el.querySelector('#pc');
      f.onsubmit = async (e) => {
        e.preventDefault();
        try { await api('POST', '/api/herb/contact', { patient: name, phone: f.phone.value, consent: f.consent.checked, adConsent: f.ad.checked }); el.remove(); toast('저장했어요'); load(); }
        catch (err) { toast(err.message, true); }
      };
    });
  }

  // ---------- 푸시 알림 ----------
  const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iPhone|iPad/.test(navigator.userAgent);
  const b64ToBytes = (b) => { const s = atob((b + '='.repeat((4 - (b.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  async function mySub() { const r = await navigator.serviceWorker.ready; return r.pushManager.getSubscription(); }
  async function pushStatus() {
    const el = document.getElementById('pushstat'); if (!el) return;
    if (!pushOK()) { el.innerHTML = isIOS ? '아이폰은 <b>홈 화면에 앱으로 설치한 뒤</b> 그 앱에서 켤 수 있어요 (iOS 16.4 이상).' : '이 브라우저는 알림을 지원하지 않아요. 크롬을 써 주세요.'; return; }
    if (Notification.permission === 'denied') { el.innerHTML = '알림이 <b>차단</b>되어 있어요. 폰 설정 → 앱/사이트 알림에서 허용해 주세요.'; return; }
    const sub = await mySub().catch(() => null);
    el.innerHTML = sub
      ? '✅ 이 폰은 알림을 받고 있어요. <button class="ab" data-a="pushtest">테스트 보내기</button> <button class="ab w" data-a="pushoff">끄기</button>'
      : '<button class="ab p" data-a="pushon">🔔 이 폰 알림 켜기</button>';
  }
  async function pushOn() {
    try {
      if (await Notification.requestPermission() !== 'granted') { toast('알림을 허용해야 받을 수 있어요.', true); return pushStatus(); }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api('GET', '/api/herb/push/key');
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))) !== btoa(String.fromCharCode(...b64ToBytes(key)))) { await sub.unsubscribe(); sub = null; }
      sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await api('POST', '/api/herb/push/subscribe', { sub: sub.toJSON() });
      toast('알림을 켰어요'); await load(); pushStatus();
    } catch (e) { toast('알림을 켜지 못했어요: ' + e.message, true); }
  }

  // ---------- 설정 ----------
  function settingsHTML() {
    return `<div class="panel" style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px">
        <h3>직원 이름</h3>
        <p class="sub">쉼표로 구분해서 적으세요.</p>
        <input id="staffin" class="search" value="${esc(S.staff.join(', '))}">
        <button class="ab p" data-a="savestaff">저장</button>
      </div>
      <p><a class="ab p" href="/herb-link.html" style="display:inline-block;text-decoration:none">🔗 오케이차트 연결 버튼 설치</a></p>
      <div class="rule" id="pushbox"><b>🔔 이 폰으로 알림 받기</b><br>
        조제할 약, 로젠 접수 필요, 회수, 재고 부족, 15일 확인 환자(아침 1회)를 알려 줘요. 잠금화면에는 이름이 가려져 보여요 (김○수).<br>
        <span id="pushstat">확인 중…</span><br>
        <small>지금 알림 받는 폰: ${(S.pushDevices || []).length ? esc((S.pushDevices || []).join(', ')) : '없음'}</small></div>
      <div class="rule"><b>📱 휴대폰에 앱으로 설치</b><br>
        ${matchMedia('(display-mode: standalone)').matches ? '✅ 지금 앱으로 쓰고 있어요.'
          : installEvt ? '<button class="ab p" data-a="install">홈 화면에 앱 설치</button>'
          : /iPhone|iPad/.test(navigator.userAgent) ? '사파리 아래 <b>공유(□↑)</b> → <b>홈 화면에 추가</b>'
          : '크롬 오른쪽 위 <b>⋮</b> → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>'}</div>
      <p><button class="ab" data-a="csv">⬇ 전체 목록 엑셀(CSV) 받기</button></p>
      <p><button class="ab w" data-a="logout">로그아웃</button></p>`;
  }

  // ---------- 시트(팝업) ----------
  function sheet(html, onMount) {
    const el = document.createElement('div');
    el.className = 'sheet';
    el.innerHTML = `<div class="in">${html}</div>`;
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
    document.body.appendChild(el);
    onMount && onMount(el);
    return el;
  }
  const segHTML = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  function bindSeg(el) {
    el.querySelectorAll('[data-seg]').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      g.dispatchEvent(new Event('change'));
    }));
  }
  const segVal = (el, name) => el.querySelector(`[data-seg="${name}"] .on`)?.dataset.v;

  function openNew(pre = {}) {
    const chips = (name, list) => (list && list.length > 1 ? `<div class="seg cand" data-cand="${name}">${list.slice(0, 8).map((v) => `<button type="button">${esc(v)}</button>`).join('')}</div>` : '');
    sheet(`<h3>새 한약 카드</h3>
      ${S.photoRead ? `<p><label class="ab p" style="display:block;text-align:center;font-size:17px;min-height:50px;line-height:32px;cursor:pointer">📷 차트·처방전 사진으로 채우기<input type="file" accept="image/*" capture="environment" id="photo" hidden></label></p><div id="photomsg"></div>` : ''}
      ${pre.fromChart ? '<div class="warnbox" style="background:var(--gl);color:var(--gd)">차트 화면에서 읽어 왔어요. <b>이름·처방이 맞는지 확인</b>하고, 후보가 여러 개면 맞는 것을 눌러 주세요.</div>' : ''}
      <form id="nf">
        <label class="f"><span>환자 이름 *</span><input name="patient" required autocomplete="off" value="${esc(pre.patient || '')}"></label>${chips('patient', pre.patients)}
        <div id="dupwarn"></div>
        <label class="f"><span>처방</span><input name="formula" placeholder="예: 당귀수산" list="formulas" value="${esc(pre.formula || '')}"></label>${chips('formula', pre.formulas)}
        <datalist id="formulas">${S.stock.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>
        <div class="two">
          <label class="f"><span>이번 회차</span><input name="round" type="number" min="1" max="99" inputmode="numeric"></label>
          <label class="f"><span>총 회차</span><input name="total" type="number" min="1" max="99" inputmode="numeric" value="6"></label>
        </div>
        <div class="f"><span>처방전</span>${segHTML('rx', [['0', '아직 없음'], ['1', '받았음']], pre.fromChart ? '1' : '0')}</div>
        <div class="f"><span>구분</span>${segHTML('kind', [['비급여', '비급여'], ['자보', '자보'], ['기타', '기타']], '비급여')}</div>
        <div class="f"><span>받는 방법</span>${segHTML('delivery', [['택배', '택배'], ['직수', '직수'], ['내원', '내원']], '택배')}</div>
        <label class="f"><span>휴대폰 번호 (알림톡용 · 선택)</span><input name="phone" type="tel" placeholder="01012345678"></label>
        <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="consent" style="width:auto"> 알림톡 수신 동의 받음</label>
        <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="adConsent" style="width:auto"> 이벤트·할인 안내(광고) 수신 동의 받음</label>
        <label class="f"><span>메모</span><textarea name="note" rows="2" placeholder="예: 전화로 지을 예정, 처방전 있는지 확인">${esc(pre.note || '')}</textarea></label>
        <div class="err" id="ne"></div>
        <div class="okrow"><button type="button" class="ab" data-close>취소</button><button class="ab p">만들기</button></div>
      </form>`, (el) => {
      bindSeg(el);
      const f = el.querySelector('#nf');
      const warn = () => {
        const nm = f.patient.value.trim();
        const list = nm ? S.orders.filter((o) => o.patient === nm && o.status !== 'sent') : [];
        el.querySelector('#dupwarn').innerHTML = list.length
          ? `<div class="warnbox">⚠ ${esc(nm)}님 진행 중 카드가 이미 있어요:<br>${list.map((o) => `${esc(roundTxt(o) || '회차 없음')} ${esc(o.formula)} — <b>${esc(S.statuses[o.status])}</b>`).join('<br>')}<br>새로 만들지 말고 기존 카드를 쓰세요.</div>` : '';
      };
      // 이미 진행했던 환자면 다음 회차·처방·받는 방법을 자동으로 채움
      const fillNext = () => {
        const nm = f.patient.value.trim();
        const past = S.orders.filter((o) => o.patient === nm).sort((a, b) => (b.round || 0) - (a.round || 0) || b.updatedAt.localeCompare(a.updatedAt))[0];
        if (!past) return;
        if (!f.round.value && past.round && (!past.total || past.round < past.total)) f.round.value = past.round + 1;
        if (past.total) f.total.value = past.total;
        if (!f.formula.value && past.formula) f.formula.value = past.formula;
        const setSeg = (n, v) => el.querySelectorAll(`[data-seg="${n}"] button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
        setSeg('delivery', past.delivery); setSeg('kind', past.kind);
        const c = contact(nm); if (c.phone && !f.phone.value) f.phone.value = c.phone; if (c.consent) f.consent.checked = true; if (c.adConsent) f.adConsent.checked = true;
      };
      el.querySelectorAll('[data-cand]').forEach((g) => g.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        f[g.dataset.cand].value = b.textContent;
        g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        if (g.dataset.cand === 'patient') { warn(); fillNext(); }
      }));
      f.patient.addEventListener('input', warn);
      f.patient.addEventListener('change', fillNext);
      const ph = el.querySelector('#photo');
      if (ph) ph.onchange = async () => {
        const file = ph.files[0]; if (!file) return;
        const msg = el.querySelector('#photomsg');
        msg.innerHTML = '<div class="warnbox" style="background:var(--gl);color:var(--gd)">⏳ 사진 읽는 중… (5~15초)</div>';
        try {
          const d = await api('POST', '/api/herb/scan', { image: await shrink(file) });
          const set = (k, v) => { if (v) f[k].value = v; };
          set('patient', d.patient); set('formula', d.formula); set('round', d.round); set('total', d.total); set('phone', d.phone);
          if (d.chartNo && !f.note.value.includes(d.chartNo)) f.note.value = [f.note.value, `차트번호 ${d.chartNo}`, d.memo].filter(Boolean).join(' / ');
          else if (d.memo) f.note.value = [f.note.value, d.memo].filter(Boolean).join(' / ');
          if (d.delivery) el.querySelectorAll('[data-seg="delivery"] button').forEach((b) => b.classList.toggle('on', b.dataset.v === d.delivery));
          const others = d.otherNames.filter((n) => n !== d.patient);
          msg.innerHTML = `<div class="warnbox" style="background:var(--gl);color:var(--gd)">📷 사진에서 읽었어요. <b>이름·처방·회차가 맞는지 꼭 확인</b>하세요.${d.patient ? '' : '<br><b>환자 이름을 못 읽었어요.</b> 직접 넣어 주세요.'}</div>`
            + (others.length ? `<div class="seg cand">${others.map((n) => `<button type="button" data-pick="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : '');
          msg.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { f.patient.value = b.dataset.pick; warn(); fillNext(); }));
          warn(); fillNext();
        } catch (err) { msg.innerHTML = `<div class="warnbox">${esc(err.message)}</div>`; }
        ph.value = '';
      };
      if (f.patient.value) { warn(); fillNext(); }
      f.onsubmit = async (e) => {
        e.preventDefault();
        const body = {
          patient: f.patient.value, formula: f.formula.value, round: f.round.value || null, total: f.total.value || null,
          hasRx: segVal(el, 'rx') === '1', kind: segVal(el, 'kind'), delivery: segVal(el, 'delivery'), note: f.note.value,
          phone: f.phone.value, consent: f.consent.checked, adConsent: f.adConsent.checked,
        };
        try { await api('POST', '/api/herb/orders', body); el.remove(); toast('카드를 만들었어요'); load(); }
        catch (err) {
          if (err.status === 409 && err.data?.dupId) {
            el.querySelector('#ne').innerHTML = `${esc(err.message)}<br><button type="button" class="ab w" id="force">그래도 새로 만들기</button>`;
            el.querySelector('#force').onclick = async () => {
              try { await api('POST', '/api/herb/orders', { ...body, force: true }); el.remove(); load(); } catch (e2) { toast(e2.message, true); }
            };
          } else el.querySelector('#ne').textContent = err.message;
        }
      };
      if (!f.patient.value) f.patient.focus();
    });
  }

  // 차트 버튼(북마클릿)이 #new=... 으로 보낸 내용 받기. 주소 뒤 # 부분은 서버로 전송되지 않음
  let pendingNew = null;
  try {
    const m = location.hash.match(/^#new=(.+)$/);
    if (m) { pendingNew = { ...JSON.parse(decodeURIComponent(m[1])), fromChart: true }; history.replaceState(null, '', location.pathname); }
  } catch { pendingNew = null; }
  function openPending() {
    if (!pendingNew || !localStorage.getItem(LS.token) || !me() || !S.staff.length) return;
    const p = pendingNew; pendingNew = null;
    tab = 'board'; render();
    const clean = (a) => [...new Set((a || []).filter((x) => x != null).map((x) => String(x).trim()).filter(Boolean))];
    const patients = clean([p.patient, ...(p.patients || [])]);
    const formulas = clean([p.formula, ...(p.formulas || [])]);
    // 재고 목록에 있는 처방명을 우선
    formulas.sort((a, b) => S.stock.some((s) => s.name === b) - S.stock.some((s) => s.name === a));
    openNew({ fromChart: true, patient: patients[0] || '', patients, formula: formulas[0] || '', formulas, note: p.chartNo ? `차트번호 ${p.chartNo}` : '' });
  }

  async function move(id, to) {
    const o = S.orders.find((x) => x.id === id);
    if (!o) return;
    const body = { to, version: o.version };
    if (to === 'done') {
      return sheet(`<h3>${esc(o.patient)} ${esc(roundTxt(o))} 조제완료</h3>
        ${o.status === 'compounding' && o.assignee && o.assignee !== me() ? `<div class="warnbox">${esc(o.assignee)}님이 조제중인 카드예요. 정말 완료된 걸 확인했나요?</div>` : ''}
        <label class="f"><span>보관 위치 *</span><input id="loc" value="${esc(o.location)}" placeholder="예: 냉동 A칸, 택배 선반"></label>
        <div class="seg" style="margin-bottom:6px">${['냉동', '냉장', '택배 선반', '데스크'].map((x) => `<button type="button" data-loc="${x}">${x}</button>`).join('')}</div>
        <div class="f"><span>한약 사진 (환자에게 카톡으로 보낼 수 있어요)</span>${photoInput('dph')}</div>
        ${S.kakaoPhoto ? `<label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sendph" style="width:auto" checked ${msgWhy(o.patient) ? 'disabled' : ''}> 사진을 환자에게 카톡으로 보내기 ${msgWhy(o.patient) ? `<small>(${esc(msgWhy(o.patient))})</small>` : `<small>${esc(maskPhone(contact(o.patient).phone))}</small>`}</label>` : ''}
        ${o.status === 'compounding' ? useHTML('done', (x) => (x.name === '파우치' ? '' : x.name === '쌍화탕 박스' ? '' : '')) : ''}
        <label class="f"><span>메모 (선택)</span><input id="mn"></label>
        <div class="okrow"><button class="ab" data-close>취소</button><button class="ab p" id="ok">완료</button></div>`, (el) => {
        el.querySelectorAll('[data-loc]').forEach((b) => (b.onclick = () => { el.querySelector('#loc').value = b.dataset.loc; }));
        const getPh = bindPhotoInput(el, 'dph');
        el.querySelector('#ok').onclick = async () => {
          try {
            await api('POST', `/api/herb/orders/${id}/move`, { ...body, location: el.querySelector('#loc').value, note: el.querySelector('#mn').value, use: readUse(el, 'done') });
            el.remove();
            let extra = '';
            if (getPh().length) {
              toast('조제완료 · 사진 올리는 중…');
              const r = await uploadPhotos(id, getPh(), !!el.querySelector('#sendph')?.checked);
              extra = ` · 사진 ${r.photos}장` + msgToast(r.msg, ' · 카톡 보냄');
            }
            toast('조제완료' + extra); load();
          }
          catch (e) { toast(e.message, true); if (e.status === 409) { el.remove(); load(); } }
        };
      });
    }
    if (to === 'sent' && needTrack(o)) return openTrack(id, () => move(id, to));
    if (to === 'sent') {
      // 잘못 보내는 사고 방지: 보내기 직전 한 번 더 확인
      return sheet(`<h3>보내기 전 확인</h3>
        <div class="warnbox" style="background:var(--gl);color:var(--gd)">
          환자: <b style="font-size:18px">${esc(o.patient)}</b><br>
          처방: <b>${esc(o.formula || '미기재')}</b> · 회차: <b>${esc(roundTxt(o) || '-')}</b><br>
          보관 위치: <b>${esc(o.location || '-')}</b> · 조제: ${esc(o.assignee || '-')}<br>
          방법: <b>${esc(o.delivery)}</b>${o.tracking ? ` · 송장 <b>${esc(o.tracking)}</b>` : ''}</div>
        ${o.delivery === '택배' ? (msgWhy(o.patient)
          ? `<div class="warnbox">💬 환자 알림톡 <b>안 보냄</b>: ${esc(msgWhy(o.patient))}. <a href="#" data-open="${o.id}">연락처·동의 넣기</a></div>`
          : `<div class="warnbox" style="background:var(--gl);color:var(--gd)">💬 발송 완료를 누르면 <b>${esc(maskPhone(contact(o.patient).phone))}</b>로 배송 안내 알림톡이 갑니다.</div>`) : ''}
        <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="chk" style="width:auto"> 약 봉투의 이름·처방이 위와 같은 것을 눈으로 확인했어요</label>
        ${o.delivery === '택배' ? useHTML('sent', (x) => (x.name === '택배 박스' ? 1 : '')) : ''}
        <label class="f"><span>메모</span><input id="mn"></label>
        <div class="okrow"><button class="ab" data-close>취소</button><button class="ab p" id="ok" disabled>${o.delivery === '택배' ? '발송 완료' : '수령 완료'}</button></div>`, (el) => {
        const ok = el.querySelector('#ok');
        el.querySelector('#chk').onchange = (e) => { ok.disabled = !e.target.checked; };
        ok.onclick = async () => {
          try {
            const r = await api('POST', `/api/herb/orders/${id}/move`, { ...body, note: el.querySelector('#mn').value, use: o.delivery === '택배' ? readUse(el, 'sent') : [] });
            const mt = r.msg ? (r.msg.ok ? ' · 알림톡 보냄' : ` · 알림톡 안 보냄(${r.msg.error})`) : '';
            el.remove(); toast((r.nextCard ? `발송 완료 · ${r.nextCard.round}회차 카드 자동 생성` : '발송 기록 완료') + mt, r.msg && !r.msg.ok && r.msg.error !== '알림톡 미설정'); load();
          }
          catch (e) { toast(e.message, true); if (e.status === 409) { el.remove(); load(); } }
        };
      });
    }
    let note = '';
    if (to === 'recall' || to === 'hold') {
      note = prompt(to === 'recall' ? '회수 사유를 적어 주세요 (예: 처방전 없이 발송됨)' : '보류 사유');
      if (note === null) return;
    }
    if (to === 'rx_ready' && o.status === 'compounding' && !confirm('조제를 취소하고 처방전 받음 상태로 돌릴까요?')) return;
    try { await api('POST', `/api/herb/orders/${id}/move`, { ...body, note }); toast(`${o.patient}님 → ${S.statuses[to]}`); load(); }
    catch (e) { toast(e.message, true); load(); }
  }

  function openDetail(id) {
    const o = S.orders.find((x) => x.id === id);
    if (!o) return;
    sheet(`<h3>${esc(o.patient)} <span class="badge">${esc(S.statuses[o.status])}</span></h3>
      <form id="ef">
        <div class="two">
          <label class="f"><span>환자 이름</span><input name="patient" value="${esc(o.patient)}"></label>
          <label class="f"><span>처방</span><input name="formula" value="${esc(o.formula)}"></label>
        </div>
        <div class="two">
          <label class="f"><span>회차</span><input name="round" type="number" value="${o.round ?? ''}"></label>
          <label class="f"><span>총 회차</span><input name="total" type="number" value="${o.total ?? ''}"></label>
        </div>
        <div class="f"><span>구분</span>${segHTML('kind', [['비급여', '비급여'], ['자보', '자보'], ['기타', '기타']], o.kind)}</div>
        <div class="f"><span>받는 방법</span>${segHTML('delivery', [['택배', '택배'], ['직수', '직수'], ['내원', '내원']], o.delivery)}</div>
        <label class="f"><span>보관 위치</span><input name="location" value="${esc(o.location)}"></label>
        ${['need_rx', 'rx_ready'].includes(o.status) ? `<label class="f"><span>조제 예정일 (이 날 알림)</span><input name="dueDate" type="date" value="${esc(o.dueDate || '')}"></label>` : ''}
        ${o.delivery === '택배' ? `<label class="f"><span>로젠 송장번호</span><input name="tracking" inputmode="numeric" value="${esc(o.tracking || '')}"></label>` : ''}
        <label class="f"><span>메모</span><textarea name="note" rows="2">${esc(o.note)}</textarea></label>
        <div class="okrow"><button type="button" class="ab" data-close>닫기</button><button class="ab p">수정 저장</button></div>
      </form>
      <h4 style="margin:18px 0 6px">환자 연락 (알림톡)</h4>
      <form id="cf">
        <label class="f"><span>휴대폰 번호</span><input name="phone" type="tel" value="${esc(contact(o.patient).phone)}" placeholder="01012345678"></label>
        <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="consent" style="width:auto" ${contact(o.patient).consent ? 'checked' : ''}> 환자가 카카오 알림톡(진료·배송 안내) 수신에 <b>동의</b>했어요</label>
        <button class="ab">연락처 저장</button>
        ${o.status === 'sent' && o.tracking ? '<button type="button" class="ab" id="resend">💬 배송 안내 다시 보내기</button>' : ''}
      </form>
      ${(o.messages || []).length ? `<div class="hist">${[...o.messages].reverse().map((m) => `<div><time>${fmt(m.at)}</time>${esc(m.type)} ${m.ok ? '✅ 보냄' : '❌ ' + esc(m.error)}</div>`).join('')}</div>` : ''}
      <h4 style="margin:18px 0 6px">기록</h4>
      <div class="hist">${[...o.history].reverse().map((h) => `<div><time>${fmt(h.at)}</time><b>${esc(h.by)}</b> ${h.from && h.from !== h.to ? esc(S.statuses[h.from]) + ' → ' : ''}${esc(S.statuses[h.to])}${h.note ? ' · ' + esc(h.note) : ''}</div>`).join('')}</div>
      ${['need_rx', 'rx_ready'].includes(o.status) ? '<p><button class="ab w" id="del">잘못 만든 카드 삭제</button></p>' : ''}`, (el) => {
      bindSeg(el);
      const f = el.querySelector('#ef');
      f.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api('PATCH', `/api/herb/orders/${id}`, {
            version: o.version, patient: f.patient.value, formula: f.formula.value, round: f.round.value || null, total: f.total.value || null,
            kind: segVal(el, 'kind'), delivery: segVal(el, 'delivery'), location: f.location.value, note: f.note.value,
            ...(f.tracking ? { tracking: f.tracking.value } : {}),
            ...(f.dueDate && f.dueDate.value ? { dueDate: f.dueDate.value } : {}),
          });
          el.remove(); toast('저장했어요'); load();
        } catch (err) { toast(err.message, true); }
      };
      const cf = el.querySelector('#cf');
      cf.onsubmit = async (e) => {
        e.preventDefault();
        try { await api('POST', '/api/herb/contact', { patient: o.patient, phone: cf.phone.value, consent: cf.consent.checked }); toast('연락처 저장'); load(); }
        catch (err) { toast(err.message, true); }
      };
      const rs = el.querySelector('#resend');
      if (rs) rs.onclick = async () => {
        try { const r = await api('POST', `/api/herb/orders/${id}`, { resend: true }); toast(r.msg.ok ? '알림톡 보냄' : '안 보냄: ' + r.msg.error, !r.msg.ok); el.remove(); load(); }
        catch (err) { toast(err.message, true); }
      };
      const del = el.querySelector('#del');
      if (del) del.onclick = async () => {
        if (!confirm(`${o.patient}님 카드를 삭제할까요?`)) return;
        try { await api('DELETE', `/api/herb/orders/${id}`); el.remove(); load(); } catch (err) { toast(err.message, true); }
      };
    });
  }

  // ---------- 이벤트 ----------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab],[data-a],[data-move],[data-open],[data-me],[data-stock],[data-stockset],[data-stockin],[data-stockmin],[data-follow],[data-track],[data-pcontact],[data-again],[data-photo]');
    if (!t) return;
    if (t.tagName === 'A') e.preventDefault();
    if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
    if (t.dataset.me) { localStorage.setItem(LS.me, t.dataset.me); render(); openPending(); return; }
    if (t.dataset.photo) return openPhoto(t.dataset.photo);
    if (t.dataset.pcontact) return openContact(t.dataset.pcontact);
    if (t.dataset.again) { tab = 'board'; render(); openNew(); const f = document.querySelector('#nf'); f.patient.value = t.dataset.again; f.round.value = 1; f.patient.dispatchEvent(new Event('input')); f.patient.dispatchEvent(new Event('change')); return; }
    if (t.dataset.track) { document.querySelectorAll('.sheet').forEach((x) => x.remove()); return openTrack(t.dataset.track); }
    if (t.dataset.follow) return follow(t.dataset.follow, t.dataset.p);
    if (t.dataset.move) return move(t.dataset.move, t.dataset.to);
    if (t.dataset.open) return openDetail(t.dataset.open);
    const sid = t.dataset.stock || t.dataset.stockset || t.dataset.stockin || t.dataset.stockmin;
    if (sid) {
      const s = S.stock.find((x) => x.id === sid);
      let body;
      if (t.dataset.stockset) { const v = prompt(`${s.name} 직접 센 수량 (${s.unit})`, s.qty); if (v === null || v === '') return; body = { qty: Number(v) }; }
      else if (t.dataset.stockin) { const v = prompt(`${s.name} 몇 ${s.unit} 들어왔나요?`); if (!v) return; body = { delta: Number(v), reason: '입고' }; }
      else if (t.dataset.stockmin) { const v = prompt(`${s.name} 최소 수량 (이 아래면 부족 경고)`, s.min || ''); if (v === null) return; body = { min: Number(v) || 0 }; }
      else body = { delta: Number(t.dataset.d), reason: Number(t.dataset.d) > 0 ? '+1' : '−1' };
      try { await api('PATCH', `/api/herb/stock/${s.id}`, body); load(); } catch (err) { toast(err.message, true); }
      return;
    }
    switch (t.dataset.a) {
      case 'whoami': localStorage.removeItem(LS.me); render(); break;
      case 'new': openNew(); break;
      case 'pushon': pushOn(); break;
      case 'pushoff': { const sub = await mySub(); if (sub) { await api('POST', '/api/herb/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); } toast('알림을 껐어요'); await load(); pushStatus(); break; }
      case 'pushtest': { const sub = await mySub(); try { await api('POST', '/api/herb/push/test', { endpoint: sub.endpoint }); toast('보냈어요. 잠시 후 알림이 와요'); } catch (e) { toast(e.message, true); } break; }
      case 'install': if (installEvt) { installEvt.prompt(); installEvt = null; } break;
      case 'evcsv': {
        const ev = patientList().filter((x) => x.done && x.c.phone && x.c.adConsent);
        const rows = [['이름', '휴대폰', '마지막 처방', '마지막 발송일'], ...ev.map((x) => [x.name, x.c.phone, x.last.formula || '', (x.last.sentAt || '').slice(0, 10)])];
        const csv = '\ufeff' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `이벤트대상_${quarter().replace(/\s/g, '')}.csv`; a.click();
        break;
      }
      case 'newphoto': openNew(); document.querySelector('#photo')?.click(); break;
      case 'depart': openDepart(); break;
      case 'togglesent': showSent = !showSent; render(); break;
      case 'copy':
        try { await navigator.clipboard.writeText(summaryText()); toast('복사했어요. 단톡방에 붙여넣으세요'); }
        catch { toast('복사가 안 되면 글자를 길게 눌러 복사하세요', true); }
        break;
      case 'addstock': {
        const name = prompt('품목 이름 (예: 아이스팩, 녹용접골탕)'); if (!name) return;
        const pack = confirm('포장재인가요? (확인 = 포장재, 취소 = 탕약)');
        const unit = prompt('단위 (예: 장, 개, 박스)', pack ? '개' : '박스') || '';
        try { await api('POST', '/api/herb/stock', { name, qty: 0, cat: pack ? '포장재' : '탕약', unit }); load(); } catch (err) { toast(err.message, true); }
        break;
      }
      case 'savestaff': {
        const staff = $app.querySelector('#staffin').value.split(',').map((s) => s.trim()).filter(Boolean);
        try { await api('PUT', '/api/herb/staff', { staff }); toast('저장했어요'); load(); } catch (err) { toast(err.message, true); }
        break;
      }
      case 'csv': {
        try {
          const blob = await api('GET', '/api/herb/export.csv');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = `한약진행_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        } catch (err) { toast(err.message, true); }
        break;
      }
      case 'logout': localStorage.removeItem(LS.token); render(); break;
    }
  });

  // 다른 직원이 바꾼 내용을 자주 반영
  setInterval(() => { if (!document.hidden && !document.querySelector('.sheet') && localStorage.getItem(LS.token)) load(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && localStorage.getItem(LS.token)) load(); });

  // 앱으로 설치 (안드로이드 크롬: 설치 버튼 / 아이폰 사파리: 공유 → 홈 화면에 추가)
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (tab === 'settings') render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  render();
  if (localStorage.getItem(LS.token)) load();
})();
