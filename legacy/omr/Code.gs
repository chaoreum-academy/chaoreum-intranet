/**
 * 복습테스트 OMR 자동채점기 (차오름학원 심진섭 선생님)
 * 구글 시트 + Apps Script. 시트 탭: 설정, 문항정보, 학생명단, 웹응답, 누적, 결과, 결과보관
 * 학생 화면: Omr.html, 학생 리포트: Report.html (웹앱 주소?r=리포트키)
 */

const TEACHER = '심진섭';   // 문자 첫 줄에 들어가는 강사 이름

const HEAD = {
  '설정': ['반', '시험명', '문항수', '정답', '문항유형', '시작일시', '열기', '문자 안내'],
  '문항정보': ['반', '시험명', '번호', '정답', '영역', '핵심 개념', '보완 방법', '문제 유형', '출처', '선지별 함정', '과목', '세부·갈래', '형식'],
  '학생명단': ['학번', '이름', '현재 반', '비고', '리포트키'],
  '웹응답': ['제출시각', '학번', '이름', '반', '시험명', '답'],
  '누적': ['제출시각', '학번', '이름', '반', '시험명', '점수', '문항수', '답', '채점', '틀린 문항'],
  '결과': ['제출시각', '이름', '반', '시험명', '점수', '틀린 문항', '부족한 영역', '틀린 문항 개념', '전송용 문자', '리포트 코멘트'],
  '결과보관': ['제출시각', '이름', '반', '시험명', '점수', '틀린 문항', '부족한 영역', '틀린 문항 개념', '전송용 문자', '리포트 코멘트'],
};
const CIRCLE = '①②③④⑤⑥⑦⑧⑨';
const ADMIN = '관리자';

/* ───────────── 메뉴 ───────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('OMR 채점')
    .addItem('학생용 주소·QR 보기', 'showUrl')
    .addItem('제출 현황 만들기', 'makeSubmitStatus')
    .addItem('점수 순위 만들기', 'makeRanking')
    .addItem('클리닉 명단 보기', 'makeClinicList')
    .addItem('이번 주 응답 전체 다시 채점', 'regradeThisWeek')
    .addItem('학생 리포트 키 만들기', 'makeReportKeys')
    .addItem('누적 중복 정리', 'dedupeHistory')
    .addItem('지난 결과 지금 보관함으로 옮기기', 'archiveNow')
    .addItem('매일 새벽 4시 자동 보관 켜기', 'enableDailyArchive')
    .addToUi();
}

/** 처음 한 번만 실행: 탭 7개와 머리글을 만든다(이미 있는 탭은 머리글만 맞춘다). 설치를 돕는 함수라 메뉴에는 없다. */
function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HEAD).forEach(function (name) {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEAD[name].length).setValues([HEAD[name]]).setFontWeight('bold').setBackground('#eef3ee');
    sh.setFrozenRows(1);
  });
  textColumn('결과', 6);
  textColumn('결과보관', 6);
  textColumn('누적', 9);
  textColumn('누적', 10);
  textColumn('학생명단', 1);
  const first = ss.getSheets()[0];
  if (first.getName() === '시트1' && first.getLastRow() === 0) ss.deleteSheet(first);
  addDemo();
  onOpen();
}

/** 마무리 확인용: 관리자 줄, 체험학생 줄, 체험 퀴즈(5문항). 이미 있으면 다시 넣지 않는다. 확인이 끝나면 지워도 된다. */
function addDemo() {
  const has = function (tab, col, v) { return table(tab).some(function (r) { return String(r[col]).trim() === v; }); };
  if (!has('학생명단', '현재 반', ADMIN)) sheet('학생명단').appendRow(['0000', TEACHER, ADMIN, '선생님 시험용(기록 안 남음)', '']);
  if (!has('학생명단', '이름', '체험학생')) sheet('학생명단').appendRow(['9999', '체험학생', '체험', '마무리 확인용(나중에 지우기)', '']);
  if (!has('설정', '시험명', '체험 퀴즈')) {
    sheet('설정').appendRow(['체험', '체험 퀴즈', 5, '③①④②⑤', '', '', 'O', '아주 잘했어요!|조금만 더 힘내요.|복습이 꼭 필요해요.']);
    const s = sheet('문항정보');
    [[1, '③', '현대시', '화자와 정서', '시의 화자가 처한 상황과 정서를 한 문장으로 정리합니다.', '내용 이해', '체험', '', '국어', '현대시·화자', '객관식'],
     [2, '①', '현대시', '비유와 상징', '시어의 원관념과 보조 관념을 표로 정리합니다.', '표현', '체험', '', '국어', '현대시·표현', '객관식'],
     [3, '④', '현대시', '시상 전개', '시상 전개 순서를 연별로 요약해 봅니다.', '구조', '체험', '', '국어', '현대시·구조', '객관식'],
     [4, '②', '문법', '품사', '품사 9개를 예문과 함께 외웁니다.', '개념 적용', '체험', '', '국어', '문법·품사', '객관식'],
     [5, '⑤', '문법', '문장 성분', '문장 성분을 찾아 밑줄 긋는 연습을 합니다.', '개념 적용', '체험', '', '국어', '문법·문장', '객관식']]
      .forEach(function (r) { s.appendRow(['체험', '체험 퀴즈'].concat(r)); });
  }
  makeReportKeysQuiet();
}

function makeReportKeysQuiet() {
  let n = 0;
  table('학생명단').forEach(function (r) {
    if (!String(r['리포트키'] || '').trim() && normId(r['학번'])) { newKeyFor(r._row); n++; }
  });
  return n;
}

function textColumn(name, col) {   // '틀린 문항'(3, 12)이 날짜로 바뀌지 않게 글자 형식
  const sh = sheet(name);
  sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
}

/* ───────────── 웹앱 ───────────── */

function doGet(e) {
  const report = e && e.parameter && e.parameter.r;
  const out = HtmlService.createHtmlOutputFromFile(report ? 'Report' : 'Omr')
    .setTitle(report ? '복습테스트 리포트' : '복습테스트 OMR')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return out;
}

function appUrl() {
  return ScriptApp.getService().getUrl();
}

/** 로그인: 학번 + 이름(한글만 비교, A·B 같은 표시는 무시) */
function login(id, name) {
  const st = findStudent(id, name);
  if (!st) return { ok: false, msg: '학번과 이름을 다시 확인해 주세요. 명단에 없으면 선생님께 말씀해 주세요.' };
  return { ok: true, id: st.id, name: st.name, cls: st.cls, admin: st.cls === ADMIN, exams: openExams(st) };
}

function findStudent(id, name) {
  id = normId(id);
  const nm = hangul(name);
  if (!id || !nm) return null;
  const rows = table('학생명단');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (normId(r['학번']) === id && hangul(r['이름']) === nm) {
      return { id: id, name: String(r['이름']).trim(), cls: String(r['현재 반']).trim(), key: String(r['리포트키'] || '').trim(), row: r._row };
    }
  }
  return null;
}

/** 학번 비교: 시트가 0000을 0으로 바꾸거나 엑셀에서 앞 0이 빠져도 같게 본다 */
function normId(v) { return String(v == null ? '' : v).trim().replace(/^0+(?=\d)/, ''); }

function hangul(s) { return String(s || '').replace(/[^가-힣]/g, ''); }

