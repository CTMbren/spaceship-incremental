"""Headless economy sim for the 1st-hour pacing. Active player, greedy bot.
Usage: python3 econ_sim.py [config.json]  -> prints timeline + checkpoints.
All numbers are parameters so the doc's tables can be tuned from the output."""
import json, random, sys

DEFAULT = {
 "price": {"ore": 1.0, "ice": 3.0, "plate": 5.0, "coolant": 8.0, "circuit": 20.0, "shard": 150.0},
 "tile_credit_base": 50, "tile_credit_growth": 1.28,
 "tile_mats": {  # tile number -> materials
  4: {"ore": 4}, 5: {"ore": 6}, 6: {"ore": 8}, 7: {"ore": 6, "plate": 2}, 8: {"ore": 8, "plate": 3},
  9: {"ore": 10, "plate": 4}, 10: {"plate": 6, "ice": 3}, 11: {"plate": 8, "ice": 4},
  12: {"plate": 10, "coolant": 5}, 13: {"plate": 12, "circuit": 2}, 14: {"plate": 14, "circuit": 3},
  15: {"plate": 16, "circuit": 4}, 16: {"circuit": 6}, 17: {"circuit": 8}, 18: {"circuit": 10, "shard": 1}},
 "modules": {  # name: (credits, mats, upgrade_base_credits, max_level)
  "smelter": (0, {"ore": 25}, 40, 4), "solar": (0, {"plate": 6}, 30, 3),
  "grapple": (0, {"plate": 10, "ore": 8}, 80, 4), "winch": (0, {"plate": 14}, 120, 3),
  "melter": (0, {"plate": 12, "ice": 6}, 100, 3),
  "fab": (0, {"plate": 20, "coolant": 4}, 150, 4),
  "reactor": (0, {"plate": 16, "circuit": 8, "coolant": 4}, 300, 4),
  "drive": (0, {"plate": 30, "circuit": 10, "shard": 2}, 0, 1)},
 "tractor_up_base": 25, "crusher_up_base": 35,
 "beam2_cost": (60, {"ore": 10}), "beam3_cost": (140, {"plate": 6}),
 "crusher_cap": 36, "crusher_lvl_gain": 0.30, "smelter_cap": 24, "ore_per_rock": 3,
 "order": ["tile4", "smelter", "tile5", "tile6", "solar", "beam2", "tile7", "grapple", "tile8",
           "tile9", "winch", "tile10", "melter", "tile11", "tile12", "fab", "tile13", "beam3",
           "tile14", "reactor", "tile15", "tile16", "tile17", "tile18", "drive"],
 "pity": 12, "shard_chance": 0.06, "crit_rock_rate": 0.4, "max_min": 90, "seed": 1,
}

