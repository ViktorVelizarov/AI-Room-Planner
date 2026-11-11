# Avoiding overlapping furniture

Research for US-18, done on 2026-10-29. It answers two questions: how can the app stop a layout from putting a piece of furniture inside another one or through a wall, and which way should the layout generator (US-19) use?

## Result

**Check every layout in code and fix what the check finds in code, and also ask the AI to leave gaps.** In order:

1. **Ask for it in the prompt** (the "leave gaps" option). The prompt gives the AI each piece's footprint, says how rotation works, and asks for no overlaps and about 10 cm between pieces and walls (the wording is under [For US-19](#for-us-19)). It costs nothing and changes the answer, but it cannot be relied on.
2. **Check every answer** (the "bounding-box check" option). Each piece is a rectangle on the floor, turned by its rotation. The check looks for two rectangles that share floor, and for a rectangle that goes through a wall. A rug is the one piece that may lie under others. It is `src/shared/footprint.ts`, and it is tested, including against Three.js's own rotation.
3. **Fix what the check finds, in code.** First *repair*: push apart the pieces that overlap, the lighter one further, and pull back the ones that stick out of the room. Then *search*: a piece that is still wrong goes to the nearest place that is free, the biggest pieces first. It takes about 1 ms and needs no AI call. A layout that is already fine is left alone, apart from a centimetre or two where pieces were closer than the 3 cm gap that it aims for (the baseline layouts below moved 0.1 to 1.4 cm on average).
4. **If a layout is still not fine, the room is too full**: say so and keep the current room, which is the error case of US-19 AC3. In these tests the fixing began to fail when the pieces covered about 60% of the floor and found nothing from 70%, so that is the number to warn about, before the AI is even asked.

The AI is asked again only when its answer is not a layout at all (a piece missing or listed twice, US-19 AC3), not for overlaps.

**Not chosen:** the grid, and "check, then ask the AI again". Why:

- **Asking again cannot be the way.** When every piece of a good layout was off by only 5 cm, 31% of the layouts of the living room, 5% of the bedroom and 2% of the crowded studio had no overlap and no wall in the way; at 10 cm, 16%, 0% and 0%. One more ask would lift 31% to about 52% at best, and each ask is one of the 10 calls of a session. An AI would have to be exact to a few centimetres, and a prompt cannot promise that.
- **Fixing in code works.** Repair followed by search made 100% of the layouts fine at every error size up to 30 cm in the living room (pieces covering 22% of the floor) and the bedroom (39%), and 90% to 100% in the crowded studio (58%); see the tables below.
- **The grid fixes no more and costs more.** A grid that only rounds the AI's places does not stop overlaps (fine in 0% to 93% of the layouts). A grid that gives each piece its own cells does (91% to 100%, except 57% to 87% with 50 cm cells in the crowded studio), but it moved the pieces 1.4 to 7 times as far as repair, needed 22% to 52% more room for the cells than the pieces themselves cover, rounds every turn to a quarter, moved even layouts that were already fine (by 25 cm on average in the crowded studio), needs the AI to think in cells, and still needs the footprint check, because the AI can give two pieces the same cell.
- **It is little code.** The footprint check is about 50 lines, repair 36 and search 48, all tested (`npm test`); the grid is 48 on top of the check, and changes the prompt, the answer and the 3D room as well.

## What was tried

| Option | What it does | What it needs |
| --- | --- | --- |
| **Check only** (bounding-box check) | Looks at the footprints of the AI's answer. A layout with an overlap or a piece through a wall is not shown, and the AI is asked again. | The footprint check: about 50 lines, 0.5 day with tests. Each ask is one more paid call. |
| **Check and repair** | The same check, then pushes the pieces that overlap apart and pulls the ones that stick out back in, round after round, until nothing is wrong or 300 rounds have passed. Nothing is turned. | 36 lines on top of the check, about 0.5 day. |
| **Check and search for a free place** | The same check, then moves each piece that is wrong, the biggest pieces first, to the nearest free place, looking 5 cm at a time, in the exact geometry. | 48 lines on top of the check, about 0.5 day. |
| **Repair, then search** | Repair first, which keeps the AI's arrangement; the search only for what is still wrong. | The two together. |
| **Grid** | The room is cut into square cells, and a piece takes the whole cells its footprint reaches into. The AI's place for a piece is taken as the nearest free block of cells; the pieces are put on the grid. Tried with 25 and 50 cm cells, with and without keeping two pieces out of the same cell. | 48 lines on top of the check, and the AI must answer in cells or be rounded, which is 1.5 to 2 days with the prompt, the answer and the 3D room. |
| **Ask the AI to leave gaps** | Tells the AI in the prompt to leave gaps and keep inside the walls. | A few lines of the prompt. No guarantee at all. |

