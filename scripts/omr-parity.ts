/**
 * 원본 Apps Script vs 새 엔진 비교 테스트.  실행: npm run test:omr
 * 무작위 시험·답안 수천 건을 양쪽에 넣고 점수·영역·코멘트·문자가 글자까지 같은지 확인합니다.
 */
// @ts-ignore
import { loadLegacy } from './legacy-sandbox.mjs';
import * as E from '../lib/omr/engine';

const L: any = loadLegacy();
let seed = 20261108;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pickOne = <X,>(a: X[]) => a[ri(0, a.length - 1)];

const NAMES = ['김민준', '이서연', '박지호', '최유나', '정하윤A', '강도윤', '윤서아', '임준서', '한지민B', '오은'];
const AREAS = ['현대시', '문법', '고전시가', '독서', '문학', '비문학', '화법'];
const CONCEPTS = ['화자와 정서', '비유와 상징', '품사', '문장 성분', '시상 전개', ''];
const FIXES = ['개념을 표로 정리합니다.', '오답노트를 씁니다.', ''];

let fails = 0, checks = 0;
function eq(label: string, a: unknown, b: unknown) {
  checks++;
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) { fails++; if (fails <= 5) console.log('불일치', label, '\n 원본:', ja, '\n 새것:', jb); }
}

// 1) 100점 환산: 문항 1~200, 맞힌 수 전부
for (let n = 1; n <= 200; n++) for (let s = 0; s <= n; s++) eq(`pts ${s}/${n}`, L.pts(s, n), E.pts(s, n));

// 2) 무작위 시험
for (let t = 0; t < 3000; t++) {
  const n = ri(3, 30);
  const key = Array.from({ length: n }, () => ri(1, 5));
  const answers = key.map((k) => (rnd() < 0.7 ? k : rnd() < 0.1 ? 0 : ri(1, 5)));
  const info: any = {};
  const noInfo = rnd() < 0.15;
  for (let i = 1; i <= n; i++) if (!noInfo && rnd() < 0.9) info[i] = { area: pickOne(AREAS.slice(0, ri(1, 7))), concept: pickOne(CONCEPTS), fix: pickOne(FIXES) };
  const name = pickOne(NAMES), exam = '복습테스트 ' + ri(1, 40) + '회';
  const guide = rnd() < 0.5 ? '아주 잘했어요!|조금만 더 힘내요.|복습이 꼭 필요해요.' : '';

  const gL = L.grade({ n, ans: key }, answers), gE = E.grade(key, answers, n);
  eq('grade', gL, gE);
  const sL = L.areaStats(info, gL), sE = E.areaStats(info, gE);
  eq('areaStats', sL, sE);
  const wL = L.weakAreas(sL), wE = E.weakAreas(sE);
  eq('weakAreas', wL, wE);
  eq('comment', L.reportComment(name, exam, gL, sL, wL, info), E.reportComment(name, exam, gE, sE, wE, info));
  eq('message', L.parentMessage(name, { guide }, gL, wL, 'KEY123'),
     E.parentMessage({ name, teacher: L.__T.TEACHER, guide, g: gE, weak: wE, url: 'https://example.app/r?r=KEY123' }));
}

// 3) 리포트 '보완 필요' 판정: 원본 getReport를 가짜 시트로 실행해 비교
for (let t = 0; t < 400; t++) {
  const n = ri(4, 20);
  const info: any = {}; const itemRows: any[] = [];
  for (let i = 1; i <= n; i++) {
    const a = pickOne(AREAS.slice(0, 3));
    info[i] = { area: a, concept: pickOne(CONCEPTS), fix: pickOne(FIXES) };
    itemRows.push({ 반: 'A반', 시험명: '시험', 번호: i, 영역: a, '핵심 개념': info[i].concept, '보완 방법': info[i].fix });
  }
  const peers = Array.from({ length: ri(1, 12) }, (_, k) => ({
    제출시각: new Date(2026, 10, 1, 10, k), 학번: String(1000 + k), 반: 'A반', 시험명: '시험',
    채점: Array.from({ length: n }, () => (rnd() < 0.65 ? 1 : 0)).join(''),
  }));
  const me = peers[0];
  L.table = (tab: string) => tab === '학생명단' ? [{ 학번: me.학번, 이름: '김민준', '현재 반': 'A반', 리포트키: 'K' }]
    : tab === '누적' ? peers : tab === '문항정보' ? itemRows : [];
  L.Utilities = { formatDate: () => '11/1' }; L.Session = { getScriptTimeZone: () => 'Asia/Seoul' };
  const r = L.getReport('K');
  const g = E.fromOx(me.채점);
  eq('areaRates', r.exams[0].areas, E.areaRates(info, g, peers.map((p) => p.채점)));
}

console.log(`검사 ${checks}건 / 불일치 ${fails}건`);
process.exit(fails ? 1 : 0);