/** 학생이 고를 수 있는 시험: 자기 반(관리자는 전부), 열기 O, 시작일시가 지난 것 */
function openExams(st) {
  const now = new Date();
  const done = st.cls === ADMIN ? {} : submittedKeys(st.id);
  return table('설정').filter(function (r) {
    const open = String(r['열기']).trim().toUpperCase() === 'O';
    const cls = String(r['반']).trim();
    const start = r['시작일시'] instanceof Date ? r['시작일시'] : (r['시작일시'] ? new Date(r['시작일시']) : null);
    return open && r['시험명'] && (st.cls === ADMIN || cls === st.cls) && (!start || isNaN(start) || start <= now);
  }).map(function (r) {
    const cls = String(r['반']).trim(), name = String(r['시험명']).trim();
    return { cls: cls, name: name, n: Number(r['문항수']) || parseAnswer(r['정답']).length,
             choices: choiceCount(r['문항유형']), done: !!done[cls + '|' + name] };
  });
}

function choiceCount(t) {   // 문항유형: 비우면 5지선다, 숫자(예: 4)를 넣으면 그 수만큼
  const n = parseInt(String(t || '').replace(/\D/g, ''), 10);
  return n >= 2 && n <= 9 ? n : 5;
}

function submittedKeys(id) {
  const out = {};
  table('웹응답').forEach(function (r) {
    if (normId(r['학번']) === id) out[String(r['반']).trim() + '|' + String(r['시험명']).trim()] = true;
  });
  return out;
}

/** 제출: 중복 막기 → 기록 → 채점 → 결과·누적 기록 → 화면에 점수와 틀린 문항 */
function submit(id, name, cls, examName, answers) {
  const st = findStudent(id, name);
  if (!st) return { ok: false, msg: '로그인 정보가 맞지 않아요. 다시 들어와 주세요.' };
  const exam = findExam(cls, examName);
  if (!exam) return { ok: false, msg: '시험을 찾을 수 없어요.' };
  if (st.cls !== ADMIN && st.cls !== exam.cls) return { ok: false, msg: '우리 반 시험이 아니에요.' };
  const g = grade(exam, answers);
  if (st.cls === ADMIN) {   // 선생님 시험용: 기록·통계에 남기지 않는다
    return { ok: true, score: pts(g.score, g.n), n: 100, right: g.score, total: g.n, wrong: g.wrong, admin: true };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (submittedKeys(st.id)[exam.cls + '|' + exam.name]) return { ok: false, msg: '이미 제출했어요.' };
    const when = new Date();
    sheet('웹응답').appendRow([when, st.id, st.name, exam.cls, exam.name, answerText(answers, g.n)]);
    const key = st.key || newKeyFor(st.row);
    writeHistory(when, st, exam, g, answers);
    writeResult('결과', when, st, exam, g, key, null);
    SpreadsheetApp.flush();
    return { ok: true, score: pts(g.score, g.n), n: 100, right: g.score, total: g.n, wrong: g.wrong, report: appUrl() + '?r=' + key };
  } finally {
    lock.releaseLock();
  }
}

function findExam(cls, name) {
  cls = String(cls).trim(); name = String(name).trim();
  const r = table('설정').filter(function (x) { return String(x['반']).trim() === cls && String(x['시험명']).trim() === name; })[0];
  if (!r) return null;
  const ans = parseAnswer(r['정답']);
  return { cls: cls, name: name, ans: ans, n: Number(r['문항수']) || ans.length, guide: String(r['문자 안내'] || '').trim() };
}

function parseAnswer(s) {   // '③⑤②…' → [3,5,2,…]
  return String(s || '').split('').map(function (c) { return CIRCLE.indexOf(c) + 1; }).filter(function (x) { return x > 0; });
}

function answerText(answers, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(answers[i] ? CIRCLE.charAt(answers[i] - 1) : '-');
  return out.join('');
}

function grade(exam, answers) {
  const ox = [], wrong = [];
  for (let i = 0; i < exam.n; i++) {
    const ok = Number(answers[i]) === exam.ans[i];
    ox.push(ok ? 1 : 0);
    if (!ok) wrong.push(i + 1);
  }
  return { n: exam.n, score: exam.n - wrong.length, ox: ox, wrong: wrong };
}

/** 100점 만점 환산(2026-11-07 선생님: 배점 없이 맞힌 개수로 100점 만점 계산). 18/20 → 90, 18/23 → 78 */
function pts(score, n) { return Math.round(Number(score) / (Number(n) || 1) * 100); }

/* ───────────── 영역 통계 ───────────── */

function same(a, b) { return String(a == null ? '' : a).replace(/\s+/g, '') === String(b == null ? '' : b).replace(/\s+/g, ''); }

function itemInfo(cls, name) {   // 번호 → {영역, 핵심 개념, 보완 방법}  ('기타'는 쓰지 않는다: 영역이 비면 영역 통계에서 뺀다)
  const out = {};
  table('문항정보').forEach(function (r) {
    if (same(r['반'], cls) && same(r['시험명'], name)) {
      out[Number(r['번호'])] = { area: String(r['영역'] || '').trim(), concept: String(r['핵심 개념'] || '').trim(), fix: String(r['보완 방법'] || '').trim() };
    }
  });
  return out;
}

function areaStats(info, g) {
  const st = {}, order = [];
  for (let i = 1; i <= g.n; i++) {
    const a = (info[i] && info[i].area) || '';
    if (!a) continue;   // 문항정보가 없는 문항은 영역 통계에 넣지 않는다
    if (!st[a]) { st[a] = { area: a, total: 0, wrong: 0, nums: [] }; order.push(a); }
    st[a].total++;
    if (!g.ox[i - 1]) { st[a].wrong++; st[a].nums.push(i); }
  }
  return order.map(function (a) { return st[a]; });
}

/** 부족한 영역 순위: 틀린 것이 있는 영역 중 문항 3개 이상인 영역을 앞에, 그 안에서 오답률·오답 수 순 */
function weakAreas(stats) {
  return stats.filter(function (s) { return s.wrong > 0; }).sort(function (a, b) {
    const sa = a.total < 3 ? 1 : 0, sb = b.total < 3 ? 1 : 0;
    if (sa !== sb) return sa - sb;
    const ra = a.wrong / a.total, rb = b.wrong / b.total;
    if (ra !== rb) return rb - ra;
    return b.wrong - a.wrong;
  });
}

/* ───────────── 기록 ───────────── */

function writeHistory(when, st, exam, g, answers) {
  const sh = sheet('누적');
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 9, 1, 2).setNumberFormat('@');   // 채점(10110…)·틀린 문항이 숫자·날짜로 바뀌지 않게
  sh.getRange(r, 1, 1, 10).setValues([[when, st.id, st.name, exam.cls, exam.name, g.score, g.n, answerText(answers, g.n), g.ox.join(''), g.wrong.join(', ')]]);
}

function resultRow(when, st, exam, g, key) {
  const info = itemInfo(exam.cls, exam.name);
  const stats = areaStats(info, g);
  const weak = weakAreas(stats);
  const concepts = g.wrong.map(function (k) { return k + '번 ' + ((info[k] && info[k].concept) || ''); }).join(' / ');
  return [when, st.name, exam.cls, exam.name, pts(g.score, g.n), g.wrong.join(', '),
          weak.slice(0, 2).map(function (w) { return w.area + '(' + w.nums.join(', ') + '번)'; }).join(', '),
          concepts, parentMessage(st.name, exam, g, weak, key), reportComment(st.name, exam.name, g, stats, weak, info)];
}

function writeResult(tab, when, st, exam, g, key, rowNo) {
  const sh = sheet(tab);
  const row = resultRow(when, st, exam, g, key);
  const r = rowNo || sh.getLastRow() + 1;
  sh.getRange(r, 6).setNumberFormat('@');
  sh.getRange(r, 1, 1, row.length).setValues([row]);
}

/* ───────────── 학부모 전송용 문자 ───────────── */

function callName(name) {   // 성 뺀 부르는 이름
  const h = hangul(name);
  return h.length >= 2 ? h.slice(1) : h;
}