The footprint check, repair, search and grid are in `scripts/overlap-approaches.ts` and `src/shared/footprint.ts`; `npm run overlaps` runs everything below again in about half a minute, with no AI call.

## How they were tried

- **Three sample rooms** (`docs/overlap-research/samples.json`): a living room of 5 x 4 m with 8 pieces, a bedroom of 4 x 3.5 m with 8, and a crowded studio of 3.4 x 3 m with 8, the pieces covering 58% of its floor. Each has a *reference* layout that is fine, made by hand, with every piece at least 2 cm from the walls and from the others.
- **Four layouts of each room:** the reference; *baseline* and *gaps*, which are what an AI could answer to the plain prompt and to the prompt that asks for gaps; and *flawed*, the reference with typical mistakes put in by hand (a piece with its middle on the wall, a piece not turned, a chair half in a desk). The 5 or 4 mistakes of each room are listed in the file.
- **The baseline and gaps layouts were written by Claude, this assistant, not by Gemini.** The layout generator does not exist yet, and no paid call was made for this research. They say what the approaches do to answers like these, not how often Gemini overlaps furniture. Answers of the real AI can be added to the file and the script run on them.
- **Random layouts.** To see the approaches on many layouts, each reference was changed the way a not quite exact AI might: every piece off by a random error of 5, 10, 20 or 30 cm in x and z, and 5% of the pieces turned a quarter the wrong way. 300 layouts for each room and error. This is an assumption about the AI, not something measured.
- **Fuller and fuller rooms.** The rooms were made smaller, 10%, 20% and 30%, with the pieces keeping their size, so the pieces covered more of the floor.
- **"Fine" means** every piece inside the walls and no two pieces sharing floor, rugs excepted. Repair and search aim for 3 cm between pieces and 2 cm from the walls, so that pieces do not just touch.

## Results

### The sample layouts

The references pass every check. Of the other layouts, only *flawed* has overlaps or pieces through walls; Claude's *baseline* and *gaps* answers have none, so there is nothing for an approach to prevent there. What the *gaps* instruction changed is how close things are: pieces and walls closer than 5 cm to each other were 2, 4 and 7 in the baseline layouts of the three rooms and 0, 0 and 4 in the gaps layouts (the studio is too full to leave 5 cm everywhere). That is the whole evidence about asking for gaps, and it is one writer's.

The *flawed* layouts, with the mistakes of the file (living room: 3 overlapping pairs and 2 pieces outside; bedroom: 1 and 4; studio: 3 and 2). The last column is how far the pieces were moved, on average and the most, in cm; no approach turned anything.

| Room | Approach | Result | Moved (cm) |
| --- | --- | --- | --- |
| Living room | check and repair | fine | 13.5 / 35.3 |
| | check and search for a free place | fine | 16.3 / 45 |
| | repair, then search | fine | 13.5 / 35.3 |
| | grid 25 cm, rounding only | **not fine**: 2 overlapping | 14.1 / 30 |
| | grid 25 cm, one piece to a cell | fine | 21 / 50.2 |
| | grid 50 cm, one piece to a cell | fine | 23.9 / 39.1 |
| Bedroom | check and repair | fine | 26.4 / 102 |
| | check and search for a free place | fine | 28.1 / 105 |
| | repair, then search | fine | 26.4 / 102 |
| | grid 25 cm, rounding only | **not fine**: 2 overlapping | 27.8 / 100.8 |
| | grid 25 cm, one piece to a cell | fine | 35.1 / 100.8 |
| | grid 50 cm, one piece to a cell | fine | 48.8 / 115.4 |
| Studio (crowded) | check and repair | **not fine**: 1 overlapping | 18.5 / 59.6 |
| | check and search for a free place | fine | 29.5 / 80 |
| | repair, then search | fine | 31.3 / 80 |
| | grid 25 cm, rounding only | **not fine**: 3 overlapping | 14.8 / 25 |
| | grid 25 cm, one piece to a cell | fine | 36.9 / 102.8 |
| | grid 50 cm, one piece to a cell | fine | 41.4 / 111.8 |