def run(cfg, seed):
    rnd = random.Random(seed)
    p = cfg["price"]
    inv = {k: 0.0 for k in p}
    credits = 0.0
    lv = {"tractor": 1, "crusher": 1}
    own = set(); beams = 1; pity = 0; tiles = 3
    log = []; t = 0; DT = 5
    queue = list(cfg["order"])
    def cost_of(step):
        if step.startswith("tile"):
            n = int(step[4:]); c = round(cfg["tile_credit_base"] * cfg["tile_credit_growth"] ** (n - 4) / 5) * 5
            return c, cfg["tile_mats"][n]
        if step == "beam2": return cfg["beam2_cost"]
        if step == "beam3": return cfg["beam3_cost"]
        c, m, _, _ = cfg["modules"][step]; return c, m
    def can(c, m): return credits >= c and all(inv[k] >= v for k, v in m.items())
    def rates():
        wl = lv.get("winch", 0) > 0 and "winch" in own
        react = 0.3 if "winch" in own else cfg.get("react", 2.0)
        cyc = lambda cd: cd + react
        tcd = max(2.0, 4.0 * 0.85 ** (lv["tractor"] - 1)) * (0.9 if beams >= 2 else 1.0)
        ore = beams * cfg["ore_per_rock"] * (1 + 0.15 * (lv["tractor"] - 1)) / cyc(tcd)
        ice = 0.0
        if "grapple" in own:
            g = lv["grapple"]; gcd = max(3.0, 12.0 * 0.85 ** (g - 1))
            ore += 9 / cyc(gcd); ice += 2 / cyc(gcd)
        cap = cfg["crusher_cap"] / 60.0 * (1 + cfg["crusher_lvl_gain"] * (lv["crusher"] - 1))
        if "reactor" in own: cap *= 1.15  # boost diamond on crusher
        elif "solar" in own: cap *= 1.0
        ore_in = ore + ice
        scale = min(1.0, cap / ore_in) if ore_in > 0 else 0
        rocks_per_s = scale * (beams / cyc(tcd) + (1 / cyc(gcd) if "grapple" in own else 0))
        return ore * scale, ice * scale, rocks_per_s
    def next_mats_need():
        need = {k: 0 for k in p}
        for s in queue[:3]:
            for k, v in cost_of(s)[1].items(): need[k] += v
        return need
    checkpoints = {}
    while t < cfg["max_min"] * 60:
        ore, ice, rps = rates()
        inv["ore"] += ore * DT; inv["ice"] += ice * DT
        rocks = rps * DT
        credits += rocks * cfg.get("geode_rate", 0) * cfg.get("geode_value", 0)
        crit_rocks = rocks * cfg["crit_rock_rate"]
        for _ in range(int(crit_rocks) + (1 if rnd.random() < crit_rocks % 1 else 0)):
            pity += 1
            if rnd.random() < cfg["shard_chance"] or pity >= cfg["pity"]:
                inv["shard"] += 1; pity = 0
        # processing
        if "smelter" in own:
            sc = cfg["smelter_cap"] / 60 * (1 + 0.25 * (lv["smelter"] - 1)) * DT
            conv = max(0.0, min(inv["ore"] - next_mats_need()["ore"], sc))
            need = next_mats_need()
            # smelt only while plate stock < need+10
            if inv["plate"] < need["plate"] + 10 + 15:
                inv["ore"] -= conv; inv["plate"] += conv / 3
        nd = next_mats_need()
        if "melter" in own and inv["ice"] - nd["ice"] >= 2 and inv["coolant"] < nd["coolant"] + 8:
            c = min((inv["ice"] - nd["ice"]) // 2, 3 * lv["melter"]); inv["ice"] -= 2 * c; inv["coolant"] += c
        if "fab" in own and inv["plate"] >= 2 and inv["coolant"] - nd["coolant"] >= 1 and inv["circuit"] < next_mats_need()["circuit"] + 6:
            c = min(inv["plate"] // 2, inv["coolant"] - nd["coolant"], 0.12 * lv["fab"] * DT)
            inv["plate"] -= 2 * c; inv["coolant"] -= c; inv["circuit"] += c
        # selling surplus
        need = next_mats_need()
        for k in ("ore", "ice", "plate", "coolant", "circuit"):
            keep = need[k] + (10 if k in ("plate", "ore") else 4)
            if "smelter" not in own and k == "ore": keep = 30
            if inv[k] > keep:
                sell = inv[k] - keep
                if k == "ore" and "smelter" in own: sell = max(0, inv[k] - keep - 30)
                credits += sell * p[k]; inv[k] -= sell
        # purchases
        if queue:
            c, m = cost_of(queue[0])
            if can(c, m):
                credits -= c
                for k, v in m.items(): inv[k] -= v
                s = queue.pop(0)
                if s.startswith("tile"): tiles = int(s[4:])
                elif s == "beam2": beams = 2
                elif s == "beam3": beams = 3
                else: own.add(s); lv[s] = 1
                log.append((round(t / 60, 1), s))
        # upgrades with spare credits (only if next structure's credit cost is covered)
        reserve = cost_of(queue[0])[0] if queue else 0
        opts = []
        def add(name, base, key, mx, gain):
            l = lv.get(key, 1)
            if l < mx: opts.append((base * 3 ** (l - 1) if l > 1 else base, name, key))
        add("tractor", cfg["tractor_up_base"], "tractor", 4, 1)
        add("crusher", cfg["crusher_up_base"], "crusher", 4, 1)
        for mname in ("smelter", "grapple", "melter", "fab"):
            if mname in own:
                add(mname, cfg["modules"][mname][2], mname, cfg["modules"][mname][3], 1)
        # prioritize cheapest; pays only if credits - cost >= reserve
        opts.sort()
        for cst, name, key in opts:
            lvl = lv.get(key, 1)
            c2 = cst
            mats_short = bool(queue) and not all(inv[k] >= v for k, v in cost_of(queue[0])[1].items())
            if (credits - c2 >= reserve or (mats_short and credits - c2 >= 0) or c2 <= 0.35 * reserve) and credits >= c2:
                credits -= c2; lv[key] = lvl + 1; log.append((round(t / 60, 1), f"up:{name}{lvl+1}")); break
        t += DT
        for mm in (5, 10, 15, 20, 30, 40, 50, 60):
            if t >= mm * 60 and mm not in checkpoints:
                o, i_, rp = rates()
                inc = o * p["ore"] + i_ * p["ice"]
                checkpoints[mm] = dict(inv={k:round(v,1) for k,v in inv.items()}, tiles=tiles, credits=int(credits), lv=dict(lv), beams=beams, ore_s=round(o * 60, 1), rocks_min=round(rp * 60, 1))
        if not queue and "drive" in own: break
    return log, checkpoints, t / 60

if __name__ == "__main__":
    cfg = dict(DEFAULT)
    if len(sys.argv) > 1: cfg.update(json.load(open(sys.argv[1])))
    done_times = []
    for sd in range(20):
        log, cp, tend = run(cfg, sd)
        done_times.append(tend)
    log, cp, tend = run(cfg, 0)
    print("seed0 timeline:");
    for e in log: print(" ", e)
    print("checkpoints:"); [print(" ", k, v) for k, v in cp.items()]
    shard_t=[]
    print("finish minutes over 20 seeds: min %.1f median %.1f max %.1f" % (min(done_times), sorted(done_times)[10], max(done_times)))
