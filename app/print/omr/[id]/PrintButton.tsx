'use client';

export function PrintButton() {
  return <button className="btn" onClick={() => window.print()}>인쇄하기</button>;
}