The 1 m move is the bed, whose middle was on the wall. Repair alone left a bed and a nightstand overlapping in the crowded studio after its 300 rounds: the bed, nightstand, chair, dresser and desk had all been squeezed into one row across the room, which needs 3.35 m of the 3.4 m, so the dresser would have had to go down the wall instead, and that is not the shortest push.

### Random layouts

How often the layout ends up fine, and in brackets how far the pieces moved, in cm on average per piece. The columns left out (grid 50 cm, and rounding only) are in `npm run overlaps`.

| Room | Error | as the AI gave it | check and repair | check and search | repair, then search | grid 25 cm, one piece to a cell |
| --- | --- | --- | --- | --- | --- | --- |
| Living room | 5 cm | 31% | 100% (1.9) | 100% (2.4) | 100% (1.9) | 100% (9.7) |
| | 10 cm | 16% | 100% (2.9) | 100% (3.6) | 100% (3) | 100% (11.5) |
| | 20 cm | 3% | 100% (6.2) | 100% (7.1) | 100% (6.2) | 100% (14.4) |
| | 30 cm | 1% | 100% (9.8) | 100% (11.1) | 100% (9.8) | 100% (18.2) |
| Bedroom | 5 cm | 5% | 100% (2.7) | 100% (4.1) | 100% (2.7) | 100% (11.7) |
| | 10 cm | 0% | 100% (5.2) | 100% (6.7) | 100% (5.2) | 100% (13.6) |
| | 20 cm | 0% | 99% (9.8) | 100% (11.6) | 100% (10) | 100% (18) |
| | 30 cm | 0% | 95% (15.3) | 100% (18.7) | 100% (16.7) | 100% (24.1) |
| Studio (crowded) | 5 cm | 2% | 95% (3) | 100% (8.3) | 100% (3.9) | 100% (26.5) |
| | 10 cm | 0% | 97% (6.5) | 100% (14.6) | 100% (7.2) | 100% (30.2) |
| | 20 cm | 0% | 91% (12.9) | 93% (25.7) | 97% (14) | 95% (36.1) |
| | 30 cm | 0% | 81% (20.4) | 87% (33.9) | 90% (21.7) | 91% (43.1) |

Repair keeps the AI's arrangement best (the pieces move least), and search is the most reliable on its own; together they are as reliable as either with the small moves of repair. For one layout the time was 1.2 ms for repair, 0.9 ms for search and 1.3 ms for both, on this computer.

Repair has a limit that search does not: it pushes the shortest way, so pieces that have to be spread another way are only pushed along the line they are in. The crowded studio above is one case, and pieces that were turned the wrong way and now stand end to end along the room are another (`overlap-approaches.test.ts` has it). Search fixes both, which is why it is the second step.

### Fuller and fuller rooms

The error is 10 cm. How often the layout ends up fine (100 layouts each). "Floor covered" is the area of the pieces, not the rug, as a part of the floor.

| Room | Floor covered | as the AI gave it | check and repair | check and search | repair, then search | grid 25 cm |
| --- | --- | --- | --- | --- | --- | --- |
| Living room | 22% | 20% | 100% | 100% | 100% | 100% |
| | 44% | 0% | 97% | 100% | 100% | 100% |
| Bedroom | 48% | 0% | 98% | 100% | 100% | 100% |
| | 61% | 0% | 71% | 95% | 93% | 89% |
| | 79% | 0% | 0% | 0% | 23% | 0% |
| Studio (crowded) | 58% | 0% | 100% | 100% | 100% | 100% |
| | 71% | 0% | 0% | 6% | 3% | 0% |
| | 90% | 0% | 0% | 0% | 0% | 0% |

