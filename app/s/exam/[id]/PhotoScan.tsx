'use client';
import { useState } from 'react';
import { sheetLayout } from '@/lib/omr/sheet';
import { rectify, scanSheet, toGray, type Flag } from '@/lib/omr/scan';

const MAX_SIDE = 1600; // 인식에 쓰는 사진 크기 (긴 변 픽셀). 이보다 크면 줄여서 빠르게

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // 휴대폰 사진의 회전 정보(EXIF)는 브라우저가 적용
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** 답안지 사진 → 고른 번호. 결과는 onResult로 넘겨 화면 답안지에 채우고, 학생이 확인 후 제출 */
export function PhotoScan({ examId, n, choices, onResult }: {
  examId: string; n: number; choices: number;
  onResult: (answers: number[], flags: Flag[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'info' | 'err'; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const layout = sheetLayout(n, choices);
  if (!layout) return null;

  const run = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setMsg(null); setPreview(null);
    try {
      const img = await loadImage(file);
      const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      await new Promise((r) => setTimeout(r, 30)); // '읽는 중' 표시가 먼저 보이게
      const g = toGray(ctx.getImageData(0, 0, w, h).data, w, h);
      const r = scanSheet(g, layout, examId);
      if (!r.ok) { setMsg({ kind: 'err', text: r.msg }); return; }

      onResult(r.answers, r.flags);
      const check = r.flags.map((f, i) => (f === 'unsure' || f === 'multi' ? i + 1 : 0)).filter(Boolean);
      const blank = r.flags.filter((f) => f === 'blank').length;
      setMsg({
        kind: check.length ? 'err' : 'info',
        text: `사진에서 ${r.answers.filter(Boolean).length}문항을 읽었어요.` +
          (check.length ? `\n${check.join(', ')}번은 흐리거나 두 개 이상 칠해져 있어요. 아래에서 직접 골라 주세요.` : '') +
          (blank ? `\n빈 문항 ${blank}개` : '') +
          '\n아래 답안지가 내 답과 같은지 확인하고 제출하세요.',
      });

      // 확인용 미리보기: 반듯하게 편 답안지 위에 읽은 답(초록)·확인 필요(주황) 표시
      const S = 2;
      const flat = rectify(g, r.toImage, S);
      const pc = document.createElement('canvas');
      pc.width = flat.w; pc.height = flat.h;
      const p = pc.getContext('2d')!;
      p.putImageData(new ImageData(flat.rgba, flat.w, flat.h), 0, 0);
      p.lineWidth = 2.5;
      layout.bubbles.forEach((row, q) => {
        const a = r.answers[q];
        if (a) { p.strokeStyle = '#12a150'; p.beginPath(); p.arc(row[a - 1].x * S, row[a - 1].y * S, layout.r * S * 1.5, 0, Math.PI * 2); p.stroke(); }
        if (r.flags[q] === 'unsure' || r.flags[q] === 'multi') {
          const first = row[0], last = row[row.length - 1];
          p.strokeStyle = '#e07b00';
          p.strokeRect((first.x - layout.r * 2) * S, (first.y - layout.r * 1.6) * S, (last.x - first.x + layout.r * 4) * S, layout.r * 3.2 * S);
        }
      });
      setPreview(pc.toDataURL('image/jpeg', 0.8));
    } catch (e) {
      console.error(e);
      setMsg({ kind: 'err', text: '사진을 열지 못했어요. 다른 사진으로 다시 해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scanbox">
      <label className="btn ghost scanbtn" aria-disabled={busy}>
        {busy ? '사진 읽는 중…' : '📷 종이 OMR 답안지 사진으로 입력'}
        <input type="file" accept="image/*" hidden disabled={busy}
          onChange={(e) => { run(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <div className="muted small">종이를 평평하게 놓고, 네 모서리 검은 네모가 모두 나오게 위에서 찍어 주세요.</div>
      {msg && <div className={'flash ' + msg.kind} style={{ marginTop: 8, marginBottom: 0 }}>{msg.text}</div>}
      {preview && (
        <details style={{ marginTop: 8 }}>
          <summary className="small">사진에서 읽은 모습 보기</summary>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="인식한 답안지" style={{ width: '100%', marginTop: 6, border: '1px solid var(--line)', borderRadius: 6 }} />
        </details>
      )}
    </div>
  );
}