function josaWa(word) {   // 받침 있으면 '과', 없으면 '와'
  const h = hangul(word);
  if (!h) return '와';
  const c = h.charCodeAt(h.length - 1) - 0xAC00;
  return c % 28 ? '과' : '와';
}

const CLOSING = [
  [70, '이어서 추가 빈칸 채우기 테스트로 핵심 개념을 다시 외우고, 틀린 문제는 왜 틀렸는지 깜지를 쓰고 하원했습니다. 기본 개념부터 다시 잡아야 해서 아이와 이야기 후 추가 클리닉 등원 약속 잡아보겠습니다.'],
  [50, '이어서 추가 빈칸 채우기 테스트로 핵심 개념을 다시 외우고, 틀린 문제는 왜 틀렸는지 깜지를 쓰고 하원했습니다.'],
  [30, '이어서 추가 빈칸 채우기 테스트로 핵심 개념을 다시 외우고 하원했습니다.'],
  [20, '틀린 개념은 오답노트에 정리하고 다시 외운 뒤 하원했습니다.'],
  [10, '틀린 문항에서 본인이 못 외운 부분을 직접 찾아 다시 정리하고 하원했습니다.'],
  [0, '실수를 줄이고 지문을 꼼꼼히 읽는 연습이 필요합니다.'],
];

function parentMessage(name, exam, g, weak, key) {
  const full = hangul(name);
  const rate = g.wrong.length / g.n * 100;
  const L = ['안녕하세요. ' + callName(name) + ' 담당 강사 ' + TEACHER + '입니다.^^'];
  if (exam.guide) {
    const p = exam.guide.split('|').map(function (s) { return s.trim(); });
    const pick = rate <= 20 ? p[0] : rate <= 50 ? p[1] : p[2];
    if (pick) L.push(pick);
  }
  L.push(full + ' 학생의 오늘 테스트 결과는 100점 만점에 ' + pts(g.score, g.n) + '점입니다(' + g.n + '문항 중 ' + g.score + '문항 정답).');
  if (!g.wrong.length) {
    L.push('전 문항 정답입니다. 배운 내용을 꼼꼼히 잘 정리하고 있어서 클리닉 시간에 많이 칭찬해 주었습니다.');
  } else {
    let s = '틀린 문항은 ' + g.wrong.join(', ') + '번입니다. ';
    const w1 = weak[0], w2 = weak[1];
    if (w1 && w2) {
      s += '특히 ' + w1.area + '(' + w1.nums.join(', ') + '번)' + josaWa(w1.area) + ' ' + w2.area + '(' + w2.nums.join(', ') + '번) 부분이 부족했는데, ';
    } else if (w1) {
      s += '특히 ' + w1.area + '(' + w1.nums.join(', ') + '번) 부분이 부족했는데, ';
    }
    s += '오늘 클리닉 시간에 틀린 문항을 모두 다시 고치고 풀이까지 해 주었습니다.';
    L.push(s);
    for (let i = 0; i < CLOSING.length; i++) {
      if (rate > CLOSING[i][0]) { L.push(CLOSING[i][1]); break; }
    }
  }
  L.push(appUrl() + '?r=' + key);
  return L.join('\n');
}

/* ───────────── 리포트 코멘트 (4~6줄) ───────────── */

function level(rate) {   // 오답률 단계: 0 만점, 1 ≤10, 2 ≤20, 3 ≤30, 4 ≤50, 5 ≤70, 6 그 위
  if (rate === 0) return 0;
  if (rate <= 10) return 1;
  if (rate <= 20) return 2;
  if (rate <= 30) return 3;
  if (rate <= 50) return 4;
  if (rate <= 70) return 5;
  return 6;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick(list, seed) { return list[hash(seed) % list.length]; }

function fill(t, v) { return t.replace(/\{([^}]+)\}/g, function (_, k) { return v[k] != null ? v[k] : ''; }); }

const C_FIRST = [
  [ // 만점
    '{시험}에서 전 문항을 맞혀 정답률 100%를 기록했습니다.',
    '이번 테스트({시험})는 한 문제도 틀리지 않고 만점을 받았습니다.',
    '{시험} 결과 정답률 100%로, 배운 내용을 아주 정확하게 이해하고 있습니다.',
    '이번 테스트({시험})에서 모든 문항을 정확히 풀어 만점을 받았습니다.',
    '{시험}에서 만점을 받아 준비가 아주 잘 되어 있음을 보여 주었습니다.',
    '정답률 100%로 이번 테스트({시험})를 완벽하게 마무리했습니다.'],
  [ // 10% 이하
    '{시험}에서 정답률 {정답률}%로 거의 모든 문항을 정확히 풀었습니다.',
    '이번 테스트({시험})는 정답률 {정답률}%로 아주 좋은 결과를 받았습니다.',
    '{시험} 결과 정답률 {정답률}%로, 핵심 내용을 대부분 잘 알고 있습니다.',
    '정답률 {정답률}%로 이번 테스트를 안정적으로 마쳤습니다.',
    '{시험}에서 {정답률}%의 높은 정답률을 보였습니다.',
    '이번 테스트({시험})는 실수 몇 개만 빼면 거의 완벽했습니다(정답률 {정답률}%).'],
  [ // 20% 이하
    '{시험}에서 정답률 {정답률}%로 좋은 결과를 받았습니다.',
    '이번 테스트({시험})는 정답률 {정답률}%로 전반적으로 잘 이해하고 있습니다.',
    '{시험} 결과 정답률 {정답률}%로, 기본 내용은 잘 잡혀 있습니다.',
    '정답률 {정답률}%로 대부분의 문항을 정확히 풀었습니다.',
    '{시험}에서 {정답률}%의 정답률을 보여 꾸준히 잘 따라오고 있습니다.',
    '이번 테스트는 정답률 {정답률}%로 안정적인 편입니다.'],
  [ // 30% 이하
    '{시험}에서 정답률 {정답률}%로, 기본은 갖추었지만 놓친 부분이 조금 있습니다.',
    '이번 테스트({시험})는 정답률 {정답률}%로 몇몇 개념을 다시 다질 필요가 있습니다.',
    '{시험} 결과 정답률 {정답률}%로, 아는 내용과 헷갈리는 내용이 섞여 있습니다.',
    '정답률 {정답률}%로 전체 흐름은 이해했지만 세부 개념에서 실수가 있었습니다.',
    '{시험}에서 {정답률}%의 정답률을 보여, 조금만 보완하면 더 좋아질 수 있습니다.',
    '이번 테스트는 정답률 {정답률}%로 보완할 부분이 보이는 결과입니다.'],
  [ // 50% 이하
    '{시험}에서 정답률 {정답률}%로, 아직 정리가 덜 된 개념이 여럿 있습니다.',
    '이번 테스트({시험})는 정답률 {정답률}%로 핵심 개념을 다시 짚어야 하는 상태입니다.',
    '{시험} 결과 정답률 {정답률}%로, 복습이 더 필요한 결과입니다.',
    '정답률 {정답률}%로 절반 정도의 내용을 정확히 알고 있습니다.',
    '{시험}에서 {정답률}%의 정답률을 보여 배운 내용을 다시 정리할 필요가 있습니다.',
    '이번 테스트는 정답률 {정답률}%로 개념 복습이 꼭 필요합니다.'],
  [ // 70% 이하
    '{시험}에서 정답률 {정답률}%로, 배운 내용이 아직 많이 헷갈리는 상태입니다.',
    '이번 테스트({시험})는 정답률 {정답률}%로 기본 개념부터 다시 다져야 합니다.',
    '{시험} 결과 정답률 {정답률}%로, 복습 시간이 더 필요해 보입니다.',
    '정답률 {정답률}%로 핵심 내용 상당 부분을 다시 공부해야 합니다.',
    '{시험}에서 {정답률}%의 정답률을 보여 집중 보완이 필요합니다.',
    '이번 테스트는 정답률 {정답률}%로 개념을 처음부터 다시 정리할 필요가 있습니다.'],
  [ // 그 위
    '{시험}에서 정답률 {정답률}%로, 배운 내용을 거의 정리하지 못한 상태입니다.',
    '이번 테스트({시험})는 정답률 {정답률}%로 기본 개념부터 함께 다시 잡아야 합니다.',
    '{시험} 결과 정답률 {정답률}%로, 따로 시간을 내어 복습해야 합니다.',
    '정답률 {정답률}%로 이번 범위의 핵심을 처음부터 다시 익혀야 합니다.',
    '{시험}에서 {정답률}%의 정답률이 나와 추가 클리닉이 필요해 보입니다.',
    '이번 테스트는 정답률 {정답률}%로 개념 학습을 다시 해야 하는 결과입니다.'],
];

