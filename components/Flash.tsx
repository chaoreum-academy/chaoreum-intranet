export function Flash({ sp }: { sp: { ok?: string; err?: string } }) {
  if (sp.err) return <div className="flash err" role="alert">{sp.err}</div>;
  if (sp.ok) return <div className="flash ok" role="status">{sp.ok}</div>;
  return null;
}
