/** 메뉴를 누르는 즉시 보이는 화면 (데이터가 오는 동안) */
export default function Loading() {
  return (
    <div className="loading" aria-busy="true" aria-label="불러오는 중">
      <div className="loading-note"><span className="spin" />불러오는 중…</div>
      <div className="skel" style={{ height: 30, width: 220 }} />
      <div className="stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 84 }} />)}</div>
      <div className="skel" style={{ height: 320 }} />
    </div>
  );
}