const C_GOOD = [
  '{영역} 영역은 모두 맞혀 이해가 잘 되어 있습니다.',
  '{영역} 영역에서는 틀린 문제가 없어 기본기가 탄탄합니다.',
  '특히 {영역} 영역은 정확하게 풀어 잘 정리되어 있음을 보여 주었습니다.',
  '{영역} 영역은 실수 없이 모두 맞혔습니다.',
  '{영역} 영역은 배운 내용을 잘 기억하고 있어 칭찬할 만합니다.',
  '{영역} 영역의 문항은 모두 정답으로, 이 부분은 자신감을 가져도 좋습니다.'];

const C_KEEP = [
  '지금처럼 수업 후 바로 복습하는 습관을 이어 가면 좋겠습니다.',
  '꾸준히 정리하는 습관이 결과로 나타나고 있습니다.',
  '배운 개념을 정확히 기억하고 문제에 잘 적용하고 있습니다.',
  '이해한 내용을 문제 풀이에 정확히 옮기는 힘이 좋습니다.',
  '지문을 꼼꼼히 읽고 근거를 찾아 푸는 습관이 잘 잡혀 있습니다.',
  '이 흐름을 유지하면 학교 시험에서도 좋은 결과를 기대할 수 있습니다.'];

const C_WEAK1 = [
  '가장 부족한 부분은 {영역} 영역으로, {번호}번 문항을 놓쳤습니다. 특히 \'{개념}\' 부분을 다시 정리해야 합니다.',
  '{영역} 영역에서 {번호}번을 틀렸는데, \'{개념}\' 개념이 아직 정확하지 않은 것으로 보입니다.',
  '이번에 가장 아쉬운 부분은 {영역}({번호}번)이며, \'{개념}\' 부분을 다시 확인할 필요가 있습니다.',
  '{영역} 영역({번호}번)에서 실수가 가장 많았고, \'{개념}\' 내용을 헷갈려했습니다.',
  '{번호}번을 틀린 {영역} 영역이 가장 약한 부분으로, \'{개념}\' 부분을 중심으로 복습이 필요합니다.',
  '{영역} 영역의 {번호}번 문항에서 \'{개념}\' 부분을 정확히 적용하지 못했습니다.'];

const C_WEAK2 = [
  '그다음으로 {영역}({번호}번)도 함께 보완하면 좋겠습니다.',
  '{영역} 영역({번호}번)도 조금 더 연습이 필요합니다.',
  '또한 {영역}에서 {번호}번을 놓쳐 이 부분도 다시 살펴보겠습니다.',
  '{영역} 영역({번호}번)도 헷갈린 부분이 있어 함께 복습하겠습니다.',
  '두 번째로 보완할 부분은 {영역}({번호}번)입니다.',
  '{영역}의 {번호}번 문항도 다시 풀어 보며 정리할 예정입니다.'];

const C_FIX = [
  '보완 방법: {보완}',
  '이렇게 보완하겠습니다: {보완}',
  '보완할 점: {보완}',
  '다음 공부 방법: {보완}',
  '이번 보완 계획: {보완}',
  '클리닉 보완: {보완}'];

const FIX_DEFAULT = '틀린 문항의 지문을 다시 읽고, 핵심 개념을 자기 말로 설명해 보는 연습을 하겠습니다.';

const C_LAST = [
  ['다음 테스트에서도 지금의 실력을 유지할 수 있도록 지켜보겠습니다.', '앞으로도 이 페이스를 잘 이어 가도록 응원하겠습니다.', '다음 범위도 지금처럼 꼼꼼하게 준비하면 좋겠습니다.', '좋은 습관이 계속 이어지도록 격려하겠습니다.', '다음 시험에서도 좋은 결과가 나오도록 함께하겠습니다.', '이 실력이 학교 시험까지 이어지도록 계속 살피겠습니다.'],
  ['작은 실수만 줄이면 다음에는 만점도 충분히 가능합니다.', '다음 테스트에서는 실수 없이 마무리하도록 지도하겠습니다.', '문제를 끝까지 꼼꼼히 확인하는 습관을 함께 기르겠습니다.', '지금처럼 꾸준히 하면 더 좋은 결과가 나올 것입니다.', '헷갈린 한두 문항만 확실히 하면 완벽해집니다.', '다음에는 만점을 목표로 함께 준비하겠습니다.'],
  ['틀린 개념을 오늘 다시 정리했으니 다음 테스트에서 확인하겠습니다.', '부족한 부분을 채우면 더 안정적인 점수가 나올 것입니다.', '다음 테스트 전까지 틀린 부분을 한 번 더 복습하도록 하겠습니다.', '지금처럼 꾸준히 하면서 약한 부분만 보완하면 됩니다.', '다음 시간에 오늘 틀린 개념을 다시 물어보며 확인하겠습니다.', '조금만 더 신경 쓰면 충분히 좋아질 수 있습니다.'],
  ['다음 테스트 전까지 약한 영역을 집중적으로 복습하겠습니다.', '헷갈린 개념을 확실히 정리하도록 다음 시간에도 확인하겠습니다.', '부족한 영역을 다시 다지면 점수가 금방 오를 것입니다.', '틀린 부분을 반복해서 익히도록 지도하겠습니다.', '다음 시간에 오늘 배운 보완 내용을 다시 점검하겠습니다.', '꾸준히 복습하면 다음에는 더 좋은 결과가 나올 것입니다.'],
  ['다음 수업 전까지 핵심 개념을 다시 외우도록 하겠습니다.', '복습량을 늘려 다음 테스트에서는 꼭 나아지도록 지도하겠습니다.', '다음 시간에 같은 개념을 다시 확인하며 부족한 부분을 채우겠습니다.', '개념 정리부터 차근차근 다시 하도록 이끌겠습니다.', '집에서도 오늘 틀린 내용을 한 번 더 복습할 수 있도록 격려 부탁드립니다.', '다음 테스트까지 꾸준히 확인하며 보완하겠습니다.'],
  ['기본 개념부터 다시 잡을 수 있도록 따로 시간을 내어 지도하겠습니다.', '다음 테스트 전까지 핵심 개념을 반복해서 익히도록 하겠습니다.', '복습 계획을 세워 꾸준히 확인하겠습니다.', '집에서도 복습 시간을 확보할 수 있도록 함께 살펴봐 주시면 감사하겠습니다.', '개념을 확실히 할 때까지 반복 확인하겠습니다.', '다음 시간에는 오늘 내용을 다시 점검하며 차근차근 채워 가겠습니다.'],
  ['추가 클리닉으로 기본 개념부터 다시 잡겠습니다.', '아이와 이야기한 뒤 보충 시간을 정해 함께 공부하겠습니다.', '기초부터 다시 정리할 수 있도록 별도로 지도하겠습니다.', '복습 습관부터 함께 만들어 가도록 하겠습니다.', '추가 등원으로 부족한 부분을 채울 수 있도록 일정을 잡아 보겠습니다.', '다음 테스트까지 개념을 확실히 할 수 있도록 집중해서 관리하겠습니다.'],
];