Up to about half of the floor, every fixing approach copes. At about 60% they begin to fail, and from 70% on nothing found a layout. Such a room cannot be arranged without overlaps, so showing an overlapping layout would be wrong: the app should say that the furniture is too much for the room.

## What these numbers do not say

- **Nothing here is measured on Gemini.** The size of the AI's errors is an assumption (5 to 30 cm, 5% wrong turns), and the baseline and gaps answers are Claude's. If the real AI is exact to a centimetre, the check alone would do and the fixing would never run; if it is as wrong as 30 cm, the fixing is what makes the layouts work. The decision holds either way, because the fixing costs nothing when it has nothing to fix. The numbers above should be run again on real answers once US-19 produces them (`npm run overlaps -- --samples <file>`).
- **Three rooms**, with layouts made by hand; the references are one way of arranging them.
- **Turns.** The tests turn pieces only by quarters. A real answer may turn an armchair 30 degrees; the check and the fixing handle any angle, the grid rounds it to a quarter.
- **Chairs under tables.** A chair pushed in under a desk or a dining table is real furniture, and here it counts as an overlap, so a chair ends up at the edge of the table. Only the rug is exempt. A tolerance for chairs can be added to the check if it looks wrong in 3D.
- **What a layout looks like** is not judged here: a layout can be free of overlaps and still be a poor room (no space to walk, a sofa with its back to the TV). That belongs to the layout prompt (US-19, US-21).

## For US-19

**Conventions the check uses**, which the layout answer should follow (they are in `src/shared/footprint.ts`):

- A piece is placed by `x_m` and `z_m`, the **middle of its footprint** in metres from the middle of the floor (x across, z along the length), which is where the model's origin is (US-14), and by `rotation_deg`.
- **Rotation** is in degrees about the vertical axis: 0 faces the front of the room (+z), and a positive angle turns the front towards +x. This is `rotation.y` in Three.js, so the 3D room can use `object.rotation.y = rotation_deg * Math.PI / 180`, and a test checks that the footprints agree with Three.js. A piece turned 90 or 270 degrees is as wide as it was deep.
- A piece is identified by its place in the furniture list (US-12), so the answer is one entry for each piece, in order.
- Touching is not an overlap. A rug may lie under any other piece, but must stay inside the room.

**The prompt**, as a start for US-19. The plain part:

> The room is 5 m wide (x from -2.5 to 2.5) and 4 m long (z from -2 to 2). Place these pieces of furniture in it. For each give x_m and z_m, the middle of the piece in metres from the middle of the room, and rotation_deg: 0 faces +z, the front of the room, and 90 turns the front towards +x. Give one entry for each piece, in the order of the list. Pieces (number: type, width x depth in cm): 0: sofa 200 x 90, 1: armchair 80 x 85, ...

and the part that asks for gaps, added to it:

> Every piece must be completely inside the room, and no piece may overlap another. A piece covers a rectangle of its width x depth, turned by its rotation, so a piece turned 90 degrees covers its depth across and its width along. Leave at least 10 cm between two pieces and between a piece and a wall, except where a piece stands against a wall on purpose, which needs 2 cm. A rug is the one exception: other pieces may stand on it.

**The steps** after the AI answers:

1. Check the answer is a layout: every piece once and no extra, numbers for all of the values. If not, ask again once, and then show the error (US-19 AC3).
2. Check the footprints (`overlap`, `outsideRoom`). If they are fine, use the layout as it is.
3. Repair, then search (3 cm between pieces, 2 cm from the walls). Check again; if it is fine, use it. Say how many pieces were moved, so that the user knows it is not exactly what the AI said.
4. If it is still not fine, show the error and keep the current room.
5. Before the AI is asked: if the pieces cover more than about 60% of the floor, tell the user the furniture is too much for the room instead of spending a call.

**Code.** `repair` and `placeNearest` are in `scripts/overlap-approaches.ts` with their tests; they are meant to move to `src/shared/` when the layout code is written, next to `footprint.ts`, and to take the layout types of US-19.

## For US-22: three attempts, and then the layout is not shown

US-22 asks that a layout that cannot be fixed "after 3 attempts" is not shown, with a message and a button to retry, and says that the fixing may be "by moving the items or asking the AI again". This is how that was read, and what it was checked with.

