import Link from 'next/link';
import { Receipt, Wallet, AlertCircle, CreditCard } from 'lucide-react';
import { requireRole, BRANCH_ADMIN } from '@/lib/auth';
import { branchScope } from '@/lib/branch';
import { Flash } from '@/components/Flash';
import { SubmitButton } from '@/components/SubmitButton';
import { seoulToday } from '@/lib/schedule';
import { setFees, generateMonthly, addBill, updateBill, recordPayment, deletePayment } from './actions';

const METHOD: Record<string, string> = { card: '카드', cash: '현금', transfer: '계좌이체', online: '온라인 결제' };
const won = (n: number) => n.toLocaleString('ko-KR') + '원';

type SP = { month?: string; status?: string; class?: string; ok?: string; err?: string };

export default async function PaymentsPage({ searchParams }: { searchParams: SP }) {
  const me = await requireRole(BRANCH_ADMIN);
  const scope = await branchScope(me);
  const b = scope.current;
  const today = seoulToday().ymd;
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? searchParams.month! : today.slice(0, 7);
  const status = searchParams.status ?? 'all';
  const qs = new URLSearchParams({ month, status, ...(searchParams.class ? { class: searchParams.class } : {}) });
  const self = '/staff/payments?' + qs.toString();

  let cq = me.sb.from('classes').select('id, name, monthly_fee, branches(name)').eq('active', true).order('name');
  let bq = me.sb.from('bills')
    .select('id, student_id, class_id, month, title, amount, discount, due_date, memo, cancelled, students!inner(id, name, student_no, branch_id), classes(name), payments(id, amount, method, paid_at, memo, created_at)')
    .eq('month', month).order('created_at');
  let sq = me.sb.from('students').select('id, name, student_no').eq('status', 'active').order('name');
  if (b) { cq = cq.eq('branch_id', b); bq = bq.eq('students.branch_id', b); sq = sq.eq('branch_id', b); }
  if (searchParams.class) bq = bq.eq('class_id', searchParams.class);
  const [{ data: classes }, { data: bills, error: billErr }, { data: students }] = await Promise.all([cq, bq, sq]);

  const rows = (bills ?? []).map((x: any) => {
    const due = x.amount - x.discount;
    const paid = (x.payments ?? []).reduce((s: number, p: any) => s + p.amount, 0);
    const balance = due - paid;
    const st = x.cancelled ? 'cancelled' : balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    return { ...x, due, paid, balance, st, overdue: !x.cancelled && balance > 0 && x.due_date && x.due_date < today };
  }).sort((a: any, z: any) => a.students.name.localeCompare(z.students.name, 'ko'));
  const live = rows.filter((r) => r.st !== 'cancelled');
  const shown = rows.filter((r) => status === 'all' ? true : status === 'unpaid' ? r.st === 'unpaid' || r.st === 'partial' : status === 'paid' ? r.st === 'paid' : r.st === 'cancelled');
  const sum = (k: 'due' | 'paid' | 'balance') => live.reduce((s, r) => s + (k === 'balance' ? Math.max(0, r.balance) : r[k]), 0);
  const unpaidCount = live.filter((r) => r.balance > 0).length;
  const overdue = live.filter((r) => r.overdue).length;
  const feeClasses = (classes ?? []).filter((c: any) => c.monthly_fee !== null);

  return (
    <>
      <div className="head">
        <div><h1>수납·결제</h1><div className="sub">월별 수강료 청구와 수납 기록 · {b ? scope.branches.find((x) => x.id === b)?.name : '전체 지점'}</div></div>
        <form className="row" method="get">
          <input type="month" name="month" defaultValue={month} aria-label="청구 월" />
          <select name="status" defaultValue={status} aria-label="상태">
            <option value="all">전체</option><option value="unpaid">미납·부분납</option><option value="paid">완납</option><option value="cancelled">취소</option>
          </select>
          <select name="class" defaultValue={searchParams.class ?? ''} aria-label="반">
            <option value="">전체 반</option>
            {(classes ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.branches?.name} {c.name}</option>)}
          </select>
          <button className="btn ghost">보기</button>
        </form>
      </div>
      <Flash sp={searchParams} />
      <div className="flash info">
        <b>온라인 결제(PG) 연동 준비 중</b> — 카드·간편결제로 학부모가 앱에서 바로 내는 기능은 PG사 계약 후 연결됩니다.
        {'\n'}지금은 현장 카드 단말기·현금·계좌이체로 받은 수납을 여기에 기록해 주세요. 기록은 그대로 이어서 쓰입니다.
      </div>
      {billErr && <div className="flash err">청구서를 불러오지 못했습니다: {billErr.message}{'\n'}DB에 supabase/migrations/0006_billing.sql 을 실행했는지 확인하세요.</div>}

      <div className="stats">
        <div className="stat"><span className="ic"><Receipt size={19} /></span><div><span>{Number(month.slice(5))}월 청구액</span><b>{won(sum('due'))}</b><em>청구서 {live.length}건</em></div></div>
        <div className="stat"><span className="ic good"><Wallet size={19} /></span><div><span>수납액</span><b>{won(sum('paid'))}</b><em>{sum('due') ? Math.round((sum('paid') / sum('due')) * 100) : 0}% 수납</em></div></div>
        <div className="stat"><span className="ic bad"><AlertCircle size={19} /></span><div><span>미수금</span><b style={{ color: sum('balance') ? 'var(--bad)' : undefined }}>{won(sum('balance'))}</b><em>미납 {unpaidCount}명{overdue ? ` · 납기 지남 ${overdue}` : ''}</em></div></div>
        <div className="stat"><span className="ic"><CreditCard size={19} /></span><div><span>온라인 결제</span><b style={{ fontSize: 17 }}>연동 전</b><em>PG사 계약 후 사용</em></div></div>
      </div>

      <div className="panel">
        <div className="phead"><h2>{month} 청구서</h2></div>
        {!shown.length ? (
          <div className="empty">{rows.length ? '조건에 맞는 청구서가 없습니다.' : '이 달 청구서가 없습니다. 아래 「청구서 만들기」에서 만드세요.'}</div>
        ) : (
          <div className="scroll">
            <table className="t">
              <thead><tr><th>학생</th><th>항목</th><th className="r">청구</th><th className="r">납부</th><th className="r">잔액</th><th>상태</th><th>납기</th><th>수납</th></tr></thead>
              <tbody>
                {shown.map((r: any) => (
                  <tr key={r.id} style={r.st === 'cancelled' ? { opacity: 0.55 } : undefined}>
                    <td><Link href={`/staff/students/${r.students.id}`}><b>{r.students.name}</b></Link><div className="muted small num">{r.students.student_no}</div></td>
                    <td className="small">{r.title}{r.memo && <div className="muted">{r.memo}</div>}</td>
                    <td className="r num">{won(r.due)}{r.discount > 0 && <div className="muted small">할인 {won(r.discount)}</div>}</td>
                    <td className="r num">{won(r.paid)}</td>
                    <td className="r num">{r.st === 'cancelled' ? '-' : <b style={{ color: r.balance > 0 ? 'var(--bad)' : undefined }}>{won(Math.max(0, r.balance))}</b>}{r.balance < 0 && <div className="small" style={{ color: 'var(--warn)' }}>초과 {won(-r.balance)}</div>}</td>
                    <td>{{ paid: <span className="badge good">완납</span>, partial: <span className="badge warn">부분납</span>, unpaid: <span className="badge bad">미납</span>, cancelled: <span className="badge">취소</span> }[r.st as string]}</td>
                    <td className="num small">{r.due_date ? r.due_date.slice(5).replace('-', '/') : '-'}{r.overdue && <div className="small" style={{ color: 'var(--bad)' }}>지남</div>}</td>
                    <td style={{ minWidth: 150 }}>
                      <details>
                        <summary className="small">{r.st === 'cancelled' ? '기록 보기' : r.balance > 0 ? '수납 입력' : '내역 · 환불'}</summary>
                        <div className="paybox">
                          {(r.payments ?? []).map((p: any) => (
                            <form key={p.id} action={deletePayment} className="payline">
                              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="ret" value={self} />
                              <span className="num small">{p.paid_at.slice(5).replace('-', '/')} {METHOD[p.method]} <b style={{ color: p.amount < 0 ? 'var(--warn)' : undefined }}>{p.amount < 0 ? '환불 ' : ''}{won(Math.abs(p.amount))}</b>{p.memo ? ` · ${p.memo}` : ''}</span>
                              <button className="btn ghost sm" title="잘못 입력한 기록 지우기">지우기</button>
                            </form>
                          ))}
                          {r.st !== 'cancelled' && (
                            <form action={recordPayment} className="payform">
                              <input type="hidden" name="bill_id" value={r.id} /><input type="hidden" name="ret" value={self} />
                              <select name="kind" defaultValue={r.balance > 0 ? 'pay' : 'refund'} aria-label="구분"><option value="pay">수납</option><option value="refund">환불</option></select>
                              <input name="amount" inputMode="numeric" defaultValue={r.balance > 0 ? r.balance : ''} placeholder="금액" aria-label="금액" size={9} />
                              <select name="method" defaultValue="card" aria-label="결제 수단"><option value="card">카드</option><option value="cash">현금</option><option value="transfer">계좌이체</option></select>
                              <input type="date" name="paid_at" defaultValue={today} aria-label="수납일" />
                              <input name="memo" placeholder="메모 (승인번호 등)" aria-label="메모" />
                              <SubmitButton pendingText="저장 중…">기록</SubmitButton>
                            </form>
                          )}
                          <form action={updateBill} className="payline">
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="ret" value={self} />
                            <input type="hidden" name="cancelled" value={String(!r.cancelled)} />
                            <button className="btn ghost sm">{r.cancelled ? '청구 되살리기' : '청구 취소'}</button>
                          </form>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="panel" open={!rows.length}>
        <summary>청구서 만들기</summary>
        <h3 style={{ marginTop: 14 }}>반 수강료 일괄 청구</h3>
        <p className="muted small">고른 달에 다니는 학생(재원생)에게 반별 월 수강료로 청구서를 만듭니다. 이미 만든 청구서는 건너뛰므로 여러 번 눌러도 중복되지 않습니다.</p>
        {!feeClasses.length ? <p className="muted">수강료가 입력된 반이 없습니다. 아래 「반별 월 수강료」를 먼저 입력하세요.</p> : (
          <form action={generateMonthly}>
            <input type="hidden" name="ret" value={self} />
            <div className="row">
              <label className="field">청구 월<input type="month" name="month" defaultValue={month} required /></label>
              <label className="field">납기일 (선택)<input type="date" name="due_date" /></label>
            </div>
            <div className="checks">
              {feeClasses.map((c: any) => (
                <label key={c.id}><input type="checkbox" name="class_id" value={c.id} defaultChecked /> {c.branches?.name} {c.name} <span className="muted num">{won(c.monthly_fee)}</span></label>
              ))}
            </div>
            <SubmitButton pendingText="만드는 중…">청구서 만들기</SubmitButton>
          </form>
        )}

        <h3 style={{ marginTop: 22 }}>개별 청구 (교재비·특강비 등)</h3>
        <form action={addBill}>
          <input type="hidden" name="ret" value={self} />
          <div className="row">
            <label className="field">학생
              <select name="student_id" required defaultValue="">
                <option value="" disabled>학생 선택</option>
                {(students ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name} {s.student_no ?? ''}</option>)}
              </select>
            </label>
            <label className="field">청구 월<input type="month" name="month" defaultValue={month} required /></label>
            <label className="field">항목<input name="title" required placeholder="11월 교재비" size={14} /></label>
            <label className="field">금액<input name="amount" required inputMode="numeric" placeholder="30000" size={9} /></label>
            <label className="field">할인<input name="discount" inputMode="numeric" placeholder="0" size={7} /></label>
            <label className="field">납기일<input type="date" name="due_date" /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="field" style={{ flex: 1 }}>메모<input name="memo" placeholder="형제 할인 등" /></label>
            <SubmitButton pendingText="저장 중…">청구 추가</SubmitButton>
          </div>
        </form>
      </details>

      <details className="panel">
        <summary>반별 월 수강료</summary>
        <p className="muted small" style={{ marginTop: 10 }}>비워 두면 일괄 청구에서 빠집니다. 수강료 변경은 지점 실장 이상만 저장됩니다.</p>
        <form action={setFees}>
          <input type="hidden" name="ret" value={self} />
          <table className="t">
            <thead><tr><th>지점</th><th>반</th><th className="r">월 수강료 (원)</th></tr></thead>
            <tbody>
              {(classes ?? []).map((c: any) => (
                <tr key={c.id}>
                  <td className="small">{c.branches?.name}</td>
                  <td>{c.name}</td>
                  <td className="r"><input name={`fee_${c.id}`} defaultValue={c.monthly_fee ?? ''} inputMode="numeric" size={10} style={{ textAlign: 'right' }} aria-label={`${c.name} 월 수강료`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}><SubmitButton pendingText="저장 중…">수강료 저장</SubmitButton></div>
        </form>
      </details>
    </>
  );
}
