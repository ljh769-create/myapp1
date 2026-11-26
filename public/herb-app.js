// 한약 진행 관리 (직원용 화면)
(() => {
  const $app = document.getElementById('app');
  const LS = { token: 'herbToken', me: 'herbMe' };
  let S = { orders: [], stock: [], staff: [], statuses: {}, next: {} };
  let tab = 'board';
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
    try { S = await api('GET', '/api/herb/state'); render(); } catch (e) { if (localStorage.getItem(LS.token)) toast(e.message, true); }
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
          ${[['board', `진행판`], ['today', '오늘 요약(단톡용)'], ['stock', '상비 재고'], ['settings', '설정']]
            .map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
        </div>
        <div id="body"></div>
      </div>
      ${tab === 'board' ? '<button class="fab" data-a="new">＋ 새 한약</button>' : ''}`;
    const body = $app.querySelector('#body');
    if (tab === 'board') body.innerHTML = boardHTML(counts);
    if (tab === 'today') body.innerHTML = todayHTML();
    if (tab === 'stock') body.innerHTML = stockHTML();
    if (tab === 'settings') body.innerHTML = settingsHTML();
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

  // ---------- 진행판 ----------
  const COLS = ['need_rx', 'rx_ready', 'compounding', 'done', 'recall', 'hold'];
  const match = (o) => !q || [o.patient, o.formula, o.note, o.assignee, o.location].some((v) => (v || '').includes(q));

  function boardHTML(counts) {
    const sent = S.orders.filter((o) => o.status === 'sent' && match(o)).sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
    const lw = low();
    return `
      ${lw.length ? `<div class="warnbox" data-tab="stock" style="cursor:pointer">⚠ <b>재고 부족 — 주문/제작 필요</b><br>${lw.map((x) => `${esc(x.name)} ${x.qty}${esc(x.unit)}${x.min ? ` (최소 ${x.min})` : ''}`).join(' · ')}</div>` : ''}
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
        break;
      case 'done': acts = b('sent', o.delivery === '택배' ? '택배 발송함' : '환자 수령함', 'p') + b('hold', '보류'); break;
      case 'sent': acts = b('recall', '회수 필요', 'w'); break;
      case 'hold': acts = b('need_rx', '처방전 필요로') + b('rx_ready', '처방전 받음으로') + b('done', '조제완료로'); break;
      case 'recall': acts = b('done', '회수함 → 보관', 'p') + b('need_rx', '처방전 필요로') + b('hold', '보류'); break;
    }
    return `<div class="hcard ${o.status}">
      <div><a href="#" class="nm" data-open="${o.id}">${esc(o.patient)}</a><span class="rd">${esc(roundTxt(o))}</span>
        <span class="badge">${esc(o.kind)}</span><span class="badge">${esc(o.delivery)}</span>
        ${same.length ? '<span class="badge r">⚠ 같은 회차 중복</span>' : ''}</div>
      <div class="meta">${esc(o.formula || '처방 미기재')}${o.location ? ' · 📦 ' + esc(o.location) : ''} · ${fmt(o.updatedAt)}</div>
      ${o.assignee ? `<div class="who">조제: <b>${esc(o.assignee)}</b></div>` : ''}
      ${o.status === 'sent' ? `<div class="who">${esc(o.delivery)} ${fmt(o.sentAt)} · ${esc(o.history[o.history.length - 1]?.by || '')}</div>` : ''}
      ${o.note ? `<div class="note">${esc(o.note)}</div>` : ''}
      <div class="acts">${acts}</div>
    </div>`;
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
      sec('택배', sentToday.filter((o) => o.delivery === '택배').map((o) => line(o))),
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

  // ---------- 설정 ----------
  function settingsHTML() {
    return `<div class="panel" style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px">
        <h3>직원 이름</h3>
        <p class="sub">쉼표로 구분해서 적으세요.</p>
        <input id="staffin" class="search" value="${esc(S.staff.join(', '))}">
        <button class="ab p" data-a="savestaff">저장</button>
      </div>
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

  function openNew() {
    sheet(`<h3>새 한약 카드</h3>
      <form id="nf">
        <label class="f"><span>환자 이름 *</span><input name="patient" required autocomplete="off"></label>
        <div id="dupwarn"></div>
        <label class="f"><span>처방</span><input name="formula" placeholder="예: 당귀수산" list="formulas"></label>
        <datalist id="formulas">${S.stock.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>
        <div class="two">
          <label class="f"><span>이번 회차</span><input name="round" type="number" min="1" max="99" inputmode="numeric"></label>
          <label class="f"><span>총 회차</span><input name="total" type="number" min="1" max="99" inputmode="numeric" value="6"></label>
        </div>
        <div class="f"><span>처방전</span>${segHTML('rx', [['0', '아직 없음'], ['1', '받았음']], '0')}</div>
        <div class="f"><span>구분</span>${segHTML('kind', [['비급여', '비급여'], ['자보', '자보'], ['기타', '기타']], '비급여')}</div>
        <div class="f"><span>받는 방법</span>${segHTML('delivery', [['택배', '택배'], ['직수', '직수'], ['내원', '내원']], '택배')}</div>
        <label class="f"><span>메모</span><textarea name="note" rows="2" placeholder="예: 전화로 지을 예정, 처방전 있는지 확인"></textarea></label>
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
      f.patient.addEventListener('input', warn);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const body = {
          patient: f.patient.value, formula: f.formula.value, round: f.round.value || null, total: f.total.value || null,
          hasRx: segVal(el, 'rx') === '1', kind: segVal(el, 'kind'), delivery: segVal(el, 'delivery'), note: f.note.value,
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
      f.patient.focus();
    });
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
        ${o.status === 'compounding' ? useHTML('done', (x) => (x.name === '파우치' ? '' : x.name === '쌍화탕 박스' ? '' : '')) : ''}
        <label class="f"><span>메모 (선택)</span><input id="mn"></label>
        <div class="okrow"><button class="ab" data-close>취소</button><button class="ab p" id="ok">완료</button></div>`, (el) => {
        el.querySelectorAll('[data-loc]').forEach((b) => (b.onclick = () => { el.querySelector('#loc').value = b.dataset.loc; }));
        el.querySelector('#ok').onclick = async () => {
          try { await api('POST', `/api/herb/orders/${id}/move`, { ...body, location: el.querySelector('#loc').value, note: el.querySelector('#mn').value, use: readUse(el, 'done') }); el.remove(); toast('조제완료'); load(); }
          catch (e) { toast(e.message, true); if (e.status === 409) { el.remove(); load(); } }
        };
      });
    }
    if (to === 'sent') {
      // 잘못 보내는 사고 방지: 보내기 직전 한 번 더 확인
      return sheet(`<h3>보내기 전 확인</h3>
        <div class="warnbox" style="background:var(--gl);color:var(--gd)">
          환자: <b style="font-size:18px">${esc(o.patient)}</b><br>
          처방: <b>${esc(o.formula || '미기재')}</b> · 회차: <b>${esc(roundTxt(o) || '-')}</b><br>
          보관 위치: <b>${esc(o.location || '-')}</b> · 조제: ${esc(o.assignee || '-')}<br>
          방법: <b>${esc(o.delivery)}</b></div>
        <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="chk" style="width:auto"> 약 봉투의 이름·처방이 위와 같은 것을 눈으로 확인했어요</label>
        ${o.delivery === '택배' ? useHTML('sent', (x) => (x.name === '택배 박스' ? 1 : '')) : ''}
        <label class="f"><span>메모 (송장번호 등)</span><input id="mn"></label>
        <div class="okrow"><button class="ab" data-close>취소</button><button class="ab p" id="ok" disabled>${o.delivery === '택배' ? '발송 완료' : '수령 완료'}</button></div>`, (el) => {
        const ok = el.querySelector('#ok');
        el.querySelector('#chk').onchange = (e) => { ok.disabled = !e.target.checked; };
        ok.onclick = async () => {
          try { await api('POST', `/api/herb/orders/${id}/move`, { ...body, note: el.querySelector('#mn').value, use: o.delivery === '택배' ? readUse(el, 'sent') : [] }); el.remove(); toast('발송 기록 완료'); load(); }
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
        <label class="f"><span>메모</span><textarea name="note" rows="2">${esc(o.note)}</textarea></label>
        <div class="okrow"><button type="button" class="ab" data-close>닫기</button><button class="ab p">수정 저장</button></div>
      </form>
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
          });
          el.remove(); toast('저장했어요'); load();
        } catch (err) { toast(err.message, true); }
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
    const t = e.target.closest('[data-tab],[data-a],[data-move],[data-open],[data-me],[data-stock],[data-stockset],[data-stockin],[data-stockmin]');
    if (!t) return;
    if (t.tagName === 'A') e.preventDefault();
    if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
    if (t.dataset.me) { localStorage.setItem(LS.me, t.dataset.me); render(); return; }
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

  render();
  if (localStorage.getItem(LS.token)) load();
})();
