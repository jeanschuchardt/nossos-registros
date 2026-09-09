export function ProgressBar({ value }: { value: number }) {
  const safe = Math.min(100, Math.max(0, value));
  return (
    <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safe)}>
      <div className="progress-fill" style={{ width: `${safe}%` }} />
    </div>
  );
}
