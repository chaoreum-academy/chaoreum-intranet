'use client';
import { useRef, useState, useTransition } from 'react';
import { importKeyFile, type KeyImport } from './actions';

/**
 * 시험지 파일(엑셀·PDF)을 올리면 같은 양식 안의 정답·문항 수·선택지 수·문항정보 칸을 채운다.
 * 저장은 하지 않는다 — 강사가 채워진 값을 확인하고 원래 버튼으로 저장.
 */
export function KeyFileImport() {
  const box = useRef<HTMLDivElement>(null);
  const [res, setRes] = useState<KeyImport | null>(null);
  const [pending, start] = useTransition();

  const pick = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set('file', file);
    start(async () => {
      const r = await importKeyFile(fd);
      setRes(r);
      if (!r.ok) return;
      const form = box.current?.closest('form');
      if (!form) return;
      const set = (name: string, value: string) => {
        const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (el) el.value = value;
      };
      set('answers', r.answers.replace(/\?/g, '')); // 빈 정답(?)은 넣지 않아 저장 시 개수 오류로 걸리게 한다
      set('n_items', String(r.n));
      set('choices', String(r.choices));
      if (r.items) set('items', r.items);
    });
  };

  return (
    <div ref={box} className="keyfile">
      <label className="btn ghost" aria-disabled={pending}>
        {pending ? '파일 읽는 중… (PDF는 30초 정도)' : '시험지 파일에서 정답 불러오기 (엑셀·PDF)'}
        <input type="file" accept=".xlsx,.xls,.csv,.pdf,application/pdf" hidden disabled={pending}
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {res && !res.ok && <div className="flash err" style={{ marginTop: 8 }}>{res.msg}</div>}
      {res?.ok && (
        <div className={'flash ' + (res.missing.length ? 'err' : 'info')} style={{ marginTop: 8 }}>
          {res.n}문항 · {res.choices}지선다 정답을 채웠습니다 ({res.via === 'excel' ? '엑셀 정답표' : 'AI 판독'}). 아래 칸을 확인한 뒤 저장하세요.
          {!!res.missing.length && `\n정답을 못 찾은 문항: ${res.missing.join(', ')}번 → 정답 칸에 직접 넣어 주세요.`}
          {res.notes.length > 0 && '\n' + res.notes.map((x) => '· ' + x).join('\n')}
        </div>
      )}
    </div>
  );
}