- **The attempts are fixes in code.** `fixLayout` makes up to three (`FIX_ATTEMPTS`), each from the answer as it was given, and each asks less of the room than the one before: 3 cm between pieces and 2 cm to a wall, then 1 cm and none, then pieces that touch. The reasons for not asking the AI again are the ones under "Not chosen" above: the fixing is free, takes milliseconds and succeeds where another answer would often not, and every ask is a call of the session's limit and, with Gemini 3.1 Pro, up to two minutes. The button to retry is what asks the AI again, and the new answer is shown where the other layouts put their pieces.
- **Order inside an attempt.** An attempt keeps the turns of the AI first. If that fails and a piece is at an angle, which takes more room than a quarter turn, the same attempt is made again with every turn made the nearest quarter turn, and only then does the next attempt, with smaller gaps, begin. Before US-22 the quarter turns were tried after all three gap sizes had failed. The two orders were compared on random layouts with a piece at an angle (1,393 for each of four rooms with six pieces each: pieces put anywhere in the room, turned a quarter, and about a third of them also at an angle of 15 to 45 degrees): every layout that one order made fine the other made fine too, and they differ only in how the fine layout looks. In a living room of 5 m x 4 m (21% of the floor) and a bedroom of 4 m x 3.5 m (36%) no answer differed, in a studio of 3.4 m x 3 m (48%) 27 of 1,388, and in a bedroom of 3 m x 2.6 m (63%) 188 of 1,106: the old order kept the angle and let the gaps shrink, the new one straightens the piece and keeps the usual gaps. That was judged the better layout for a person (a piece 1 cm from another, or touching it, is not how a room is furnished), and it makes "three attempts" true for every layout: each attempt is a real try with its own gaps.
- **What happens after the third attempt.** The layout is dropped, not repaired as far as it got: `LayoutOverlapError` is thrown, and the style has no poses in the answer of the endpoint, only a message that says what was wrong (furniture overlapping, or sticking out of the room), that it was tried three times, and that it is not shown. The pieces that were in the way are in the server log, by name and place in the list. The page offers Try again for that style, which asks the AI again.
- **How often it comes to that.** On random answers that are nearly right (every piece off by 5 to 50 cm, a tenth a quarter the wrong way, a tenth at an angle, one in twenty put anywhere in or around the room; 300 for each room, five seeds, `layout-fix-random.test.ts` uses one of them): every layout in the living room and the bedroom was made fine, 94% to 96% in the crowded studio and 89% to 92% in the crowded bedroom of 3 m x 2.6 m (63% of the floor, where the page warns). In the bedroom, of 300 answers about 12 were made fine by the second attempt and 30 by the third, and 0 to 1 needed none: the later attempts do the work that the first cannot in a room as full as that. The answers that are given up are those for which the room could hold the pieces (the arrangement the answers are made from is fine), but not from where the answer put them.
- **What it costs.** Time, on this computer, for one layout: 3 to 34 ms for six pieces in the bedroom of 63%; 140 to 180 ms for 40 pieces in a room of 14 m x 10 m (51%); 0.9 to 3.4 s for 40 pieces in a room of 12 m x 9 m (67%), of which 2 in 6 were made fine, which is about as bad as the limit of 40 pieces and the limit of 70% of the floor allow together; a room in which nothing fits is refused before the AI is asked. A real room has far fewer than 40 pieces. The fixing is synchronous code, so on the server it holds the other requests for that long, once for each of the three styles.
- **Checked again by other means.** Every layout that `fixLayout` calls fine, in the random tests, is looked at by two checks that share no code with the footprint check that `fixLayout` makes: the area that two footprints have in common, calculated exactly, and where Three.js puts the corners of each piece and whether a grid of points over one piece lies inside another (which is how the 3D room stands the pieces). None had a piece in another or through a wall. The two checks are in turn shown to see what the footprint check sees, on answers that do have mistakes in them.
- **What this does not say.** The answers are made by a random generator, as in the research above, and not by Gemini, which has made one layout so far. How often real answers need the second and third attempt, and how big the mistakes are, is not known until there are more.