function reportComment(name, examName, g, stats, weak, info) {
  const rate = g.wrong.length / g.n * 100;
  const lv = level(rate);
  const seed = hangul(name) + '|' + examName;
  const v = { 시험: examName, 정답률: Math.round(g.score / g.n * 100) };
  const L = [fill(pick(C_FIRST[lv], seed + '|1'), v)];
  const good = stats.filter(function (s) { return s.wrong === 0; }).map(function (s) { return s.area; });
  if (good.length) L.push(fill(pick(C_GOOD, seed + '|2'), { 영역: good.join('·') }));
  if (lv === 0) {
    L.push(pick(C_KEEP, seed + '|3'));
  } else if (!weak[0]) {   // 문항정보(영역)가 없는 시험: 영역 이야기 없이 보완 방법만
    L.push(fill(pick(C_FIX, seed + '|5'), { 보완: FIX_DEFAULT }));
  } else {
    const w1 = weak[0];
    const concepts = w1.nums.map(function (k) { return info[k] && info[k].concept; }).filter(String);
    L.push(fill(pick(C_WEAK1, seed + '|3'), { 영역: w1.area, 번호: w1.nums.join(', '), 개념: uniq(concepts).slice(0, 2).join(', ') || w1.area }));
    if (weak[1]) L.push(fill(pick(C_WEAK2, seed + '|4'), { 영역: weak[1].area, 번호: weak[1].nums.join(', ') }));
    const fix = w1.nums.map(function (k) { return info[k] && info[k].fix; }).filter(String)[0] || FIX_DEFAULT;
    L.push(fill(pick(C_FIX, seed + '|5'), { 보완: fix }));
  }
  L.push(pick(C_LAST[lv], seed + '|6'));
  return L.join('\n');
}

function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }

/* ───────────── 학생 리포트 ───────────── */

function getReport(key) {
  key = String(key || '').trim();
  if (!key) return { ok: false };
  const st = table('학생명단').filter(function (r) { return String(r['리포트키']).trim() === key; })[0];
  if (!st) return { ok: false };
  const id = normId(st['학번']);
  const all = firstOnly(table('누적'));
  const mine = all.filter(function (r) { return normId(r['학번']) === id; })
    .sort(function (a, b) { return new Date(a['제출시각']) - new Date(b['제출시각']); });
  const exams = mine.map(function (r) {
    const cls = String(r['반']).trim(), name = String(r['시험명']).trim();
    const ox = String(r['채점']).split('').map(Number);
    const g = { n: ox.length, ox: ox, score: ox.filter(Boolean).length, wrong: [] };
    ox.forEach(function (o, i) { if (!o) g.wrong.push(i + 1); });
    const info = itemInfo(cls, name);
    const stats = areaStats(info, g);
    // 같은 반·같은 시험의 반 평균(영역별)
    const peers = all.filter(function (p) { return String(p['반']).trim() === cls && String(p['시험명']).trim() === name; });
    const avg = {};
    peers.forEach(function (p) {
      const pox = String(p['채점']).split('').map(Number);
      for (let i = 1; i <= pox.length; i++) {
        const a = (info[i] && info[i].area) || '';
        if (!a) continue;
        avg[a] = avg[a] || { t: 0, c: 0 };
        avg[a].t++; avg[a].c += pox[i - 1] ? 1 : 0;
      }
    });
    return {
      name: name, cls: cls, date: Utilities.formatDate(new Date(r['제출시각']), Session.getScriptTimeZone(), 'M/d'),
      score: pts(g.score, g.n), n: 100, ox: ox,
      areas: stats.map(function (s) {
        const rate = Math.round((s.total - s.wrong) / s.total * 100);
        const ar = avg[s.area] ? avg[s.area].c / avg[s.area].t * 100 : rate;
        return { area: s.area, rate: rate, need: rate < 60 && ar - rate > 10 };
      }),
      comment: reportComment(String(st['이름']), name, g, stats, weakAreas(stats), info),
    };
  });
  return { ok: true, name: String(st['이름']).trim(), cls: String(st['현재 반']).trim(), exams: exams };
}

/** 누적에서 같은 학번+반+시험은 처음 것만 */
function firstOnly(rows) {
  const seen = {};
  return rows.slice().sort(function (a, b) { return new Date(a['제출시각']) - new Date(b['제출시각']); })
    .filter(function (r) {
      const k = normId(r['학번']) + '|' + String(r['반']).trim() + '|' + String(r['시험명']).trim();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
}

/* ───────────── 메뉴 기능 ───────────── */

function showUrl() {
  const url = appUrl();
  const t = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;text-align:center">' +
    '<p>학생용 주소</p><p style="word-break:break-all;font-size:13px"><a href="' + url + '" target="_blank">' + url + '</a></p>' +
    '<div id="q" style="display:inline-block;margin-top:8px"></div>' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>' +
    '<script>new QRCode(document.getElementById("q"),{text:' + JSON.stringify(url) + ',width:220,height:220});</script></div>'
  ).setWidth(320).setHeight(380);
  SpreadsheetApp.getUi().showModalDialog(t, '학생용 주소·QR');
}

/** 이번 주(월요일 0시부터) 웹응답을 처음 제출만 골라 다시 채점하고 누적·결과(또는 결과보관)를 고친다 */
function regradeThisWeek() {
  const now = new Date();
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const subs = firstOnlySubs(table('웹응답')).filter(function (r) { return new Date(r['제출시각']) >= mon; });
  const roster = table('학생명단');
  let n = 0;
  subs.forEach(function (r) {
    const exam = findExam(r['반'], r['시험명']);
    if (!exam) return;
    const answers = String(r['답']).split('').map(function (c) { return CIRCLE.indexOf(c) + 1; });
    const g = grade(exam, answers);
    const id = normId(r['학번']);
    const s = roster.filter(function (x) { return normId(x['학번']) === id; })[0];
    const st = { id: id, name: String(r['이름']).trim(), cls: exam.cls, row: s ? s._row : null, key: s ? String(s['리포트키'] || '').trim() : '' };
    const key = st.key || (st.row ? newKeyFor(st.row) : '');
    const when = new Date(r['제출시각']);
    upsertHistory(when, st, exam, g, answers);
    const place = findResult(when, st.name, exam);
    writeResult(place ? place.tab : '결과', when, st, exam, g, key, place ? place.row : null);
    n++;
  });
  SpreadsheetApp.getUi().alert('이번 주 응답 ' + n + '개를 다시 채점했습니다.');
}

function firstOnlySubs(rows) {
  const seen = {};
  return rows.slice().sort(function (a, b) { return new Date(a['제출시각']) - new Date(b['제출시각']); })
    .filter(function (r) {
      const k = normId(r['학번']) + '|' + String(r['반']).trim() + '|' + String(r['시험명']).trim();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
}

function upsertHistory(when, st, exam, g, answers) {
  const rows = table('누적').filter(function (r) {
    return normId(r['학번']) === st.id && String(r['반']).trim() === exam.cls && String(r['시험명']).trim() === exam.name;
  });
  const vals = [when, st.id, st.name, exam.cls, exam.name, g.score, g.n, answerText(answers, g.n), g.ox.join(''), g.wrong.join(', ')];
  if (rows.length) {
    const sh = sheet('누적');
    sh.getRange(rows[0]._row, 9, 1, 2).setNumberFormat('@');
    sh.getRange(rows[0]._row, 1, 1, vals.length).setValues([vals]);
  } else {
    writeHistory(when, st, exam, g, answers);
  }
}

function findResult(when, name, exam) {
  const tabs = ['결과', '결과보관'];
  for (let t = 0; t < tabs.length; t++) {
    const hit = table(tabs[t]).filter(function (r) {
      return new Date(r['제출시각']).getTime() === when.getTime() && hangul(r['이름']) === hangul(name) &&
        String(r['반']).trim() === exam.cls && String(r['시험명']).trim() === exam.name;
    })[0];
    if (hit) return { tab: tabs[t], row: hit._row };
  }
  return null;
}

function makeReportKeys() {
  SpreadsheetApp.getUi().alert('리포트 키를 ' + makeReportKeysQuiet() + '개 만들었습니다.');
}

function newKeyFor(row) {   // 무작위 12자리
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let k = '';
  for (let i = 0; i < 12; i++) k += chars.charAt(Math.floor(Math.random() * chars.length));
  sheet('학생명단').getRange(row, 5).setValue(k);
  return k;
}

/** 누적에서 같은 학번+반+시험이 여러 줄이면 처음 것만 남긴다 */
function dedupeHistory() {
  const rows = table('누적');
  const keep = firstOnly(rows).map(function (r) { return r._row; });
  const del = rows.map(function (r) { return r._row; }).filter(function (x) { return keep.indexOf(x) < 0; }).sort(function (a, b) { return b - a; });
  const sh = sheet('누적');
  del.forEach(function (r) { sh.deleteRow(r); });
  SpreadsheetApp.getUi().alert('누적에서 중복 ' + del.length + '줄을 정리했습니다.');
}

function archiveNow() {
  const n = archiveOld();
  SpreadsheetApp.getUi().alert('지난 결과 ' + n + '줄을 결과보관으로 옮겼습니다.');
}

/** 오늘 0시 이전 결과를 결과보관으로 옮긴다(틀린 문항 칸은 글자 형식) */
function archiveOld() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const src = sheet('결과'), dst = sheet('결과보관');
  const last = src.getLastRow();
  if (last < 2) return 0;
  const width = HEAD['결과'].length;
  const vals = src.getRange(2, 1, last - 1, width).getValues();
  const move = [], rows = [];
  vals.forEach(function (v, i) {
    if (v[0] instanceof Date && v[0] < today) { v[5] = String(v[5]); move.push(v); rows.push(i + 2); }
  });
  if (!move.length) return 0;
  const start = dst.getLastRow() + 1;
  dst.getRange(start, 6, move.length, 1).setNumberFormat('@');
  dst.getRange(start, 1, move.length, width).setValues(move);
  rows.reverse().forEach(function (r) { src.deleteRow(r); });
  return move.length;
}

function enableDailyArchive() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'archiveOld') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('archiveOld').timeBased().everyDays(1).atHour(4).create();
  SpreadsheetApp.getUi().alert('매일 새벽 4시에 지난 결과를 결과보관으로 옮깁니다.');
}

