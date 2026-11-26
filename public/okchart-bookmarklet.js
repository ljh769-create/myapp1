(function () {
  /* 오케이차트(스마트애니웨어) 처방 화면에서 실행: 화면에 보이는 글자에서 환자 이름·처방 후보를 찾아
     한약 진행 앱의 '새 카드' 화면으로 넘깁니다. 차트 계정 정보는 읽지도 저장하지도 않습니다.
     데이터는 주소의 # 뒤에 담겨 앱 화면(직원 브라우저)으로만 전달되고, 서버로 보내지지 않습니다. */
  var APP = '__APP__';
  var docs = [];
  (function walk(w) {
    try { if (w.document && w.document.body) docs.push(w.document); } catch (e) { return; }
    for (var i = 0; i < w.frames.length; i++) walk(w.frames[i]);
  })(window);

  var text = '', sel = '', inputs = [];
  docs.forEach(function (d) {
    text += '\n' + (d.body.innerText || '');
    try { var s = String(d.getSelection ? d.getSelection() : ''); if (s.trim()) sel = s.trim(); } catch (e) {}
    var els = d.querySelectorAll('input,select,textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], v = el.tagName === 'SELECT' ? (el.options[el.selectedIndex] || {}).text : el.value;
      if (v && el.type !== 'password' && el.type !== 'hidden') inputs.push({ key: (el.id + ' ' + el.name + ' ' + (el.placeholder || '')).toLowerCase(), v: String(v).trim() });
    }
    text += '\n' + inputs.map(function (x) { return x.v; }).join('\n');
  });

  var KNAME = /^[가-힣]{2,5}$/;
  var patients = [], formulas = [];
  var PSTOP = /^(이름|이름을|이름은|성명|환자|환자명|처방|처방명|처방전|차트|진료|접수|수납|내원|예약|정보|번호|선택|확인|조회|검색|저장|취소|담당|원장|직원|남자|여자|보호자|생년월일|주소|전화|메모|없음|있음)$/;
  function add(arr, v) { v = (v || '').trim(); if (!v || arr.indexOf(v) >= 0) return; if (arr === patients && PSTOP.test(v)) return; arr.push(v); }

  if (KNAME.test(sel)) add(patients, sel);
  inputs.forEach(function (x) { if (/pat|name|nm|성명|환자|이름/.test(x.key) && KNAME.test(x.v)) add(patients, x.v); });
  docs.forEach(function (d) {
    var labs = d.querySelectorAll('th,td,label,span,div,dt,b,strong');
    for (var i = 0; i < labs.length && i < 5000; i++) {
      var t = (labs[i].innerText || '').replace(/\s/g, '').replace(/[:：]$/, '');
      if (/^(환자명|환자|성명|이름|수진자명?)$/.test(t)) {
        var n = labs[i].nextElementSibling; var v = n ? (n.innerText || n.value || '').trim().split(/\s/)[0] : '';
        if (KNAME.test(v)) add(patients, v);
      }
      if (/^(처방명|처방|약명|한약)$/.test(t)) {
        var n2 = labs[i].nextElementSibling; var v2 = n2 ? (n2.innerText || n2.value || '').trim().split(/\n/)[0] : '';
        if (v2 && v2.length <= 30) add(formulas, v2);
      }
    }
  });
  var m, re = /(환자명|환자|성명|이름|수진자)\s*[:：]?\s*([가-힣]{2,5})(?![가-힣])/g;
  while ((m = re.exec(text))) add(patients, m[2]);
  re = /(처방명|약명)\s*[:：]?\s*([가-힣A-Za-z0-9()]{2,20})/g;
  while ((m = re.exec(text))) add(formulas, m[2]);
  var STOP = /^(진단|판단|중단|상단|하단|간단|계산|생산|전산|예산|확산|분산|정산|합산|환산|청산|발산|증상|안산|부산|산|탕|환|음|단|수납|발음|소음|녹음|처음|다음|마음|이음|요금|개환|교환|순환|전환|변환|반환|송환|귀환|소환|복음|화음|잡음|방음|소화|가단|정단|문단|단단|양단|조단|일단|이단|청단|결단|금단|무단)$/;
  re = /([가-힣]{1,10}(?:탕|산|환|음|단))(?![가-힣])/g;
  while ((m = re.exec(text))) if (!STOP.test(m[1])) add(formulas, m[1]);

  var chart = (/(차트번호|챠트번호|차트\s*No\.?|등록번호)\s*[:：]?\s*(\d{2,10})/.exec(text) || [])[2] || '';
  var data = { patients: patients.slice(0, 8), formulas: formulas.slice(0, 12), chartNo: chart };
  var url = APP + '/herb#new=' + encodeURIComponent(JSON.stringify(data));
  var w = window.open(url, 'herbapp');
  if (!w) location.href = url;
})();
