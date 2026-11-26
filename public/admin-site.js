// 관리자: 홈페이지 문구 / 칼럼 작성
window.AdminSite = (({ h, api, redraw, getDoctors }) => {
  let site = null, defaults = null, columns = null, editing = null;
  const docName = (d) => [d.name, d.title].filter(Boolean).join(' ') || '원장님';

  async function loadSite() { const r = await api('/site'); site = r.site; defaults = r.defaults; }
  async function loadCols() { columns = await api('/columns'); }

  // 목록형 필드: 한 줄에 하나, 쌍(제목|설명)은 " | "로 구분
  const toLines = (v, pair) => (pair ? v.map((x) => x.join(' | ')).join('\n') : v.join('\n'));
  const fromLines = (s, pair) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (pair ? [l.split('|')[0].trim(), l.split('|').slice(1).join('|').trim()] : l));
  const faqToText = (v) => v.map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n');
  const faqFromText = (s) => s.split(/\n\s*\n/).map((b) => { const q = (b.match(/Q:\s*(.+)/) || [])[1], a = (b.match(/A:\s*([\s\S]+)/) || [])[1]; return q ? [q.trim(), (a || '').trim()] : null; }).filter(Boolean);

  function siteTab() {
    if (!site) { loadSite().then(redraw).catch(() => {}); return h('p', { class: 'sub' }, '불러오는 중…'); }
    const d = JSON.parse(JSON.stringify(site));
    const f = (key, label, hint, rows = 1, kind) => {
      const el = h(rows > 1 ? 'textarea' : 'input', rows > 1 ? { rows } : {});
      el.value = kind === 'pair' ? toLines(d[key], true) : kind === 'list' ? toLines(d[key]) : kind === 'faq' ? faqToText(d[key]) : d[key];
      el.addEventListener('input', () => { d[key] = kind === 'pair' ? fromLines(el.value, true) : kind === 'list' ? fromLines(el.value) : kind === 'faq' ? faqFromText(el.value) : el.value; });
      return h('label', { class: 'field' }, h('b', {}, label), hint && h('small', { class: 'hintline' }, hint), el);
    };
    const save = async () => {
      const r = await api('/site', { method: 'PUT', body: d });
      if (r.error) return alert(r.error);
      site = r.site; alert('저장했어요. 홈페이지에 바로 반영됩니다.'); redraw();
    };
    return h('div', {},
      h('div', { class: 'panel warnbox' }, h('h3', {}, '⚠️ 원장님 검토 필수'),
        h('p', { class: 'sub' }, '기본 문구는 초안이에요. 의료법 제56조에 따라 ① 치료효과 보장("완치", "100%"), ② 다른 의료기관·양방과의 우열 비교, ③ 환자 치료경험담, ④ 부작용 누락은 금지됩니다. 사실과 다른 내용은 꼭 고쳐주세요.'),
        h('div', { class: 'row' }, h('a', { href: '/', target: '_blank', class: 'sbtn' }, '🏠 홈페이지 보기'), h('a', { href: '/llms.txt', target: '_blank', class: 'sbtn' }, 'AI용 요약(llms.txt) 보기'), h('a', { href: '/sitemap.xml', target: '_blank', class: 'sbtn' }, '사이트맵 보기'))),
      h('div', { class: 'panel' }, h('h3', {}, '기본 정보'),
        h('p', { class: 'sub' }, '전화번호·진료시간·의료진은 "원장님·진료시간" 탭 설정이 그대로 쓰여요 (한 곳에서만 관리).'),
        f('address', '주소', '예: 서울 동작구 ○○로 00, 0층'), f('parking', '주차·교통 안내', '예: 노량진역 0번 출구 도보 3분', 2),
        f('mapUrl', '지도 링크 (https://로 시작)', '네이버 지도/카카오맵 공유 링크'),
        f('seoDescription', '검색 설명 (160자 이내)', '검색결과·AI 요약에 쓰이는 한 줄 소개', 2)),
      h('div', { class: 'panel' }, h('h3', {}, '첫 화면'),
        f('heroEyebrow', '대표 진료 (작은 제목)'), f('heroTitle', '큰 제목 (줄바꿈 가능)', '', 2), f('heroSub', '설명', '', 3)),
      h('div', { class: 'panel' }, h('h3', {}, '한방 체외충격파 설명'),
        f('focusTitle', '제목'), f('focusBody', '본문', '빈 줄=문단, **굵게**, "- "로 시작=목록', 8),
        f('points', '특징 3가지', '한 줄에 하나: 제목 | 설명', 4, 'pair'),
        f('forWho', '이런 통증으로 오세요', '한 줄에 하나', 6, 'list'), f('forWhoNote', '아래 안내 문구'),
        f('steps', '진료 과정', '한 줄에 하나: 단계 | 설명', 5, 'pair')),
      h('div', { class: 'panel' }, h('h3', {}, '자주 묻는 질문'), f('faq', 'Q&A', 'Q: 질문 / A: 답변, 질문 사이는 빈 줄', 14, 'faq')),
      h('div', { class: 'panel' }, h('h3', {}, '하단 고지'), f('disclaimer', '개인차·부작용 안내 (모든 페이지 하단)', '', 3)),
      h('button', { class: 'btn primary savebar', onclick: save }, '💾 홈페이지 저장'),
      h('button', { class: 'sbtn', onclick: () => { if (confirm('기본 초안 문구로 되돌릴까요? (저장 전까지는 반영 안 됨)')) { site = { ...defaults, address: site.address, mapUrl: site.mapUrl, parking: site.parking }; redraw(); } } }, '기본 초안으로 되돌리기'));
  }

  // ---------------- 칼럼 ----------------
  function multiUse(c) {
    const url = `${location.origin}/columns/${c.id}`;
    const heads = (c.body.match(/^##\s+.+$/gm) || []).slice(0, 4).map((x) => '· ' + x.replace(/^##\s+/, ''));
    const blog = `${c.title}\n\n${c.summary}\n\n${heads.join('\n')}\n\n👉 원장님 칼럼 전문 보기\n${url}\n\n📅 진료 예약: ${location.origin}/booking`;
    const threads = `${c.summary || c.title}\n\n전문은 여기서 👇\n${url}`;
    const sms = `[칼럼] ${c.title}\n${url}`;
    const box = (label, text) => h('div', { class: 'mu' }, h('b', {}, label), h('textarea', { rows: Math.min(10, text.split('\n').length + 1), readonly: true }, text),
      h('button', { class: 'sbtn', onclick: () => navigator.clipboard.writeText(text).then(() => alert('복사했어요')) }, '복사'));
    return h('div', { class: 'panel' }, h('h3', {}, '🔁 원소스 멀티유즈 — 다른 채널에 붙여넣고 홈페이지로 모으기'),
      h('p', { class: 'sub' }, '네이버 블로그는 요약 + 링크로 올리세요. 같은 글 전문을 여러 곳에 복붙하면 중복 문서로 불리해질 수 있어요.'),
      box('네이버 블로그·티스토리용', blog), box('쓰레드·인스타용', threads), box('환자 문자(CRM)용', sms));
  }

  function editor() {
    const c = editing;
    const docs = getDoctors();
    const title = h('input', { placeholder: '제목 — 환자가 실제로 검색할 질문형 추천 (예: 족저근막염, 체외충격파 몇 번 받아야 할까?)', maxlength: 120 }); title.value = c.title || '';
    const summary = h('textarea', { rows: 2, maxlength: 300, placeholder: '요약 2~3문장 — AI가 인용하기 좋은 "핵심 답"을 먼저 적으세요' }); summary.value = c.summary || '';
    const body = h('textarea', { rows: 22, class: 'mono', placeholder: '## 소제목\n본문…\n\n- 목록\n\n**강조**' }); body.value = c.body || '';
    const doc = h('select', {}, docs.map((d) => h('option', { value: d.id, selected: c.doctorId === d.id }, '작성: ' + docName(d))));
    const save = async (status) => {
      const payload = { title: title.value, summary: summary.value, body: body.value, doctorId: doc.value, status };
      const r = await api('/columns' + (c.id ? '/' + c.id : ''), { method: c.id ? 'PUT' : 'POST', body: payload });
      if (r.error) return alert(r.error);
      editing = r; await loadCols(); redraw();
      if (status === 'published') alert('발행했어요! 아래 멀티유즈 문구로 다른 채널에도 올려보세요.');
    };
    return h('div', {},
      h('button', { class: 'sbtn', onclick: () => { editing = null; redraw(); } }, '← 목록'),
      h('div', { class: 'panel' }, title, summary, doc, body,
        h('details', {}, h('summary', {}, 'GEO 칼럼 작성 팁'), h('ul', { class: 'sub' },
          h('li', {}, '제목은 환자가 묻는 질문 그대로 ("○○ 통증, 체외충격파 받아도 될까?")'),
          h('li', {}, '요약 첫 문장에 결론. AI는 앞부분의 명확한 답을 인용해요'),
          h('li', {}, '## 소제목도 질문형으로: 원인은? / 어떤 경우 효과를 기대하나? / 몇 번? / 주의할 점?'),
          h('li', {}, '원장님 진료 경험에서 나온 구체적 기준(횟수 간격, 생활 수칙)이 차별점이에요'),
          h('li', {}, '치료 효과 보장·비교·환자 사례 후기는 쓰지 마세요 (의료광고 규정)'))),
        h('div', { class: 'row' },
          h('button', { class: 'sbtn', onclick: () => save('draft') }, '임시 저장'),
          h('button', { class: 'sbtn p', onclick: () => save('published') }, c.status === 'published' ? '수정 반영' : '🚀 발행'),
          c.status === 'published' && h('button', { class: 'sbtn', onclick: () => save('draft') }, '발행 취소(비공개)'),
          c.status === 'published' && h('a', { class: 'sbtn', href: `/columns/${c.id}`, target: '_blank' }, '보기'),
          c.id && h('button', { class: 'sbtn d', onclick: async () => { if (confirm('칼럼을 삭제할까요?')) { await api('/columns/' + c.id, { method: 'DELETE' }); editing = null; await loadCols(); redraw(); } } }, '삭제'))),
      c.status === 'published' && multiUse(c));
  }

  function columnsTab() {
    if (!columns) { loadCols().then(redraw).catch(() => {}); return h('p', { class: 'sub' }, '불러오는 중…'); }
    if (editing) return editor();
    const docs = getDoctors();
    return h('div', {},
      h('button', { class: 'btn primary', style: 'max-width:280px', onclick: () => { editing = { doctorId: (docs[0] || {}).id }; redraw(); } }, '✍️ 새 칼럼 쓰기'),
      columns.length ? columns.map((c) => { const d = docs.find((x) => x.id === c.doctorId);
        return h('article', { class: 'rv' }, h('div', { class: 'meta' }, h('span', {}, (d ? docName(d) : '') + ' · ' + new Date(c.updatedAt).toLocaleDateString('ko-KR')),
          h('span', { class: 'tag' + (c.status === 'published' ? '' : ' bad') }, c.status === 'published' ? '발행됨' : '임시 저장')),
        h('h3', {}, c.title), h('p', { class: 'sub' }, c.summary),
        h('button', { class: 'sbtn p', onclick: () => { editing = c; redraw(); } }, '열기')); })
        : h('p', { class: 'sub' }, '아직 칼럼이 없어요. 환자분들이 자주 묻는 질문 하나로 시작해 보세요.'));
  }

  return { siteTab, columnsTab };
});
