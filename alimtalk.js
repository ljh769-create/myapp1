// 카카오 알림톡 발송 (솔라피). 환경변수가 없으면 꺼진 상태로 동작하고 아무것도 보내지 않습니다.
//  SOLAPI_API_KEY, SOLAPI_API_SECRET : 솔라피 콘솔 > API Key
//  SOLAPI_PFID                       : 카카오 채널 연동 후 받는 pfId
//  SOLAPI_FROM                       : 솔라피에 등록한 발신번호 (알림톡 실패 시 문자 대체발송에 사용)
//  ALIMTALK_TPL_SHIPPED / _PHOTO / _FOLLOWUP : 승인된 템플릿 ID (발송 안내 / 조제 사진 / 복용 안부)
const crypto = require('crypto');

const KEY = process.env.SOLAPI_API_KEY || '';
const SECRET = process.env.SOLAPI_API_SECRET || '';
const PFID = process.env.SOLAPI_PFID || '';
const FROM = (process.env.SOLAPI_FROM || '').replace(/[^0-9]/g, '');
const API = process.env.SOLAPI_API_BASE || 'https://api.solapi.com';
const TEMPLATES = {
  shipped: process.env.ALIMTALK_TPL_SHIPPED || '',   // 한약 발송 안내
  photo: process.env.ALIMTALK_TPL_PHOTO || '',       // 조제 완료 + 한약 사진 링크
  followup: process.env.ALIMTALK_TPL_FOLLOWUP || '', // 복용 중 안부 (15일 알람)
  welcome: process.env.ALIMTALK_TPL_WELCOME || '',   // 결제 첫날 시작 인사
};

const enabled = (type) => !!(KEY && SECRET && PFID && TEMPLATES[type]);

function authHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', SECRET).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

// variables: { '#{이름}': '홍길동', ... }  값은 모두 문자열이어야 함
async function send(type, to, variables) {
  if (!enabled(type)) return { ok: false, error: '알림톡 미설정' };
  const phone = String(to || '').replace(/[^0-9]/g, '');
  if (!/^01\d{8,9}$/.test(phone)) return { ok: false, error: '휴대폰 번호 형식 오류' };
  const vars = Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, String(v ?? '')]));
  const message = { to: phone, kakaoOptions: { pfId: PFID, templateId: TEMPLATES[type], variables: vars, disableSms: !FROM } };
  if (FROM) message.from = FROM;
  try {
    const res = await fetch(`${API}/messages/v4/send-many/detail`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [message] }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    const failed = Array.isArray(data.failedMessageList) && data.failedMessageList.length;
    if (!res.ok || failed) {
      const why = (failed && (data.failedMessageList[0].statusMessage || data.failedMessageList[0].statusCode)) || data.errorMessage || `HTTP ${res.status}`;
      return { ok: false, error: String(why).slice(0, 120) };
    }
    return { ok: true, id: (data.groupInfo && data.groupInfo._id) || '' };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 120) };
  }
}

module.exports = { send, enabled };
