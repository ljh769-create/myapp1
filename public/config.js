// ✏️ 한의원 이름과 질문은 이 파일에서 자유롭게 수정하세요.
window.CLINIC = {
  name: '○○한의원',          // ← 한의원 이름으로 바꾸세요
  doctor: '원장',
  phone: '',                  // 선택: 걱정되는 증상이 있을 때 안내할 전화번호
};

// 선택지 묶음 (칩 형태로 보여집니다)
window.OPTIONS = {
  treatments: ['침', '뜸', '부항', '약침', '추나', '한약', '물리치료', '다이어트', '기타'],
  visitCount: ['오늘 처음', '2~5회째', '6회 이상', '치료 끝(종료)'],
  good: ['자세한 설명', '친절한 말투', '꼼꼼한 진찰', '치료 효과', '편안한 분위기', '깨끗한 환경', '짧은 대기', '생활 조언'],
  bad: ['설명이 부족', '대기가 길었어요', '치료 중 불편/통증', '비용이 궁금', '예약이 어려워요', '공간·시설', '말투/태도', '없어요'],
  learn: ['식습관', '운동·스트레칭', '수면', '스트레스', '한약 복용법', '재발 예방', '자세·생활습관', '계절 건강관리'],
};

// 5점 척도 라벨 (이모지 + 짧은 말)
window.SCALES = {
  improvement: [['😣', '더 나빠졌어요'], ['😕', '그대로예요'], ['🙂', '조금 좋아졌어요'], ['😊', '많이 좋아졌어요'], ['🤩', '아주 좋아졌어요']],
  agree: [['😞', '전혀 아니에요'], ['😕', '별로요'], ['😐', '보통이에요'], ['🙂', '그랬어요'], ['🥰', '매우 그랬어요']],
};

// 화면 순서. type: info | chips | scale | text | nps | contact
window.STEPS = [
  { id: 'treat', type: 'chips', multi: true, key: 'treatments', opts: 'treatments',
    title: '오늘까지 어떤 치료를 받으셨나요?', sub: '해당하는 것을 모두 골라주세요.' },
  { id: 'visit', type: 'chips', multi: false, key: 'visitCount', opts: 'visitCount',
    title: '저희 한의원에는 몇 번째 오셨어요?' },
  { id: 'improvement', type: 'scale', key: 'improvement', scale: 'improvement',
    title: '치료를 받으신 뒤, 몸 상태는 어떠세요?', sub: '처음 오셨을 때와 비교해서 느끼시는 대로요.' },
  { id: 'explain', type: 'scale', key: 'explain', scale: 'agree',
    title: '내 몸 상태와 치료에 대해 충분히 설명을 들으셨나요?', sub: '이해하기 쉬웠는지, 궁금한 걸 물어볼 수 있었는지요.' },
  { id: 'respect', type: 'scale', key: 'respect', scale: 'agree',
    title: '진료받는 동안 존중받고 편안하다고 느끼셨나요?', sub: '말투, 태도, 프라이버시 등 어떤 부분이든요.' },
  { id: 'wait', type: 'scale', key: 'wait', scale: 'agree',
    title: '기다리는 시간은 괜찮으셨나요?' },
  { id: 'clean', type: 'scale', key: 'clean', scale: 'agree',
    title: '공간이 깨끗하고 쾌적했나요?' },
  { id: 'good', type: 'text', tagKey: 'goodTags', textKey: 'goodText', opts: 'good', multi: true,
    title: '가장 좋았던 점은 무엇인가요?', sub: '고르시고, 하고 싶은 말이 있으면 적어주세요 (선택).',
    placeholder: '예) 원장님이 제 이야기를 끝까지 들어주셔서 좋았어요.' },
  { id: 'bad', type: 'text', tagKey: 'badTags', textKey: 'badText', opts: 'bad', multi: true,
    title: '아쉽거나 불편했던 점이 있으셨나요?', sub: '솔직한 말씀이 저희에게 가장 큰 배움이에요 (선택).',
    placeholder: '예) 침 맞을 때 아프다고 했는데 조금 더 살펴주셨으면 좋았을 것 같아요.' },
  { id: 'learn', type: 'text', tagKey: 'learnTags', textKey: 'learnText', opts: 'learn', multi: true,
    title: '건강 관리, 어떤 이야기를 더 듣고 싶으세요?', sub: '궁금한 주제를 알려주시면 다음 진료나 안내문에 담을게요 (선택).',
    placeholder: '예) 허리가 아플 때 집에서 할 수 있는 운동이 궁금해요.' },
  { id: 'nps', type: 'nps', key: 'nps',
    title: '가족이나 친구가 비슷한 증상이라면 저희 한의원을 추천하시겠어요?', sub: '0점 = 전혀 아니에요, 10점 = 꼭 추천해요' },
  { id: 'contact', type: 'contact',
    title: '마지막으로, 답장을 받아보시겠어요?',
    sub: '남겨주신 후기에 원장님이 직접 답글을 달아드려요. 이 앱에서 확인할 수 있어서 연락처는 꼭 필요하지 않아요.' },
];
