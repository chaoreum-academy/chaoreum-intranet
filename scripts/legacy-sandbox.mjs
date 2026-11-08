// 기존 Apps Script(OMR 채점기)를 Node에서 그대로 실행하기 위한 샌드박스.
// 구글 서비스는 쓰지 않는 순수 계산 함수(채점·통계·코멘트·문자)만 호출합니다.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadLegacy() {
  const src = fs.readFileSync(path.join(here, '..', 'legacy', 'omr', 'Code.gs'), 'utf8');
  const ctx = { console };
  vm.createContext(ctx);
  // const 상수는 전역 객체에 안 붙으므로 끝에 꺼내는 코드를 덧붙인다
  vm.runInContext(
    src + '\n;globalThis.__T = { C_FIRST, C_GOOD, C_KEEP, C_WEAK1, C_WEAK2, C_FIX, C_LAST, CLOSING, FIX_DEFAULT, TEACHER };',
    ctx
  );
  ctx.appUrl = () => 'https://example.app/r';
  return ctx;
}
