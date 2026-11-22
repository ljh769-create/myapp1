(() => {
  const app = document.getElementById('app');
  const C = window.CLINIC, STEPS = window.STEPS, OPT = window.OPTIONS, SC = window.SCALES;
  const DRAFT_KEY = 'review-draft', MINE_KEY = 'my-reviews';
  document.title = `${C.name} 치료 후기`;

  // 안전한 DOM 생성 헬퍼 (innerHTML 사용 안 함)
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
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const store = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  let state = load(DRAFT_KEY, { step: -1, data: { ratings: {}, contact: {} } });
  const data = () => state.data;
  const persist = () => store(DRAFT_KEY, state);

  function render(node) { app.replaceChildren(node); window.scrollTo(0, 0); }
  function go(step) { state.step = step; persist(); view(); }

  // ---------- 화면들 ----------
  function intro() {
    const mine = load(MINE_KEY, []);
    return h('main', { class: 'card center' },
      h('div', { class: 'logo' }, '🌿'),
      h('h1', {}, `${C.name}에 오셔서\n수고 많으셨어요`),
      h('p', { class: 'lead' },
        '치료받으시는 동안 불편한 점은 없었는지, 저희가 잘 챙겨드렸는지 궁금해요. ',
        '2~3분이면 끝나고, 모든 답은 저희가 더 좋은 한의원이 되는 데 쓰여요.'),
      h('ul', { class: 'promise' },
        h('li', {}, '🔒 이름 없이 익명으로 남길 수 있어요'),
        h('li', {}, '💬 원하시면 원장님 답글을 받아보실 수 있어요'),
        h('li', {}, '🌱 건강 관리 팁도 함께 드려요')),
      h('button', { class: 'btn primary', onclick: () => go(0) },
        state.step > 0 ? '이어서 작성하기' : '시작하기'),
      state.step > 0 && h('button', { class: 'btn link', onclick: () => { state = { step: 0, data: { ratings: {}, contact: {} } }; go(0); } }, '처음부터 다시'),
      mine.length > 0 && h('button', { class: 'btn ghost', onclick: replies }, `💌 내 후기 답글 확인 (${mine.length})`));
  }

  function chrome(i, body, canNext) {
    const last = i === STEPS.length - 1;
    return h('main', { class: 'card' },
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': i + 1, 'aria-valuemax': STEPS.length },
        h('div', { style: `width:${((i + 1) / STEPS.length) * 100}%` })),
      h('div', { class: 'stepno' }, `${i + 1} / ${STEPS.length}`),
      body,
      h('div', { class: 'nav' },
        h('button', { class: 'btn ghost', onclick: () => go(i - 1) }, '이전'),
        h('button', { class: 'btn primary', disabled: canNext === false, onclick: last ? submit : () => go(i + 1) },
          last ? '후기 보내기' : '다음')));
  }

  function titleBlock(s) {
    return [h('h2', {}, s.title), s.sub && h('p', { class: 'sub' }, s.sub)];
  }

  function chipGroup(options, selected, multi, onChange) {
    const wrap = h('div', { class: 'chips', role: multi ? 'group' : 'radiogroup' });
    const draw = () => {
      wrap.replaceChildren(...options.map((o) =>
        h('button', {
          type: 'button', class: 'chip' + (selected().includes(o) ? ' on' : ''),
          'aria-pressed': selected().includes(o),
          onclick: () => {
            let cur = selected();
            if (multi) cur = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o];
            else cur = [o];
            onChange(cur); draw();
          },
        }, o)));
    };
    draw();
    return wrap;
  }

  function stepView(i) {
    const s = STEPS[i], d = data();
    if (s.type === 'chips') {
      const sel = () => (s.multi ? d[s.key] || [] : d[s.key] ? [d[s.key]] : []);
      return chrome(i, h('div', {}, titleBlock(s),
        chipGroup(OPT[s.opts], sel, s.multi, (v) => { d[s.key] = s.multi ? v : v[0]; persist(); })), true);
    }
    if (s.type === 'scale') {
      const labels = SC[s.scale];
      const wrap = h('div', { class: 'scale', role: 'radiogroup' });
      const next = h('button'); // placeholder, replaced by chrome
      const draw = () => wrap.replaceChildren(...labels.map(([emo, txt], idx) =>
        h('button', {
          type: 'button', class: 'face' + (d.ratings[s.key] === idx + 1 ? ' on' : ''),
          role: 'radio', 'aria-checked': d.ratings[s.key] === idx + 1,
          onclick: () => { d.ratings[s.key] = idx + 1; persist(); draw(); setTimeout(() => d.ratings[s.key] === idx + 1 && state.step === i && go(i + 1), 280); },
        }, h('span', { class: 'emo' }, emo), h('span', { class: 'txt' }, txt))));
      draw();
      return chrome(i, h('div', {}, titleBlock(s), wrap, h('p', { class: 'hint' }, '고르면 자동으로 넘어가요. 건너뛰려면 "다음"을 누르세요.')), true);
    }
    if (s.type === 'text') {
      const ta = h('textarea', {
        rows: 4, maxlength: 1000, placeholder: s.placeholder,
        oninput: (e) => { d[s.textKey] = e.target.value; persist(); },
      });
      ta.value = d[s.textKey] || '';
      return chrome(i, h('div', {}, titleBlock(s),
        chipGroup(OPT[s.opts], () => d[s.tagKey] || [], true, (v) => { d[s.tagKey] = v; persist(); }), ta), true);
    }
    if (s.type === 'nps') {
      const wrap = h('div', { class: 'nps' });
      const draw = () => wrap.replaceChildren(...Array.from({ length: 11 }, (_, n) =>
        h('button', { type: 'button', class: 'n' + (d.nps === n ? ' on' : ''), 'aria-pressed': d.nps === n,
          onclick: () => { d.nps = n; persist(); draw(); } }, String(n))));
      draw();
      return chrome(i, h('div', {}, titleBlock(s), wrap,
        h('div', { class: 'npslabel' }, h('span', {}, '전혀 아니에요'), h('span', {}, '꼭 추천해요'))), true);
    }
    if (s.type === 'contact') {
      const mk = (key, label, ph, type) => h('label', { class: 'field' }, label,
        h('input', { type, placeholder: ph, maxlength: 30, value: d.contact[key] || '',
          oninput: (e) => { d.contact[key] = e.target.value; persist(); } }));
      return chrome(i, h('div', {}, titleBlock(s),
        h('div', { class: 'note' }, '✅ 후기를 보내면 이 휴대폰에 "답글 확인" 버튼이 생겨요. 원장님이 답글을 달면 거기서 볼 수 있어요.'),
        h('p', { class: 'sub' }, '직접 연락(전화·문자)을 원하실 때만 적어주세요. (선택)'),
        mk('name', '성함(또는 별명)', '예) 김OO', 'text'),
        mk('phone', '연락처', '010-0000-0000', 'tel')), true);
    }
  }

  async function submit(ev) {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = '보내는 중…';
    const d = data();
    try {
      const r = await fetch('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      if (!r.ok) throw new Error((await r.json()).error || '전송 실패');
      const { id, token } = await r.json();
      const mine = load(MINE_KEY, []); mine.push({ id, token, at: Date.now() }); store(MINE_KEY, mine);
      localStorage.removeItem(DRAFT_KEY);
      state = { step: -1, data: { ratings: {}, contact: {} } };
      render(thanks(d));
    } catch (e) {
      btn.disabled = false; btn.textContent = '후기 보내기';
      alert(e.message === 'Failed to fetch' ? '인터넷 연결을 확인하고 다시 눌러주세요. 작성하신 내용은 저장되어 있어요.' : e.message);
    }
  }

  const TIPS = {
    '식습관': '따뜻한 물을 자주 마시고, 찬 음식과 야식은 조금 줄여보세요.',
    '운동·스트레칭': '앉아 있는 시간이 길다면 50분마다 일어나 어깨와 허리를 가볍게 풀어주세요.',
    '수면': '잠들기 1시간 전에는 화면을 줄이고, 매일 같은 시간에 눕는 것이 도움이 돼요.',
    '스트레스': '하루 5분 천천히 복식호흡을 해보세요. 들숨보다 날숨을 길게요.',
    '한약 복용법': '한약은 식전·식후 안내에 맞춰 드시고, 불편하면 바로 알려주세요.',
    '재발 예방': '증상이 좋아져도 처음 몇 주는 무리하지 않고 꾸준히 관리하는 게 중요해요.',
    '자세·생활습관': '모니터는 눈높이로, 허리는 등받이에 붙여 앉아보세요.',
    '계절 건강관리': '환절기엔 목과 배를 따뜻하게 하고, 규칙적인 식사로 면역을 지켜주세요.',
  };

  function thanks(d) {
    const tips = (d.learnTags || []).map((t) => TIPS[t]).filter(Boolean);
    return h('main', { class: 'card center' },
      h('div', { class: 'logo' }, '💚'),
      h('h1', {}, '소중한 말씀 감사합니다'),
      h('p', { class: 'lead' }, '남겨주신 후기는 원장님과 직원들이 꼼꼼히 읽고, 더 나은 진료에 반영할게요.'),
      tips.length > 0 && h('div', { class: 'tips' }, h('h3', {}, '🌱 궁금해하신 주제, 짧은 팁'), h('ul', {}, tips.map((t) => h('li', {}, t)))),
      h('div', { class: 'note' }, '답글이 달리면 이 앱의 "내 후기 답글 확인"에서 볼 수 있어요. 홈 화면에 추가해 두시면 편해요.'),
      h('button', { class: 'btn primary', onclick: replies }, '💌 답글 확인하기'),
      C.phone && h('p', { class: 'hint' }, '몸이 많이 불편하시면 ', h('a', { href: `tel:${C.phone}` }, `${C.phone}`), ' 로 편하게 연락 주세요.'),
      h('button', { class: 'btn link', onclick: () => go(-1) }, '처음 화면으로'));
  }

  async function replies() {
    const mine = load(MINE_KEY, []);
    const list = h('div', { class: 'replies' }, h('p', { class: 'sub' }, '불러오는 중…'));
    render(h('main', { class: 'card' }, h('h2', {}, '💌 내 후기와 답글'), list,
      h('button', { class: 'btn ghost', onclick: () => go(-1) }, '돌아가기')));
    const rows = await Promise.all(mine.slice().reverse().map(async (m) => {
      try {
        const r = await fetch(`/api/my?id=${encodeURIComponent(m.id)}&t=${encodeURIComponent(m.token)}`);
        return r.ok ? { m, v: await r.json() } : { m, v: null };
      } catch { return { m, v: null }; }
    }));
    list.replaceChildren(...rows.map(({ m, v }) => h('article', { class: 'reply' },
      h('div', { class: 'when' }, new Date(m.at).toLocaleDateString('ko-KR') + ' 남긴 후기'),
      v && v.reply
        ? [h('div', { class: 'bubble' }, v.reply.text), h('div', { class: 'when' }, `${C.doctor} 답글 · ${new Date(v.reply.at).toLocaleDateString('ko-KR')}`)]
        : h('div', { class: 'wait' }, v ? '아직 답글을 준비 중이에요. 조금만 기다려 주세요 🙏' : '확인할 수 없어요. (네트워크 또는 삭제됨)'))));
  }

  function view() {
    if (state.step < 0) return render(intro());
    if (state.step >= STEPS.length) state.step = STEPS.length - 1;
    render(stepView(state.step));
  }

  view();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
