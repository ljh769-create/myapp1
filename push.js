// 직원 휴대폰 푸시 알림 (Web Push). 키는 환경변수 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY,
// 없으면 처음 실행할 때 만들어 DATA_DIR/vapid.json 에 저장합니다 (키가 바뀌면 직원들이 알림을 다시 켜야 함).
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

module.exports = function createPush(dataDir) {
  let pub = process.env.VAPID_PUBLIC_KEY || '', priv = process.env.VAPID_PRIVATE_KEY || '';
  if (!pub || !priv) {
    const f = path.join(dataDir, 'vapid.json');
    try { ({ publicKey: pub, privateKey: priv } = JSON.parse(fs.readFileSync(f, 'utf8'))); } catch {
      const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(f, JSON.stringify(k), { mode: 0o600 });
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@example.com', pub, priv);

  // 반환: 'ok' | 'gone'(구독 만료, 지워야 함) | 'fail'
  async function sendOne(sub, payload) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: 12 * 3600, timeout: 10000 });
      return 'ok';
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) return 'gone';
      console.error('푸시 실패:', e.statusCode || e.message);
      return 'fail';
    }
  }
  return { publicKey: pub, sendOne };
};