/* ───────────── 시트 읽기 ───────────── */

function sheet(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('[' + name + '] 탭이 없습니다. 먼저 setupSheets를 실행해 주세요.');
  return sh;
}

/** 탭을 [{머리글: 값, _row: 줄 번호}] 로 읽는다 */
function table(name) {
  const sh = sheet(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = HEAD[name].length;
  const vals = sh.getRange(1, 1, last, width).getValues();
  const head = vals[0].map(String);
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i].every(function (x) { return x === ''; })) continue;
    const o = { _row: i + 1 };
    head.forEach(function (h, k) { o[h] = vals[i][k]; });
    out.push(o);
  }
  return out;
}


/* ───────────── 제출 현황 (2026-11-07) ───────────── */

/** [제출현황] 탭을 새로 만든다: [설정]의 모든 시험(지난 시험 포함)마다 그 반 학생의 제출 여부·점수·제출 시각.
 *  맨 위 요약(반·시험별 제출/미제출 수와 미제출 학생 이름), 아래 시험별 명단(안 한 학생이 위, 빨강). 선생님·체험 줄은 뺀다. */
function makeSubmitStatus() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('제출현황') || ss.insertSheet('제출현황');
  sh.clear();
  const tz = Session.getScriptTimeZone();
  const W = 8;
  const skip = function (cls) { return !cls || cls === ADMIN || cls === '체험'; };
  const roster = table('학생명단').filter(function (r) {
    return !skip(String(r['현재 반']).trim()) && normId(r['학번']);
  });
  const done = {};
  firstOnly(table('누적')).forEach(function (r) {
    done[normId(r['학번']) + '|' + String(r['반']).trim().replace(/\s+/g, '') + '|' + String(r['시험명']).trim().replace(/\s+/g, '')] = r;
  });
  const exams = table('설정').filter(function (r) {
    return String(r['시험명']).trim() && !skip(String(r['반']).trim());
  }).reverse();   // 아래(최근)에 등록한 시험이 위로

  const sum = [], det = [], detBg = [], bold = [];
  sum.push(['반', '시험명', '상태', '대상', '제출', '미제출', '제출률', '미제출 학생']);
  exams.forEach(function (e) {
    const cls = String(e['반']).trim(), name = String(e['시험명']).trim();
    const open = String(e['열기']).trim().toUpperCase() === 'O';
    const kids = roster.filter(function (s) { return same(s['현재 반'], cls); });
    const rows = kids.map(function (s) {
      const id = normId(s['학번']);
      const h = done[id + '|' + cls.replace(/\s+/g, '') + '|' + name.replace(/\s+/g, '')];
      return { id: id, name: String(s['이름']).trim(), h: h };
    });
    rows.sort(function (a, b) { return (a.h ? 1 : 0) - (b.h ? 1 : 0) || a.name.localeCompare(b.name, 'ko'); });
    const miss = rows.filter(function (x) { return !x.h; });
    const n = rows.length, m = miss.length;
    sum.push([cls, name, open ? '열림' : '닫힘', n, n - m, m, n ? Math.round((n - m) / n * 100) + '%' : '-',
              miss.map(function (x) { return x.name; }).join(', ')]);
    det.push(['■ ' + name + ' — ' + cls + ' (제출 ' + (n - m) + '/' + n + ', 미제출 ' + m + ')', '', '', '', '', '', '', '']);
    detBg.push(new Array(W).fill('#FBE7E8'));
    bold.push(det.length);
    det.push(['반', '시험명', '학번', '이름', '제출', '점수', '제출 시각', '']);
    detBg.push(new Array(W).fill('#eeeeee'));
    bold.push(det.length);
    rows.forEach(function (x) {
      const h = x.h;
      det.push([cls, name, x.id, x.name, h ? '✅ 함' : '❌ 안 함', h ? pts(h['점수'], h['문항수']) + '점 (' + h['점수'] + '/' + h['문항수'] + ')' : '',
                h ? Utilities.formatDate(new Date(h['제출시각']), tz, 'MM-dd HH:mm') : '', '']);
      detBg.push(new Array(W).fill(h ? '#E8F5E9' : '#FDECEC'));
    });
    det.push(new Array(W).fill(''));
    detBg.push(new Array(W).fill('#ffffff'));
  });

  sh.getRange(1, 1).setValue('제출 현황 (만든 시각 ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + ' · 메뉴 OMR 채점 → 제출 현황 만들기로 새로 고침)').setFontWeight('bold');
  sh.getRange(2, 1, sum.length, W).setValues(sum);
  sh.getRange(2, 1, 1, W).setFontWeight('bold').setBackground('#C8102E').setFontColor('#ffffff');
  if (sum.length > 1) {
    const mc = sh.getRange(3, 6, sum.length - 1, 1);
    mc.setFontColor('#C8102E').setFontWeight('bold');
  }
  const top = sum.length + 4;
  if (det.length) {
    sh.getRange(top, 3, det.length, 1).setNumberFormat('@');
    sh.getRange(top, 6, det.length, 1).setNumberFormat('@');
    sh.getRange(top, 1, det.length, W).setValues(det).setBackgrounds(detBg);
    bold.forEach(function (k) { sh.getRange(top + k - 1, 1, 1, W).setFontWeight('bold'); });
  }
  sh.setFrozenRows(2);
  sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 170); sh.setColumnWidth(8, 360);
  ss.setActiveSheet(sh);
  SpreadsheetApp.getUi().alert('제출 현황을 만들었습니다. 시험 ' + exams.length + '개, 학생 ' + roster.length + '명 기준입니다.');
}


