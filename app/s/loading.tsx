export default function Loading() {
  return (
    <div className="loading" aria-busy="true" aria-label="불러오는 중" style={{ paddingTop: 8 }}>
      <div className="loading-note"><span className="spin" />불러오는 중…</div>
      <div className="skel" style={{ height: 44 }} />
      <div className="skel" style={{ height: 120 }} />
      <div className="skel" style={{ height: 120 }} />
    </div>
  );
}
