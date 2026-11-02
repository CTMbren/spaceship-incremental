/** Compact number for counters: 999, 1.2k, 15k, 1.3M. Pure. */
export function fmtNum(n: number): string {
  const v = Math.floor(n);
  if (v < 1000) return String(v);
  const unit = (x: number, suffix: string): string => {
    const t = x < 10 ? Math.floor(x * 10) / 10 : Math.floor(x);
    return `${t % 1 === 0 ? t.toFixed(0) : t.toFixed(1)}${suffix}`;
  };
  return v < 1_000_000 ? unit(v / 1000, 'k') : unit(v / 1_000_000, 'M');
}

/** A per-unit price: whole numbers as they are, others to one decimal (9.6). Pure. */
export const fmtPrice = (n: number): string => (Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(1));

/** "v0.6.1 (e2c9fbb, Oct 28)": the build line shown in the menu. Pure; the scene passes the build constants. */
export function formatVersion(version: string, sha: string, isoDate: string): string {
  const d = new Date(isoDate);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = Number.isNaN(d.getTime()) ? '' : `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const tail = [sha && sha !== 'dev' ? sha : '', date].filter(Boolean).join(', ');
  return tail ? `v${version} (${tail})` : `v${version}`;
}
