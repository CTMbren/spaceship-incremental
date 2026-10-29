# Graphics pass (built as v0.9.5)

Brendan asked (Oct 28) for more detail on every module, an animation when each activates, and more detail on the exterior and thrusters. He said yes to every recommendation: code-drawn vector art (image-gen only for concept sheets), level shown by frame material, optional labels, power lines on a Solar Wing tap, all slices in one round.

What was built is listed in `docs/ROADMAP.md` (Graphics pass). Key files: `src/game/art/kit.ts` (style helpers), `src/game/art/modules.ts` (bodies + live effects per module), `src/game/art/exterior.ts` (lights, beacon, thrusters), `src/game/hullArt.ts` (exterior shape), `src/game/GalleryScene.ts` (`?gallery`).

Rules the art follows:
- Every module: body (baked) + effects (per frame) driven by real state. No rule or save changes.
- States readable without colour: grey + red bolt with a slash (no power), orbiting blue sparks + diamond (Boost), gold pulse (ready), "Full" (blocked), rust and a loose jaw (Rusty).
- Level: bronze, steel, brass, gold frame; small number from L2.
- Calm mode removes shakes, flashes and puffs, slows loops; follows the phone's Reduce Motion.
- The static ship is one baked image, repainted only when the ship changes or after a pinch.

Still open for later: sound, image-gen concept sheets to refine individual modules, panel tilt on Solar Wings, 2-tile footprints.
