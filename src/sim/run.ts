import { fmt, runSim, type Policy } from './bot';

declare const process: { argv: string[] };

const minutes = Number(process.argv[2] ?? 30);
const policies: Policy[] = ['engaged', 'casual', 'idle'];
console.log(`Pacing, ${minutes} min of play on the real core rules (m:ss when reached)\n`);
console.log('policy    smelter repair  beam2   t4     t5     t6     t7     t8     t9     tiles  credits  income/min  smelters smashers');
for (const p of policies) {
  const r = runSim(p, minutes);
  const m = r.milestones;
  const row = [m.smelter, m.repaired, m.beam2, m.tiles[4], m.tiles[5], m.tiles[6], m.tiles[7], m.tiles[8], m.tiles[9]].map(fmt).join(' ');
  console.log(`${p.padEnd(9)}${row}  ${String(r.final.ship.ownedCells.length).padStart(4)}  ${String(Math.round(r.final.credits)).padStart(7)}  ${String(Math.round(r.incomePerMin)).padStart(5)}  ${String(r.final.smelters.length).padStart(8)} ${String(r.final.smashers.length).padStart(8)}`);
}
