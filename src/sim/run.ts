import { fmt, runSim, type Policy } from './bot';

declare const process: { argv: string[] };

const minutes = Number(process.argv[2] ?? 30);
const policies: Policy[] = ['engaged', 'casual', 'idle'];
console.log(`Pacing, ${minutes} min of play on the real core rules (m:ss when reached)\n`);
console.log('policy    smelter repair  solar  beam2   t5     t7     t9   engine depart  belt  grapple  t10    t11   rings  hauler salvgr contr  jobs  tiles credits inc/min smelt smash');
for (const p of policies) {
  const r = runSim(p, minutes);
  const m = r.milestones;
  const row = [m.smelter, m.repaired, m.solar, m.beam2, m.tiles[5], m.tiles[7], m.tiles[9], m.engine, m.departed, m.belt, m.grapple, m.tiles[10], m.tiles[11], m.rings, m.hauler, m.salvager, m.contractor].map(fmt).join(' ');
  console.log(`${p.padEnd(9)}${row}  ${String(r.final.jobs.done).padStart(4)}  ${String(r.final.ship.ownedCells.length).padStart(4)}  ${String(Math.round(r.final.credits)).padStart(6)}  ${String(Math.round(r.incomePerMin)).padStart(5)}  ${String(r.final.smelters.length).padStart(4)} ${String(r.final.smashers.length).padStart(4)}`);
}
