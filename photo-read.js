// 사진(차트 화면·처방전)에서 한약 카드 정보 읽기 — Claude API
// ANTHROPIC_API_KEY 가 없으면 꺼진 상태. 사진은 저장하지 않고 읽기 요청에만 쓰고 버립니다.
const sdk = require('@anthropic-ai/sdk');
const Anthropic = sdk.default || sdk;

const MODEL = process.env.PHOTO_READ_MODEL || 'claude-opus-5-5';
const enabled = () => !!process.env.ANTHROPIC_API_KEY;
let client = null;
const getClient = () => (client ||= new Anthropic({ maxRetries: 1, timeout: 60_000 }));

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['patient', 'otherNames', 'formula', 'round', 'total', 'phone', 'chartNo', 'delivery', 'memo'],
  properties: {
    patient: { type: 'string', description: '환자 이름(한글 2~5자). 확실하지 않으면 빈 문자열' },
    otherNames: { type: 'array', items: { type: 'string' }, description: '사진에 보이는 다른 환자 이름 후보' },
    formula: { type: 'string', description: '한약 처방명 (예: 당귀수산, 쌍화탕). 없으면 빈 문자열' },
    round: { type: 'integer', description: '이번 회차. 모르면 0' },
    total: { type: 'integer', description: '총 회차. 모르면 0' },
    phone: { type: 'string', description: '환자 휴대폰 번호 숫자만 (010…). 없으면 빈 문자열' },
    chartNo: { type: 'string', description: '차트번호 숫자. 없으면 빈 문자열' },
    delivery: { type: 'string', enum: ['택배', '직수', '내원', ''], description: '받는 방법이 적혀 있으면' },
    memo: { type: 'string', description: '조제·발송에 필요한 짧은 메모 (주소는 넣지 말 것). 없으면 빈 문자열' },
  },
};

const PROMPT = `이 사진은 한의원 직원이 찍은 전자차트(오케이차트) 화면이나 한약 처방전입니다.
한약 조제 관리 카드에 넣을 정보만 골라 주세요.

- 사진에 실제로 보이는 글자만 옮기세요. 보이지 않거나 흐려서 확실하지 않으면 빈 값(숫자는 0)으로 두세요. 추측해서 채우지 마세요.
- 환자 이름이 여러 명 보이면 가장 중심이 되는(선택된/제목에 있는) 환자를 patient에, 나머지를 otherNames에 넣으세요.
- 회차는 "3/6", "3차", "3회차" 같은 표기에서 읽습니다.
- 주소, 주민등록번호, 진단명, 병력은 옮기지 마세요.`;

// imageB64: base64 JPEG (data: 접두어 없이)
async function read(imageB64) {
  if (!enabled()) return { ok: false, error: '사진 읽기 미설정 (ANTHROPIC_API_KEY)' };
  try {
    const res = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });
    if (res.stop_reason === 'refusal') return { ok: false, error: '사진을 읽지 못했어요. 다시 찍어 주세요.' };
    if (res.stop_reason === 'max_tokens') return { ok: false, error: '읽기가 중간에 끊겼어요. 다시 시도해 주세요.' };
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const d = JSON.parse(text);
    return { ok: true, data: d };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: '요청이 많아요. 잠시 후 다시 해주세요.' };
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: '사진 읽기 키가 잘못됐어요 (관리자 확인).' };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, error: '사진을 처리할 수 없어요. 다시 찍어 주세요.' };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `사진 읽기 서버 오류 (${e.status || '연결'})` };
    if (e instanceof SyntaxError) return { ok: false, error: '읽은 결과를 해석하지 못했어요. 다시 시도해 주세요.' };
    throw e;
  }
}

module.exports = { read, enabled };
