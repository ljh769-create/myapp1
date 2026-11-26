// 공개 홈페이지 (서버에서 완성된 HTML로 내보내 AI·검색엔진이 읽을 수 있게 함)
// 데이터: DATA_DIR/site.json (홈페이지 문구), DATA_DIR/columns.json (칼럼)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ⚠️ 아래 기본 문구는 "초안"입니다. 원장님이 관리자 → 홈페이지 탭에서 검토·수정하세요.
//    의료법 제56조: 치료효과 보장, 다른 의료기관과의 비교·비방, 치료경험담, 부작용 누락은 금지됩니다.
function defaultSite() {
  return {
    address: '', mapUrl: '', parking: '',
    heroEyebrow: '한방 체외충격파 중점 진료',
    heroTitle: '아픈 자리만 보지 않고,\n통증이 이어진 길을 봅니다',
    heroSub: '한의학의 경근(經筋)·근막 관점으로 통증의 흐름을 진찰하고, 체외충격파와 침·근막추나를 함께 계획합니다.',
    focusTitle: '한방 체외충격파는 어떻게 진료하나요?',
    focusBody: '체외충격파는 몸 밖에서 충격파 에너지를 전달해 힘줄·근막 같은 연부조직의 통증을 다루는 치료입니다.\n\n저희는 아픈 부위 한 곳만 보지 않습니다. 한의학의 경근(經筋)과 근막의 연결, 압통점, 관절의 움직임을 함께 진찰해 **어디에, 어느 강도로** 시술할지 정합니다. 필요하면 침·약침·근막추나를 함께 계획하고, 치료 사이의 자세·운동 관리까지 안내합니다.',
    points: [
      ['진찰부터 꼼꼼하게', '통증 부위와 함께 이어진 근막 경로·압통점·관절 움직임을 살펴 시술 위치를 정합니다.'],
      ['한방 치료와 함께', '체외충격파 단독이 아니라 침·약침·근막추나 등 한방 치료와의 병행 계획을 세웁니다.'],
      ['치료 후 관리까지', '일상 자세, 스트레칭·운동, 회복 습관을 안내해 치료 사이의 관리를 돕습니다.'],
    ],
    forWho: ['어깨 통증 (석회성 건염, 회전근개 건병증 등)', '팔꿈치 통증 (테니스엘보, 골프엘보)', '발바닥·발뒤꿈치 통증 (족저근막염)', '아킬레스건·무릎 주변 힘줄 통증', '운동 후 반복되는 근육·힘줄 통증'],
    forWhoNote: '체외충격파가 적합한지는 진찰 후 판단합니다.',
    steps: [
      ['상담·진찰', '통증 양상, 근막 연결, 관절 움직임을 확인합니다.'],
      ['치료 계획', '시술 부위·강도·횟수와 병행 치료를 설명드립니다.'],
      ['체외충격파 + 한방치료', '계획에 따라 체외충격파와 침·근막추나 등을 진행합니다.'],
      ['생활 관리 안내', '자세·운동·회복 습관을 안내하고 경과를 확인합니다.'],
    ],
    faq: [
      ['체외충격파는 아픈가요?', '시술 중 두드리는 듯한 자극과 뻐근함이 있을 수 있습니다. 느끼는 정도에 맞춰 강도를 조절합니다.'],
      ['몇 번 받아야 하나요?', '통증 부위와 상태에 따라 다릅니다. 진찰 후 예상 횟수와 간격을 안내드립니다.'],
      ['부작용은 없나요?', '시술 부위에 일시적인 통증, 붉어짐, 부기, 멍이 생길 수 있으며 대개 며칠 내 가라앉습니다. 증상이 지속되면 바로 알려주세요.'],
      ['받으면 안 되는 경우도 있나요?', '임신 중, 혈액응고 장애·항응고제 복용, 시술 부위의 감염·종양, 심장박동기 사용 등은 진찰 시 반드시 알려주세요.'],
      ['비용과 보험 적용은 어떻게 되나요?', '치료 구성에 따라 달라 진료 후 안내드립니다.'],
    ],
    disclaimer: '치료 효과와 필요한 치료 횟수는 개인의 상태에 따라 다를 수 있습니다. 시술 후 일시적인 통증·붉어짐·멍 등이 생길 수 있습니다.',
    seoDescription: '한방 체외충격파 중점 진료 한의원. 경근·근막 관점의 진찰로 체외충격파와 침·근막추나를 함께 계획합니다.',
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
// 아주 단순한 마크다운: ## 제목, ### 소제목, - 목록, 빈 줄=문단, **굵게**
function md(src) {
  const out = []; let list = null, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } if (list) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = null; } };
  for (const raw of String(src || '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    let m;
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (para.length) { const l = list; list = null; flush(); list = l; } (list = list || []).push(m[1]); continue; }
    if (list) flush();
    para.push(line);
  }
  flush();
  return out.join('\n');
}
const plain = (src) => String(src || '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*/g, '').replace(/^\s*[-*]\s+/gm, '· ');
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

module.exports = function createSite({ DATA_DIR, writeJson, booking, CLINIC_NAME, PUBLIC_URL }) {
  const SITE_FILE = path.join(DATA_DIR, 'site.json');
  const COL_FILE = path.join(DATA_DIR, 'columns.json');
  const load = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
  let site = { ...defaultSite(), ...(load(SITE_FILE, {}) || {}) };
  let columns = load(COL_FILE, []);
  const name = CLINIC_NAME || '한의원';

  const baseUrl = (req) => PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`;
  const published = () => columns.filter((c) => c.status === 'published').sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const doctors = () => booking.getSettings().doctors.filter((d) => d.active);
  const docById = (id) => booking.getSettings().doctors.find((d) => d.id === id);
  const phone = () => booking.getSettings().phone;
  const photo = (d) => (d.photo ? '/photos/' + d.photo : '');

  // 원장님들 진료시간을 합쳐 병원 진료시간 계산 (예약 설정 하나로 통일 → 어디서나 같은 정보)
  function clinicHours() {
    const out = [];
    for (const w of [1, 2, 3, 4, 5, 6, 0]) {
      const hs = doctors().map((d) => d.hours[w]).filter(Boolean);
      out.push({ w, open: hs.length ? hs.map((h) => h[0]).sort()[0] : null, close: hs.length ? hs.map((h) => h[1]).sort().pop() : null });
    }
    const lunch = doctors().find((d) => d.lunchStart);
    return { days: out, lunch: lunch ? `${lunch.lunchStart}~${lunch.lunchEnd}` : '' };
  }
  function hoursHtml() {
    const { days, lunch } = clinicHours();
    return `<table class="hours">${days.map((d) => `<tr><th>${WEEK[d.w]}</th><td>${d.open ? `${d.open} ~ ${d.close}` : '<span class="off">휴진</span>'}</td></tr>`).join('')}</table>${lunch ? `<p class="small">점심시간 ${esc(lunch)}</p>` : ''}`;
  }
  function clinicLd(base) {
    const { days } = clinicHours();
    return {
      '@context': 'https://schema.org', '@type': 'MedicalClinic', '@id': base + '/#clinic', name, url: base + '/',
      description: site.seoDescription, telephone: phone() || undefined,
      address: site.address ? { '@type': 'PostalAddress', streetAddress: site.address, addressCountry: 'KR' } : undefined,
      medicalSpecialty: '한방 체외충격파', availableService: { '@type': 'MedicalTherapy', name: '한방 체외충격파' },
      openingHoursSpecification: days.filter((d) => d.open).map((d) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: SCHEMA_DAYS[d.w], opens: d.open, closes: d.close })),
      employee: doctors().map((d) => ({ '@type': 'Physician', name: d.name || undefined, jobTitle: d.title, url: `${base}/doctors/${d.id}` })),
      potentialAction: { '@type': 'ReserveAction', target: base + '/booking' },
    };
  }

  function page({ req, title, desc, canonical, body, ld = [] }) {
    const base = baseUrl(req);
    const fullTitle = title ? `${title} | ${name}` : `${name} | ${site.heroEyebrow}`;
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title><meta name="description" content="${esc(desc || site.seoDescription)}">
<link rel="canonical" href="${esc(base + canonical)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(desc || site.seoDescription)}">
<meta property="og:url" content="${esc(base + canonical)}"><meta property="og:site_name" content="${esc(name)}"><meta property="og:locale" content="ko_KR">
<meta name="theme-color" content="#2f6f5e"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/icon-180.png">
<link rel="stylesheet" href="/site.css">${[clinicLd(base), ...ld].map(jsonLd).join('')}</head><body>
<header class="top"><div class="in"><a class="brand" href="/">${esc(name)}</a><nav><a href="/#eswt">체외충격파</a><a href="/#doctors">의료진</a><a class="keep" href="/columns">칼럼</a><a href="/#visit">오시는 길</a><a class="cta" href="/booking">예약</a></nav></div></header>
<main>${body}</main>
<footer class="foot"><div class="in"><p><b>${esc(name)}</b>${site.address ? ' · ' + esc(site.address) : ''}${phone() ? ` · <a href="tel:${esc(phone().replace(/[^0-9+]/g, ''))}">${esc(phone())}</a>` : ''}</p>
<p class="small">${esc(site.disclaimer)}</p><p class="small"><a href="/booking">진료 예약</a> · <a href="/columns">건강 칼럼</a> · <a href="/review">치료 후기 남기기</a></p></div></footer>
<a class="mbar" href="/booking">📅 원장님 선택해서 예약하기</a></body></html>`;
  }

  const docCard = (d) => `<a class="doc" href="/doctors/${esc(d.id)}"><span class="ph"${photo(d) ? ` style="background-image:url('${esc(photo(d))}')"` : ''}>${photo(d) ? '' : '🩺'}</span><span class="bd"><b>${esc(booking.docName(d))}</b><span>${esc(d.desc)}</span></span></a>`;
  const colCard = (c) => { const d = docById(c.doctorId); return `<a class="col" href="/columns/${esc(c.id)}"><b>${esc(c.title)}</b><span>${esc(c.summary)}</span><small>${esc(c.publishedAt.slice(0, 10))}${d ? ' · ' + esc(booking.docName(d)) : ''}</small></a>`; };
  const ctaBox = (t = '통증, 진찰부터 받아보세요') => `<section class="ctabox"><h2>${esc(t)}</h2><p>원장님을 선택해 원하는 시간에 예약할 수 있어요.</p><a class="btn" href="/booking">진료 예약하기</a>${phone() ? `<a class="btn ghost" href="tel:${esc(phone().replace(/[^0-9+]/g, ''))}">전화 문의 ${esc(phone())}</a>` : ''}</section>`;

  function home(req) {
    const base = baseUrl(req);
    const cols = published().slice(0, 3);
    const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: site.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
    const body = `
<section class="hero"><div class="in"><p class="eyebrow">${esc(site.heroEyebrow)}</p><h1>${nl2br(site.heroTitle)}</h1><p class="lead">${esc(site.heroSub)}</p>
<div class="btns"><a class="btn" href="/booking">진료 예약하기</a><a class="btn ghost" href="#eswt">한방 체외충격파 알아보기</a></div></div></section>
<section id="eswt" class="sec"><div class="in narrow"><h2>${esc(site.focusTitle)}</h2><div class="prose">${md(site.focusBody)}</div></div></section>
<section class="sec alt"><div class="in"><div class="points">${site.points.map(([t, d], i) => `<div class="point"><span class="no">0${i + 1}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div></div></section>
<section class="sec"><div class="in narrow"><h2>이런 통증으로 오세요</h2><ul class="check">${site.forWho.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><p class="small">${esc(site.forWhoNote)}</p></div></section>
<section class="sec alt"><div class="in narrow"><h2>진료는 이렇게 진행됩니다</h2><ol class="steps">${site.steps.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ol></div></section>
<section id="doctors" class="sec"><div class="in"><h2>의료진</h2><div class="docs">${doctors().map(docCard).join('')}</div></div></section>
${cols.length ? `<section class="sec alt"><div class="in"><h2>원장님 건강 칼럼</h2><div class="cols">${cols.map(colCard).join('')}</div><p><a href="/columns">칼럼 전체 보기 →</a></p></div></section>` : ''}
<section class="sec"><div class="in narrow"><h2>자주 묻는 질문</h2>${site.faq.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
<section id="visit" class="sec alt"><div class="in narrow"><h2>진료시간 · 오시는 길</h2><div class="visit"><div>${hoursHtml()}</div><div>
${site.address ? `<p><b>주소</b><br>${esc(site.address)}</p>` : ''}${site.parking ? `<p><b>주차·교통</b><br>${nl2br(site.parking)}</p>` : ''}
${phone() ? `<p><b>전화</b><br><a href="tel:${esc(phone().replace(/[^0-9+]/g, ''))}">${esc(phone())}</a></p>` : ''}${site.mapUrl ? `<p><a class="btn ghost" href="${esc(site.mapUrl)}" rel="noopener" target="_blank">지도에서 보기</a></p>` : ''}</div></div></div></section>
${ctaBox()}`;
    return page({ req, title: '', canonical: '/', body, ld: [faqLd] });
  }

  function doctorPage(req, d) {
    const base = baseUrl(req);
    const cols = published().filter((c) => c.doctorId === d.id);
    const ld = { '@context': 'https://schema.org', '@type': 'Physician', name: d.name || booking.docName(d), jobTitle: d.title, description: d.desc,
      image: photo(d) ? base + photo(d) : undefined, url: `${base}/doctors/${d.id}`, worksFor: { '@id': base + '/#clinic' } };
    const hrs = [1, 2, 3, 4, 5, 6, 0].map((w) => `<tr><th>${WEEK[w]}</th><td>${d.hours[w] ? `${d.hours[w][0]} ~ ${d.hours[w][1]}` : '<span class="off">휴진</span>'}</td></tr>`).join('');
    const body = `<section class="sec"><div class="in narrow"><div class="dochead">${photo(d) ? `<img src="${esc(photo(d))}" alt="${esc(booking.docName(d))}">` : ''}
<div><p class="eyebrow">${esc(d.title)}</p><h1>${esc(d.name || booking.docName(d))}</h1></div></div>
<div class="prose"><ul>${String(d.desc || '').split('/').map((s) => s.trim()).filter(Boolean).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
<h2>진료 요일·시간</h2><table class="hours">${hrs}</table>
${cols.length ? `<h2>${esc(booking.docName(d))} 칼럼</h2><div class="cols">${cols.map(colCard).join('')}</div>` : ''}
<p><a class="btn" href="/booking">${esc(booking.docName(d))}께 예약하기</a></p></div></section>`;
    return page({ req, title: booking.docName(d), desc: `${booking.docName(d)} · ${d.desc}`.slice(0, 150), canonical: `/doctors/${d.id}`, body, ld: [ld] });
  }

  function columnsPage(req) {
    const list = published();
    const body = `<section class="sec"><div class="in"><h1>원장님 건강 칼럼</h1><p class="lead">체외충격파와 통증 관리, 원장님이 직접 씁니다.</p>
<div class="cols">${list.length ? list.map(colCard).join('') : '<p>준비 중입니다.</p>'}</div></div></section>${ctaBox()}`;
    return page({ req, title: '건강 칼럼', desc: `${name} 원장님이 직접 쓰는 체외충격파·통증 관리 칼럼`, canonical: '/columns', body });
  }

  function columnPage(req, c) {
    const base = baseUrl(req);
    const d = docById(c.doctorId);
    const ld = { '@context': 'https://schema.org', '@type': 'MedicalWebPage', headline: c.title, description: c.summary, datePublished: c.publishedAt, dateModified: c.updatedAt,
      inLanguage: 'ko', mainEntityOfPage: `${base}/columns/${c.id}`, publisher: { '@id': base + '/#clinic' },
      author: d ? { '@type': 'Physician', name: d.name || booking.docName(d), jobTitle: d.title, url: `${base}/doctors/${d.id}` } : undefined,
      reviewedBy: d ? { '@type': 'Physician', name: d.name || booking.docName(d) } : undefined, lastReviewed: c.updatedAt.slice(0, 10) };
    const body = `<article class="sec"><div class="in narrow"><p class="eyebrow"><a href="/columns">건강 칼럼</a></p><h1>${esc(c.title)}</h1>
<p class="meta">${d ? `<a href="/doctors/${esc(d.id)}">${esc(booking.docName(d))}</a> · ` : ''}${esc(c.publishedAt.slice(0, 10))}${c.updatedAt.slice(0, 10) !== c.publishedAt.slice(0, 10) ? ` (수정 ${esc(c.updatedAt.slice(0, 10))})` : ''}</p>
${c.summary ? `<p class="summary">${esc(c.summary)}</p>` : ''}<div class="prose">${md(c.body)}</div>
<p class="small">${esc(site.disclaimer)}</p></div></article>${ctaBox('이 글과 같은 고민이 있다면')}`;
    return page({ req, title: c.title, desc: c.summary, canonical: `/columns/${c.id}`, body, ld: [ld] });
  }

  function sitemap(req) {
    const base = baseUrl(req);
    const urls = [['/', ''], ['/columns', ''], ['/booking', ''], ...doctors().map((d) => [`/doctors/${d.id}`, '']), ...published().map((c) => [`/columns/${c.id}`, c.updatedAt.slice(0, 10)])];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, m]) => `<url><loc>${esc(base + u)}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  }
  // AI가 사이트를 빨리 이해하도록 요약 (llms.txt 관례)
  function llms(req) {
    const base = baseUrl(req);
    const { days, lunch } = clinicHours();
    return [`# ${name}`, '', `> ${site.seoDescription}`, '',
      `- 중점 진료: ${site.heroEyebrow}`, site.address ? `- 주소: ${site.address}` : null, phone() ? `- 전화: ${phone()}` : null,
      `- 진료시간: ${days.map((d) => `${WEEK[d.w]} ${d.open ? d.open + '~' + d.close : '휴진'}`).join(', ')}${lunch ? ` (점심 ${lunch})` : ''}`,
      `- 온라인 예약: ${base}/booking`, '', `## ${site.focusTitle}`, '', plain(site.focusBody), '',
      '## 특징', ...site.points.map(([t, d]) => `- ${t}: ${d}`), '', '## 이런 통증', ...site.forWho.map((t) => `- ${t}`), '',
      '## 의료진', ...doctors().map((d) => `- [${booking.docName(d)}](${base}/doctors/${d.id}): ${d.desc}`), '',
      '## 자주 묻는 질문', ...site.faq.map(([q, a]) => `- ${q} ${a}`), '',
      '## 칼럼', ...published().map((c) => `- [${c.title}](${base}/columns/${c.id}): ${c.summary}`), ''].filter((x) => x != null).join('\n');
  }
  const robots = (req) => `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\n# AI 검색·답변 서비스도 허용 (GEO)\nUser-agent: GPTBot\nAllow: /\nUser-agent: OAI-SearchBot\nAllow: /\nUser-agent: ChatGPT-User\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: Claude-SearchBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\nUser-agent: Google-Extended\nAllow: /\nUser-agent: Yeti\nAllow: /\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`;

  // 공개 페이지 라우팅: 처리하면 true
  function render(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const p = url.pathname.replace(/\/$/, '') || '/';
    const out = (type, body, status = 200) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : body); return true; };
    const html = 'text/html; charset=utf-8';
    if (p === '/') return out(html, home(req));
    if (p === '/columns') return out(html, columnsPage(req));
    if (p === '/sitemap.xml') return out('application/xml; charset=utf-8', sitemap(req));
    if (p === '/robots.txt') return out('text/plain; charset=utf-8', robots(req));
    if (p === '/llms.txt') return out('text/plain; charset=utf-8', llms(req));
    let m;
    if ((m = p.match(/^\/doctors\/([a-z0-9]+)$/))) { const d = doctors().find((x) => x.id === m[1]); return d ? out(html, doctorPage(req, d)) : false; }
    if ((m = p.match(/^\/columns\/([a-f0-9]+)$/))) { const c = published().find((x) => x.id === m[1]); return c ? out(html, columnPage(req, c)) : false; }
    return false;
  }

  // ---- 관리자 API ----
  function cleanSite(b, str) {
    const pairs = (v, n, a, c) => (Array.isArray(v) ? v.slice(0, n).map((x) => [str(x && x[0], a), str(x && x[1], c)]).filter((x) => x[0]) : []);
    const list = (v, n, a) => (Array.isArray(v) ? v.slice(0, n).map((x) => str(x, a)).filter(Boolean) : []);
    const url = str(b.mapUrl, 500);
    return {
      address: str(b.address, 200), mapUrl: /^https:\/\//.test(url) ? url : '', parking: str(b.parking, 500),
      heroEyebrow: str(b.heroEyebrow, 40), heroTitle: str(b.heroTitle, 80), heroSub: str(b.heroSub, 300),
      focusTitle: str(b.focusTitle, 80), focusBody: str(b.focusBody, 5000),
      points: pairs(b.points, 6, 40, 300), forWho: list(b.forWho, 12, 100), forWhoNote: str(b.forWhoNote, 200),
      steps: pairs(b.steps, 8, 40, 300), faq: pairs(b.faq, 20, 120, 800),
      disclaimer: str(b.disclaimer, 500), seoDescription: str(b.seoDescription, 160),
    };
  }
  async function handle(req, res, url, { send, readBody, isAdmin, str }) {
    const p = url.pathname, M = req.method;
    if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
    if (p === '/api/admin/site') {
      if (M === 'GET') return send(res, 200, { site, defaults: defaultSite() });
      if (M === 'PUT') { site = cleanSite(await readBody(req, 100_000), str); writeJson(SITE_FILE, site); return send(res, 200, { site }); }
    }
    if (p === '/api/admin/columns' && M === 'GET') return send(res, 200, columns.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    const m = p.match(/^\/api\/admin\/columns(?:\/([a-f0-9]+))?$/);
    if (m) {
      const now = new Date().toISOString();
      if (M === 'DELETE' && m[1]) { columns = columns.filter((c) => c.id !== m[1]); writeJson(COL_FILE, columns); return send(res, 200, { ok: true }); }
      if ((M === 'POST' && !m[1]) || (M === 'PUT' && m[1])) {
        const b = await readBody(req, 200_000);
        const title = str(b.title, 120);
        if (!title) return send(res, 400, { error: '제목을 입력해 주세요.' });
        let c = m[1] && columns.find((x) => x.id === m[1]);
        if (m[1] && !c) return send(res, 404, { error: 'not found' });
        if (!c) { c = { id: crypto.randomBytes(5).toString('hex'), createdAt: now, publishedAt: '' }; columns.push(c); }
        const status = b.status === 'published' ? 'published' : 'draft';
        Object.assign(c, { title, summary: str(b.summary, 300), body: str(b.body, 50_000), doctorId: str(b.doctorId, 20), status, updatedAt: now });
        if (status === 'published' && !c.publishedAt) c.publishedAt = now;
        writeJson(COL_FILE, columns);
        return send(res, 200, c);
      }
    }
    return send(res, 404, { error: 'not found' });
  }

  return { render, handle };
};
