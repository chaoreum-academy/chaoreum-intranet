import { parseClassCell, matchBranch } from '../lib/importDetect';
const B = [{ id: 'c1', name: '철산1관' }, { id: 'c2', name: '철산2관' }, { id: 'h', name: '하안관' }, { id: 'n', name: '논술관' }, { id: 's', name: '사회과학관' }];
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const cases: [string, unknown][] = [
  ['[철산2] [토 10시] 광북1A', [{ branchToken: '철산2', schedule: '토 10시', name: '광북1A' }]],
  ['[철산2] 광북1A', [{ branchToken: '철산2', schedule: '', name: '광북1A' }]],
  ['[하안] [월수 7시] 명문2B, [철산1] [일 2시] 진성1C', [{ branchToken: '하안', schedule: '월수 7시', name: '명문2B' }, { branchToken: '철산1', schedule: '일 2시', name: '진성1C' }]],
  ['[철산2] [토 10시] 광북1A [철산2] [일 6시] 광북1B', [{ branchToken: '철산2', schedule: '토 10시', name: '광북1A' }, { branchToken: '철산2', schedule: '일 6시', name: '광북1B' }]],
  ['광북1A', [{ branchToken: null, schedule: '', name: '광북1A' }]],
  ['[사회] 고3 정시', [{ branchToken: '사회', schedule: '', name: '고3 정시' }]],
];
let bad = 0;
cases.forEach(([inp, want]) => { const got = parseClassCell(inp); if (!eq(got, want)) { bad++; console.log('FAIL', inp, JSON.stringify(got)); } });
const bm: [string | null, string | null][] = [['철산2', 'c2'], ['철산2관', 'c2'], ['하안', 'h'], ['사회', 's'], ['논술', 'n'], ['철산', null], ['광명', null], [null, null]];
bm.forEach(([t, w]) => { const g = matchBranch(t, B); if (g !== w) { bad++; console.log('FAIL 지점', t, g); } });
console.log(`반 ${cases.length}건 · 지점 ${bm.length}건 중 실패 ${bad}`);
process.exit(bad ? 1 : 0);
