'use client';
import { useFormStatus } from 'react-dom';

/** 누르면 바로 '처리 중…'으로 바뀌고 다시 못 누르게 막는 버튼 (느린 화면에서 두 번 누르기 방지) */
export function SubmitButton({ children, className = 'btn', pendingText = '처리 중…', name, value }: {
  children: React.ReactNode; className?: string; pendingText?: string; name?: string; value?: string;
}) {
  const { pending, data } = useFormStatus();
  const mine = !name || !pending || data?.get(name) === value;
  return (
    <button type="submit" className={className} name={name} value={value} disabled={pending} aria-busy={pending && mine}>
      {pending && mine ? pendingText : children}
    </button>
  );
}