/* ───────────── 점수 순위 (2026-11-07) ───────────── */

/** [점수순위] 탭을 새로 만든다.
 *  ① 반별 누적 순위: 지금까지 본 모든 시험의 평균 정답률이 높은 학생부터(응시 횟수·최근 점수 함께)
 *  ② 시험별 순위: 시험마다 점수가 높은 학생부터(같은 점수는 같은 등수, 먼저 낸 학생이 위). 1~3등은 금·은·동 색.
 *  선생님·체험 줄과 지금 [학생명단]에 없는(그만둔) 학생은 뺀다. */
function makeRanking() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('점수순위') || ss.insertSheet('점수순위');
  sh.clear();
  const tz = Session.getScriptTimeZone();
  const W = 7;
  const MEDAL = ['#FFE08A', '#E5E7EB', '#F5C9A0'];
  const skip = function (cls) { return !cls || cls === ADMIN || cls === '체험'; };
  const roster = {};
  table('학생명단').forEach(function (r) {
    const cls = String(r['현재 반']).trim();
    if (!skip(cls) && normId(r['학번'])) roster[normId(r['학번'])] = { name: String(r['이름']).trim(), cls: cls };
  });
  const hist = firstOnly(table('누적')).filter(function (r) {
    return roster[normId(r['학번'])] && !skip(String(r['반']).trim());
  });

  const out = [], bg = [], bold = [];
  const push = function (row, color, isBold) {
    while (row.length < W) row.push('');
    out.push(row); bg.push(new Array(W).fill(color || '#ffffff'));
    if (isBold) bold.push(out.length);
  };
  const rankOf = function (list, key) {   // 같은 값은 같은 등수
    let prev = null, rank = 0;
    list.forEach(function (x, i) { if (x[key] !== prev) { rank = i + 1; prev = x[key]; } x.rank = rank; });
  };

  // ① 반별 누적 순위
  push(['① 반별 누적 순위 (모든 시험 평균 점수가 높은 순, 100점 만점)'], '#C8102E', true);
  const classes = {};
  hist.forEach(function (r) {
    const id = normId(r['학번']), cls = String(r['반']).trim();
    const c = classes[cls] = classes[cls] || {};
    const s = c[id] = c[id] || { name: roster[id].name, n: 0, sum: 0, last: '', lastT: 0 };
    const rate = Number(r['점수']) / (Number(r['문항수']) || 1) * 100;
    s.n++; s.sum += rate;
    const t = new Date(r['제출시각']).getTime();
    if (t >= s.lastT) { s.lastT = t; s.last = pts(r['점수'], r['문항수']) + '점 (' + String(r['시험명']).trim() + ')'; }
  });
  Object.keys(classes).sort().forEach(function (cls) {
    const list = Object.keys(classes[cls]).map(function (id) {
      const s = classes[cls][id];
      return { id: id, name: s.name, n: s.n, avg: Math.round(s.sum / s.n * 10) / 10, last: s.last };
    }).sort(function (a, b) { return b.avg - a.avg || b.n - a.n || a.name.localeCompare(b.name, 'ko'); });
    rankOf(list, 'avg');
    push(['■ ' + cls + ' (' + list.length + '명)'], '#FBE7E8', true);
    push(['등수', '이름', '학번', '평균 점수(100점)', '응시 횟수', '최근 점수'], '#eeeeee', true);
    list.forEach(function (x) {
      push([x.rank, x.name, x.id, x.avg + '점', x.n + '회', x.last], x.rank <= 3 ? MEDAL[x.rank - 1] : '#ffffff');
    });
    push([]);
  });

  // ② 시험별 순위(최근 시험부터)
  push(['② 시험별 순위 (점수가 높은 순, 100점 만점)'], '#C8102E', true);
  const exams = table('설정').filter(function (r) {
    return String(r['시험명']).trim() && !skip(String(r['반']).trim());
  }).reverse();
  exams.forEach(function (e) {
    const cls = String(e['반']).trim(), name = String(e['시험명']).trim();
    const list = hist.filter(function (r) { return same(r['반'], cls) && same(r['시험명'], name); }).map(function (r) {
      return { id: normId(r['학번']), name: roster[normId(r['학번'])].name, score: pts(r['점수'], r['문항수']), right: Number(r['점수']), n: Number(r['문항수']),
               t: new Date(r['제출시각']).getTime(), wrong: String(r['틀린 문항'] || '') };
    }).sort(function (a, b) { return b.score - a.score || a.t - b.t; });
    rankOf(list, 'score');
    const avg = list.length ? Math.round(list.reduce(function (s, x) { return s + x.score; }, 0) / list.length * 10) / 10 : '-';
    push(['■ ' + name + ' — ' + cls + ' (응시 ' + list.length + '명, 평균 ' + avg + '점 / 100점)'], '#FBE7E8', true);
    push(['등수', '이름', '학번', '점수(100점)', '맞힌 개수', '제출 시각', '틀린 문항'], '#eeeeee', true);
    list.forEach(function (x) {
      push([x.rank, x.name, x.id, x.score + '점', x.right + '/' + x.n,
            Utilities.formatDate(new Date(x.t), tz, 'MM-dd HH:mm'), x.wrong], x.rank <= 3 ? MEDAL[x.rank - 1] : '#ffffff');
    });
    if (!list.length) push(['(아직 낸 학생이 없습니다)']);
    push([]);
  });

  sh.getRange(1, 1).setValue('점수 순위 (만든 시각 ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + ' · 메뉴 OMR 채점 → 점수 순위 만들기로 새로 고침)').setFontWeight('bold');
  if (out.length) {
    const rg = sh.getRange(3, 1, out.length, W);
    sh.getRange(3, 3, out.length, 1).setNumberFormat('@');
    sh.getRange(3, 4, out.length, 1).setNumberFormat('@');
    sh.getRange(3, 7, out.length, 1).setNumberFormat('@');
    rg.setValues(out).setBackgrounds(bg);
    bold.forEach(function (k) { sh.getRange(2 + k, 1, 1, W).setFontWeight('bold'); });
    out.forEach(function (row, i) { if (bg[i][0] === '#C8102E') sh.getRange(3 + i, 1, 1, W).setFontColor('#ffffff'); });
  }
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 60); sh.setColumnWidth(2, 110); sh.setColumnWidth(6, 230); sh.setColumnWidth(7, 160);
  ss.setActiveSheet(sh);
  SpreadsheetApp.getUi().alert('점수 순위를 만들었습니다. 학생 ' + Object.keys(roster).length + '명, 시험 ' + exams.length + '개 기준입니다.');
}


/* ───────────── 클리닉 신청 (2026-11-08) ───────────── */
// 수·목·금 15:00~21:30 시작(30분 간격, 22시에 끝남), 시간마다 정원 30명, 학생 한 주(월~일) 최대 3번, 신청·취소 자유
const CLINIC = {
  days: [3, 4, 5],            // 0=일 … 3=수, 4=목, 5=금
  first: 15 * 60, last: 21 * 60 + 30, step: 30,
  cap: 30, weekMax: 3, ahead: 14,   // 오늘부터 14일 안의 수·목·금
  schools: ['광명고', '광북고', '명문고', '진성고', '광문고'],
  teacher: TEACHER,
};
const CL_HEAD = ['신청시각', '학번', '이름', '학교', '학년', '날짜', '요일', '시간'];
const YO = '일월화수목금토';

function clinicSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('클리닉신청');
  if (!sh) {
    sh = ss.insertSheet('클리닉신청');
    sh.getRange(1, 1, 1, CL_HEAD.length).setValues([CL_HEAD]).setFontWeight('bold').setBackground('#eef3ee');
    sh.setFrozenRows(1);
    sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.getRange(1, 6, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.getRange(1, 8, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  return sh;
}

function clinicRows() {
  const sh = clinicSheet();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, CL_HEAD.length).getValues().map(function (v, i) {
    const d = v[5] instanceof Date ? Utilities.formatDate(v[5], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v[5]).trim();
    const t = v[7] instanceof Date ? Utilities.formatDate(v[7], Session.getScriptTimeZone(), 'HH:mm') : String(v[7]).trim();
    return { row: i + 2, id: normId(v[1]), name: String(v[2]).trim(), school: v[3], grade: v[4], date: d, time: t };
  });
}

function hhmm(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
function slotTimes() { const out = []; for (let m = CLINIC.first; m <= CLINIC.last; m += CLINIC.step) out.push(hhmm(m)); return out; }
function weekKey(dateStr) {   // 그 날짜가 든 주의 월요일
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function slotStart(dateStr, time) { return new Date(dateStr + 'T' + time + ':00'); }

function clinicDays() {
  const tz = Session.getScriptTimeZone(), now = new Date(), out = [];
  for (let k = 0; k < CLINIC.ahead; k++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
    if (CLINIC.days.indexOf(d.getDay()) < 0) continue;
    out.push({ date: Utilities.formatDate(d, tz, 'yyyy-MM-dd'), label: (d.getMonth() + 1) + '/' + d.getDate() + ' (' + YO.charAt(d.getDay()) + ')' });
  }
  return out;
}

/** 학생 화면: 날짜별 시간 칸(신청 인원·정원·내 신청), 내 기본 학교·학년 */
function clinicInfo(id, name) {
  const st = findStudent(id, name);
  if (!st) return { ok: false, msg: '로그인 정보가 맞지 않아요. 다시 들어와 주세요.' };
  const rows = clinicRows(), now = new Date();
  const cnt = {}, mine = {};
  rows.forEach(function (r) {
    const k = r.date + ' ' + r.time;
    cnt[k] = (cnt[k] || 0) + 1;
    if (r.id === st.id) mine[k] = r;
  });
  const days = clinicDays().map(function (d) {
    return { date: d.date, label: d.label, slots: slotTimes().map(function (t) {
      const k = d.date + ' ' + t;
      return { t: t, n: cnt[k] || 0, cap: CLINIC.cap, mine: !!mine[k], past: slotStart(d.date, t) <= now };
    }) };
  });
  const weeks = {};
  Object.keys(mine).forEach(function (k) { const w = weekKey(k.slice(0, 10)); weeks[w] = (weeks[w] || 0) + 1; });
  const m = String(st.cls).match(/^(.+?고)\s*([123])학년/);
  const last = Object.keys(mine).map(function (k) { return mine[k]; }).pop();
  return { ok: true, admin: st.cls === ADMIN, teacher: CLINIC.teacher, schools: CLINIC.schools, cap: CLINIC.cap, weekMax: CLINIC.weekMax,
           school: last ? String(last.school) : (m ? m[1].replace('광명북고', '광북고') : ''), grade: last ? String(last.grade) : (m ? m[2] : ''),
           days: days, weeks: weeks,
           mine: Object.keys(mine).sort().map(function (k) { return { date: mine[k].date, time: mine[k].time }; }) };
}

/** 신청 */
function clinicBook(id, name, school, grade, date, time) {
  const st = findStudent(id, name);
  if (!st) return { ok: false, msg: '로그인 정보가 맞지 않아요.' };
  if (st.cls === ADMIN) return { ok: false, msg: '선생님 계정은 보기만 할 수 있어요.' };
  if (CLINIC.schools.indexOf(school) < 0) return { ok: false, msg: '학교를 골라 주세요.' };
  if (['1', '2', '3'].indexOf(String(grade)) < 0) return { ok: false, msg: '학년을 골라 주세요.' };
  if (!clinicDays().some(function (d) { return d.date === date; }) || slotTimes().indexOf(time) < 0) return { ok: false, msg: '신청할 수 없는 시간이에요.' };
  if (slotStart(date, time) <= new Date()) return { ok: false, msg: '이미 지난 시간이에요.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rows = clinicRows();
    if (rows.some(function (r) { return r.id === st.id && r.date === date && r.time === time; })) return { ok: false, msg: '이미 신청한 시간이에요.' };
    const n = rows.filter(function (r) { return r.date === date && r.time === time; }).length;
    if (n >= CLINIC.cap) return { ok: false, msg: '이 시간은 정원(' + CLINIC.cap + '명)이 다 찼어요.' };
    const wk = weekKey(date);
    const used = rows.filter(function (r) { return r.id === st.id && weekKey(r.date) === wk; }).length;
    if (used >= CLINIC.weekMax) return { ok: false, msg: '한 주에 ' + CLINIC.weekMax + '번까지 신청할 수 있어요. 다른 시간을 취소한 뒤 신청해 주세요.' };
    const d = new Date(date + 'T00:00:00');
    const sh = clinicSheet();
    sh.appendRow([new Date(), st.id, st.name, school, String(grade), date, YO.charAt(d.getDay()), time]);
    sortClinic(sh);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** 취소 */
function clinicCancel(id, name, date, time) {
  const st = findStudent(id, name);
  if (!st) return { ok: false, msg: '로그인 정보가 맞지 않아요.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const r = clinicRows().filter(function (x) { return x.id === st.id && x.date === date && x.time === time; })[0];
    if (!r) return { ok: false, msg: '신청 기록이 없어요.' };
    if (slotStart(date, time) <= new Date()) return { ok: false, msg: '이미 지난 시간은 취소할 수 없어요.' };
    clinicSheet().deleteRow(r.row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function sortClinic(sh) {
  const last = sh.getLastRow();
  if (last > 2) sh.getRange(2, 1, last - 1, CL_HEAD.length).sort([{ column: 6, ascending: true }, { column: 8, ascending: true }, { column: 3, ascending: true }]);
}

/** 메뉴: [클리닉명단] 탭에 날짜·시간별 인원과 이름을 정리 */
function makeClinicList() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('클리닉명단') || ss.insertSheet('클리닉명단');
  sh.clear();
  const rows = clinicRows().filter(function (r) { return r.date >= Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); });
  const g = {};
  rows.forEach(function (r) { const k = r.date + ' ' + r.time; (g[k] = g[k] || []).push(r); });
  const out = [['날짜', '요일', '시간', '인원', '학생(학교·학년)']];
  Object.keys(g).sort().forEach(function (k) {
    const L = g[k], d = new Date(k.slice(0, 10) + 'T00:00:00');
    out.push([k.slice(0, 10), YO.charAt(d.getDay()), k.slice(11), L.length + '/' + CLINIC.cap,
              L.map(function (r) { return r.name + '(' + r.school + r.grade + ')'; }).join(', ')]);
  });
  sh.getRange(1, 1, out.length, 5).setNumberFormat('@').setValues(out);
  sh.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#C8102E').setFontColor('#ffffff');
  sh.setFrozenRows(1); sh.setColumnWidth(5, 600);
  ss.setActiveSheet(sh);
  SpreadsheetApp.getUi().alert('오늘부터의 클리닉 신청 ' + rows.length + '건을 정리했습니다.');
}
