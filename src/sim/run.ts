import { fmt, runSim, type Policy } from './bot';

declare const process: { argv: string[] };

const minutes = Number(process.argv[2] ?? 30);
const policies: Policy[] = ['engaged', 'casual', 'idle'];
console.log(`Pacing, ${minutes} min of play on the real core rules (m:ss when reached)\n`);
console.log('policy    smelter repair  solar  beam2   t5     t7     t9   engine depart  belt  grapple  t10    t11   rings  melter  t12    fab    t13    t15    t18   orbit  rover  hauler salvgr contr  jobs  tiles credits inc/min smelt smash');
for (const p of policies) {
  const r = runSim(p, minutes);
  const m = r.milestones;
  const row = [m.smelter, m.repaired, m.solar, m.beam2, m.tiles[5], m.tiles[7], m.tiles[9], m.engine, m.departed, m.belt, m.grapple, m.tiles[10], m.tiles[11], m.rings, m.melter, m.tiles[12], m.fab, m.tiles[13], m.tiles[15], m.tiles[18], m.orbit, m.roverBay, m.hauler, m.salvager, m.contractor].map(fmt).join(' ');
  console.log(`${p.padEnd(9)}${row}  ${String(r.final.jobs.done).padStart(4)}  ${String(r.final.ship.ownedCells.length).padStart(4)}  ${String(Math.round(r.final.credits)).padStart(6)}  ${String(Math.round(r.incomePerMin)).padStart(5)}  ${String(r.final.smelters.length).padStart(4)} ${String(r.final.smashers.length).padStart(4)}  trips ${r.final.rover.trips} ruins ${r.final.rover.ruinsTrips} shards ${r.final.items.core_shard} sand ${r.final.items.sand} resin ${r.final.items.resin}`);
}
