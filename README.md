# AI Room Layout Generator

Upload photos of your room, let AI find the furniture, and see new layouts in a 3D room. Built with Next.js, TypeScript and Gemini.

## Setup

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Before using any AI feature, copy `.env.example` to `.env.local` and put your Gemini API key in it.

Open <http://localhost:3000>. The upload page should load without errors.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (also type-checks) |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run the unit tests (no network or API key needed) |
| `npm run detect -- <photos>` | Send room photos to the furniture detector and print the result, one call per photo. Needs `GEMINI_API_KEY`; every call is paid |
| `npm run detect -- --room <photos>` | The same, but all photos are one room: a single call and one list, as the app does it |
| `npm run overlaps` | Try the ways of keeping furniture from overlapping on sample rooms and random layouts and print the tables of `docs/overlap-avoidance.md`. About half a minute, no AI call |
| `npm run layout` | Ask the AI for a layout of a sample living room and print where each piece goes, as the app does it. Needs `GEMINI_API_KEY`; every call is paid (one, or two if the first answer cannot be used) |
| `npm run layout -- room.json` | The same for your own room: a file with the "Room description (JSON)" of the 3D room step |
| `npm run layout -- --prompt` | Print the instructions that are sent to the AI and stop. No call, no cost |
| `npm run layout -- --demo` | No call: make believe that the AI made the "flawed" layout of the overlap research, to see how the app fixes it |

## Project structure

| Folder | Purpose |
| --- | --- |
| `src/app/` | Pages and API routes (Next.js App Router) |
| `src/components/` | UI components: the four-step flow (photos, room size, your room, 3D room), the photo uploader, the room size form, the furniture editor, the room description view, the 3D room step (which holds the layout), the 3D room view, the buttons under it that choose the layout, and the layout generator |
| `src/client/` | Browser-only helpers: shrinking photos before upload and calling the API |
| `src/ai/` | AI code: furniture detection and layout generation. Server-side only |
| `src/viewer/` | 3D rendering code: the 3D room with its furniture, the camera and its controls, and the loading of the furniture models. Browser only |
| `src/server/` | Server-only logic behind the API routes: the AI call limit and the request handlers |
| `src/shared/` | Types and rules used by both browser and server, such as the supported furniture labels and their typical sizes, photo rules, room size limits, the room description, the furniture library index, the footprint check for overlapping furniture, the layout (its checks and the fixing of overlaps), the three layout styles and how different layouts must be, the check of a request for layouts, and the API response types |
| `public/` | Files the site serves as they are: the furniture model library, in `public/models/` |
| `scripts/` | Command-line tools: `detect.ts`, `layout.ts`, `build-model-library.ts`, and the overlap research (`overlap-approaches.ts`, `overlap-research.ts`) |
| `docs/` | Notes that are not code: the furniture model licence research (US-13) and the overlap research (US-18, with its sample rooms in `docs/overlap-research/`) |

`src/ai/` and `src/viewer/` must not import from each other, so each can be run and tested on its own. Both may import from `src/shared/`.

## Furniture detection

`detectFurniture(images)` in `src/ai/` sends the photos of one room to Gemini in a single call and returns the furniture it found, with a piece that appears in several photos listed once: type (one of 15 supported labels), size in cm (width, depth, height), main colour and main material. It never returns positions; those come from the layout step later.

- The answer is validated against a schema. If it is invalid or incomplete, the model is asked once more; if the second answer is also invalid, a `DetectionError` is thrown and no data is used.
- Things the model labels `other` (not a supported type) are left out of the result.
- Errors from the call itself (no network, bad key) are not retried.

## Furniture models

The 3D scene uses free models, chosen and checked in US-13: all 15 furniture types come from Kenney's Furniture Kit, which is CC0, so no credit is required (the credits section will name it anyway). `docs/furniture-model-licences.md` lists the libraries that were checked, why this one was chosen, and which model stands for each type.

The library itself is the folder `public/models/`: one GLB file for each of the 15 types (3 to 39 KB each, about 0.2 MB in all), the index `index.json`, and the licence text of the kit.

- **Index.** `index.json` lists every model with its type, file name, licence and credit, where it comes from and what was done to it, its size, and its materials with the main one (the surface that a colour is applied to). Its schema is `modelLibrarySchema` in `src/shared/model-library.ts`: an index that is invalid, or has no model for one of the types, is refused.
- **Conventions.** Sizes in the index are in cm, and the files and the scene are in metres. Every model stands on the floor (its base is at y = 0), has the middle of its footprint at x = 0, z = 0, and faces +z, the front of the room (the axes of the 3D room, above). A model is a realistic size, close to the typical size of its type: the sofa is 198 cm wide. To show a piece at another size, scale the model along each axis by the size wanted divided by the size in the index.
- **Loading.** `loadFurnitureModel(type)` in `src/viewer/` fetches `/models/<type>.glb` and returns a new 3D object, ready to be put in the scene. `parseFurnitureModel(entry, bytes)` makes one from the bytes of a file, and `modelFor(type)` gives the entry of the index. Each call makes a new object, so one type can be several pieces. The object says which of its materials is the main surface (`mainMaterialOf`), as the index does, so that a piece can be given its colour.
- **Making the library.** `npm run models -- <the unpacked kit>` (`scripts/build-model-library.ts`) takes one model from Kenney's kit for each type, scales it so that it comes as close as possible to the typical size of its type, puts its base on the floor and the middle of its footprint at the origin, writes the credit into the file, and writes the index and the licence text. To use another model for a type, change the table at the top of the script and run it again. The kit itself is not in the repository: download it from [kenney.nl](https://kenney.nl/assets/furniture-kit).
- **Two weaker matches.** The dresser is a stand-in: the kit has no chest of drawers, so it is a low wooden cabinet with doors. The side table is a long, narrow table rather than a square one. Both say so in the index.
- **Tests.** The files and the index are tested as they are (`furniture-library.test.ts`): a model for every type, each file a GLB under 2 MB, only licences the project may use, the index matching the files, and each model loaded into a scene at the size the index gives, on the floor, centred, and facing +z. The tests that look at which way a model faces use the backrest of a seat and the handles of a drawer as the cue.

## Room description

The room description is the one piece of data the rest of the app builds on: the room size and the furniture list, together. The 3D room reads it, and so does the layout generator. It is made when the user presses **Continue to 3D room** on the "Your room" step, from the size and the furniture list as the user confirmed them.

```json
{
  "room": { "width_m": 4, "length_m": 5, "height_m": 2.5 },
  "furniture": [
    { "label": "sofa", "width_cm": 200, "depth_cm": 90, "height_cm": 85, "color": "dark grey", "material": "fabric" },
    { "label": "rug", "width_cm": 160, "depth_cm": 230, "height_cm": 1, "color": "beige", "material": "fabric" }
  ]
}
```

- The room is in metres, with the same limits as the size form: width and length 1 to 20, height 2 to 5. A piece is in cm, 0.1 to 1000. `label` is one of the 15 supported types, `material` one of the 7 materials, and `color` any text that is not empty.
- There must be at least one piece of furniture.
- There are no positions. A piece is identified by its place in `furniture`, which does not change once the description is made, so a layout can refer to "piece 3". Two identical chairs are two entries.
- `createRoomDescription(room, furniture)` and `parseRoomDescription(input)` in `src/shared/room-description.ts` are the way to get a `RoomDescription`. Both return `{ ok: true, description }` or `{ ok: false, problems }`, and never throw. `problems` are plain sentences that say what is missing or wrong, such as `Furniture item 2 (Sofa): the depth is missing.` or `The furniture list is empty. Add at least one piece of furniture.`; every problem is listed, not only the first.
- `parseRoomDescription` takes anything, such as JSON that was saved or sent in a request, so the server can check a description it receives instead of trusting the browser. It returns a clean copy with only the fields above. The schema itself is `roomDescriptionSchema`.
- The 3D room step shows the description as JSON (`RoomDescriptionView`), folded away below the 3D view. It is the debug view.

## 3D room

The "3D room" step shows the room in the size the user entered, with the user's furniture in it, drawn with Three.js (`three`, with its types in `@types/three`). The drawing code is in `src/viewer/` and does not use React; `src/components/room-3d-view.tsx` is the thin wrapper that puts it in the page, and `src/components/room-3d-step.tsx` is the step around it, which also holds the layout (see "A layout" below). The 3D code is loaded when the user reaches this step, not with the page.

- **Axes.** One unit is one metre. The origin is the middle of the floor, and y points up from the floor. x runs along the width and z along the length, so the room fills x from minus half the width to plus half the width, y from 0 to the height, and z from minus half the length to plus half the length. For a room 6 m wide, 4.5 m long and 2.5 m high that is x from -3 to 3, y from 0 to 2.5 and z from -2.25 to 2.25. Seen from above with x to the right, z runs down the screen, as in the outline in the "Your room" step. The front of the room is the side where z is largest, which is the side the camera starts on. A piece of furniture stands on the floor, so a layout places it by x and z alone, measured from the middle of the room on these axes: the position of a piece is the middle of its footprint, and `rotation_deg` says which way it faces (see "A layout" below and "Layout generation").
- **Walls.** Every wall faces into the room and is drawn on that side only. From outside, the walls nearest the camera face away from it and are not drawn, so they never hide the room; from inside, all four are drawn. Lines show the edges of the room, and the floor has a line every metre, counted from the corner so that the squares along a wall can be counted against the real room.
- **Furniture.** Each piece of the user's list is shown as its model from the furniture library, stretched to the piece's width, depth and height and standing on the floor. Until a layout is made, the pieces are lined up by `arrangeInRows` (`src/viewer/arrangement.ts`): in the order of the list, side by side along the back wall from the left, 10 cm from the walls and 15 cm apart, with a new row in front when one is full. They all face the front. A piece wider than the room has a row to itself, and if the furniture does not fit the room the rows go on past the front wall; the starting view then includes whatever sticks out, so nothing is cut off.
- **A layout (US-20).** When a layout has been made (the "Suggest layouts" box under the view, which makes three; the one that is chosen is shown), the furniture stands as it says: each piece at its `x_m` and `z_m`, turned by its `rotation_deg`. A layout is a list of `Pose`s and a `Placement` (`src/viewer/arrangement.ts`) is the same three numbers with `rotation_deg` optional (0, facing the front, as in the rows), so the 3D room takes a layout as it is. One function puts every piece where its placement says, a model or a grey box alike (`stand` in `src/viewer/furniture-scene.ts`): the piece's origin, the middle of its footprint on the floor, goes to the place, and the piece is turned about the vertical axis with `rotation.y`. That is the rule of the footprint check: 0 faces the front wall (+z), 90 the right wall (+x), 180 the back wall (-z), 270 the left wall (-x), and a positive angle turns the front towards +x. A piece is stretched along its own sides before it is turned, so its width stays across its front, and it is turned about its middle, so it keeps standing on the floor. The furniture of the old arrangement stays in the room until the new one is loaded, and a camera that the user has moved is left where it is. A layout is in the first picture when the 3D room is opened again, so the rows are never shown first, and it is dropped, with the room going back to the rows, when the furniture changes in a way that a layout depends on (see "Layout generation"). The label of the view says which layout it is in ("in the Cosy layout") while one is shown.
- **Choosing the layout (US-23).** Once layouts are made, a row of buttons stands directly under the picture, one for each layout that was made, in the order Spacious, Cosy, Work-focused, with the word "Layout" before them (`LayoutSwitcher` in `src/components/layout-switcher.tsx`; `Room3DView` shows it as its `children`, between the picture and the size of the room with the Reset button). The layout that the 3D room shows has its button pressed (`aria-pressed`) and filled, and the others are outlined, so it can be told without the colours; under the buttons the name and the idea of the layout that is shown are written, in a polite live region, so that a screen reader says them when another layout is chosen. Pressing a button shows that layout in the same 3D room: the furniture is put in its new places, nothing is asked of the AI, no new view is made, and the camera stays where the user put it (in real Chrome, layout A seen from a camera that was moved, then B, then A again is the same picture, 0 pixels differ). A style that failed has no button, since it has no layout: its card says why, and when it is made again its button comes in its place in the order. The buttons are under the picture and not above it so that the picture never moves on the page when the idea of a layout is longer or shorter than the one before. They and the Show in the 3D room button of each card are one choice, held by the 3D room step (`Room3DStep`): choosing with either moves the pressed button of both, and the 3D room is in the layout that was chosen when the user comes back to it. On a phone the word Layout has a line of its own so that the three buttons fit in the next. A switch takes about 40 ms from the click to the first thing drawn (the median of six in headless Chrome with a software renderer, 23 to 148 ms; the furniture is built again, models included, each time), which is fast enough that nothing is kept between layouts. Without WebGL there is no 3D view, so there are no buttons, and the cards list the layouts as before.
- **Colour and material.** Each piece takes the colour and the material the AI found for it, or that the user typed in the list (`applyAppearance` in `src/viewer/appearance.ts`). Only the main surface of the model changes, the one the index names as `main_material` (a sofa's upholstery, a desk's wood), so a sofa's legs and a desk's handles keep their own colours. It changes on a copy that belongs to the piece, so two sofas of one type can have two colours, and the model that the pieces are copied from is never painted.
  - *Colour.* `resolveColour` (`src/viewer/colour.ts`) reads the colour text. The AI is asked for "a plain color name" but also writes "oak brown", "dark blue and light wood" or "yellow with white polka dots (tablecloth)", so it takes the main colour: what comes before "and", "with", "/", a comma or a bracket. In "blue grey" and "oak brown" the last word is the colour and the one before tints it, and "dark", "light", "pale", "dusty" and the like make it darker, lighter or duller. A word for a material (wood, metal, glass, wicker, brick) counts only when no colour is named, so "black metal" is black. About 120 words are known, and the colours are a little softer than a screen's pure ones, which would glare in the room. It was tried on the 180 different colours that Gemini, Claude and GPT-5 gave for the 890 photos of the benchmark (`ai-colour-answers.json`): all but the four "multicolor" ones become a colour. A colour written as `#rrggbb` or `#rgb` is read too.
  - *Material.* The seven materials each have a look (`LOOKS` in `appearance.ts`). Fabric is the matt look that the models already have, wood, leather and plastic are progressively shinier, metal is a metal, glass is see-through, and `other` has no look of its own. Lights only make a surface lighter or darker, so shiny pieces reflect a built-in picture of a bright room with a window on the side of the room's light (`src/viewer/reflections.ts`), which is what makes a metal look like one. Metal and glass are plain to see; the differences between wood, leather and plastic are small, a soft glint on the edges, because the models are low-poly and flat.
  - *Unknown.* A colour that cannot be read ("unknown", "multicolor", "framed mirror") and a material of `other` each change nothing, on their own: the model keeps its colour, or its look. A piece with both unknown is the model exactly as it was, pixel for pixel. A box that stands in for a missing model stays grey, so it can be told from a model.
  - *Shades.* A part of a model that is a darker or lighter shade of the main surface, such as the border of the rug, follows the main colour at the same relative lightness. It is recognised by its own colour in the file (the same hue, and not white or grey), and the tests list which parts of the 15 models are such shades: only the rug's border.
- **Loading.** The models are loaded when the 3D room opens, each type once however many pieces it has (every piece gets a copy), and all the types at the same time. The room says "Loading the furniture…" until they are in. Ten different pieces with their colours and materials took about 0.5 to 0.8 seconds, and about 3 seconds on a slow connection with a computer four times slower, including loading the 3D code. The colours and materials add 0.1 to 0.5 seconds to that on the software renderer that the browser checks run on, mostly for making the reflections once.
- **Pieces without a model.** A piece whose type has no model, whose model cannot be loaded, or whose model takes more than 10 seconds, is a plain grey box of its size with an outline, whatever its colour, and the room says which pieces they are, by name and place in the list ("Sofa (item 1)"). The library has a model for all 15 types, so this happens when a file is missing or the network fails.
- **Looking around.** Drag to turn the room, scroll or pinch to zoom, and drag with the right button or with two fingers to move the view. With the keyboard, Tab to the view: the arrow keys turn it, + and - zoom, and Shift with an arrow key moves it. **Reset view** puts the camera back at the start.
- **Camera.** It starts in front of and above the room, far enough away that the whole room, and any furniture that sticks out of it, is in the frame, whatever the room's shape and the shape of the window (`defaultView` in `camera-view.ts`). It cannot go below the floor or closer than 1 m to the point it looks at, it cannot go farther than 2.5 times its starting distance, and the point it looks at stays inside the room, so the room cannot be lost.
- **Drawing.** The room is drawn only when something changes (the camera moves or the window changes size), so a room at rest uses no graphics power.
- **No WebGL.** If the browser cannot make a WebGL context, the step says that the 3D view could not start, and the room description and the way back stay.
- **Tests.** The room's geometry, the camera maths and the arrangement of the furniture are unit tests (`camera-view.test.ts`, `room-scene.test.ts`, `arrangement.test.ts`), and the furniture is built, scaled, turned and painted from the real library files (`furniture-scene.test.ts`, `appearance.test.ts`): all 15 models are put at ten turns and their footprints compared with the ones of the footprint check, and the backrest of a seat and the handles of a drawer are looked for on the side that the pose says. The step and the view are tested with a fake viewer (`room-3d-view.test.tsx`, `room-planner.test.tsx`), and the buttons that choose the layout on their own and in the step (`layout-switcher.test.tsx`, and the "buttons under the 3D view" block of `room-planner.test.tsx`). The colour reader is tested on the words of the colours (`colour.test.ts`: hue, lightness and saturation, never an exact value), on the 180 real answers of the AI, and on text that is not a colour at all, and it never throws. The viewer is tested with a fake renderer, because jsdom has no WebGL (`room-viewer.test.ts`), so what is really drawn has to be checked in a browser.

## Overlapping furniture

US-18 is research: how to stop a layout from putting a piece of furniture in another one or through a wall. The notes and the decision are in `docs/overlap-avoidance.md`. In short, and what US-19 and US-22 do: ask the AI in the prompt to leave gaps, check every answer in code, and fix what the check finds in code (push the pieces apart, then look for the nearest free place for any that are still wrong), in three attempts; if that does not work the layout is not shown, and the app says so ("Layout generation", below). A grid and "check, then ask the AI again" were tried and not chosen.

- **The footprint check** is `src/shared/footprint.ts`. A piece is a rectangle on the floor: `x_m` and `z_m` (the middle of the piece, as the 3D room has it), `width_m` and `depth_m`, and `rotation_deg`, which is 0 for a piece facing the front of the room (+z) and turns the front towards +x for a positive angle, as `rotation.y` does in Three.js (a test compares the two). `overlap(a, b, gap)` says how deep two footprints are in each other and which way to push them apart (`null` if they are apart or only touch), `overlapArea(a, b)` how much floor they share, and `outsideRoom(footprint, room, wallGap)` how far a piece sticks out of the room. A rug is the one piece that may lie under others, which is for the code that uses these functions to allow.
- **The approaches that were tried** are in `scripts/overlap-approaches.ts`: `findProblems` (the check on a whole layout), `repair`, `placeNearest`, `placeOnGrid`, and `perturb`, which makes layouts that are nearly right. They are research code, tested in `overlap-approaches.test.ts`. The ones that were chosen are the code of the app in `src/shared/layout-fix.ts` (US-19, below); the research script keeps its own copies, so that the tables can be made again as they were.
- **Running the research again.** `npm run overlaps` takes about half a minute and calls no AI. It runs the approaches on the three sample rooms of `docs/overlap-research/samples.json`, on random layouts and on fuller rooms, and prints the tables of the notes. `npm run overlaps -- --samples <file>` uses other rooms and layouts in the same form, for example answers of the real AI once there are some, and `-- --runs 1000 --seed 7` makes other random layouts.

## Layout generation

`generateLayout(description, generate, { style })` in `src/ai/layout.ts` asks Gemini to arrange the furniture of a confirmed room description and returns a position and a rotation for every piece, and `generateLayouts` in `src/ai/layouts.ts` does it in three styles at once (US-21). The 3D room step has a **Generate layouts** button under the 3D view, which calls them through `POST /api/layout` (below) and shows a card for each style: its name, the idea of the layout and, folded away, a table of where each piece goes. A **Show in the 3D room** button on each card chooses which layout the 3D view above shows (US-20, "A layout" under "3D room"), and so do the buttons right under the 3D view (US-23, "Choosing the layout" under "3D room"); the first one that worked is shown to begin with.

- **A layout** is a list of poses in the order of the furniture list: `{ x_m, z_m, rotation_deg }` (`Pose` in `src/shared/layout.ts`). `x_m` and `z_m` are the middle of the piece's footprint in metres from the middle of the room, x towards the right wall and z towards the front wall; `rotation_deg` is the way its front faces: 0 the front wall, 90 the right wall, 180 the back wall, 270 the left wall, and anything in between for a piece that is angled. The size of a piece is not in the layout: it is in the furniture list.
- **The question.** `buildLayoutPrompt` (`src/ai/layout-prompt.ts`) tells the model the room, each piece (its number, type and the size of its footprint) and what the three numbers mean, with a worked example in the numbers of this room. It gives the rules (every piece inside the room, nothing overlapping except on a rug, 10 cm between pieces, each piece once) and how a designer arranges the 15 types: big pieces against the walls, the sofa facing the TV stand, the nightstands beside the bed, and so on. Colours and materials are not in it: they say nothing about where a piece goes. The call has no photos, and the model must answer in the shape of a JSON schema.
- **Three styles (US-21 AC1).** `LAYOUT_STYLES` in `src/shared/layout-styles.ts` are Spacious, Cosy and Work-focused, in that order. Each is a different idea of the same room, written into the prompt as a brief (`STYLE_BRIEFS` in `layout-prompt.ts`): open and along the walls with the middle free; grouped close around a focal point; or a work zone apart from a rest zone (with a table instead of a desk when the list has none). The names are fixed in code. The description of each layout (AC2), one or two sentences, is written by the model in its answer (the schema that Gemini is sent requires it for a layout in a style; `cleanDescription`: one line, the first two sentences, or the first alone if the two are over 300 characters); when the answer has none that can be used (the server logs a warning then, so that the real answers show why) the layout gets the idea of its style (`STYLE_IDEAS`), which costs no second call.
- **Clearly different (US-21 AC3).** A piece is in a different place in two layouts when its middle is at least 50 cm from where it is in the other (`isDifferentPlace`; turning a piece where it stands does not count), and a layout is clearly different when at least half of its pieces are in a different place than in *each* of the others (`isDifferentEnough`; 2 of 3, 3 of 5, 1 of 1). The three styles are asked for at the same time and cannot see each other, so each prompt names the other styles and asks for this, and the answers are checked afterwards. A layout that is too much like the others is made once more, in the same request, told where the others put the pieces (the weakest, which has the fewest pieces in places of its own; the later style if they are equal), and if it is still too much like them it has failed with `too_similar`. Only one layout is made again in a request, whatever the number that are alike. A layout that is made again on its own is shown the layouts that are already made from the first try, and has no second one.
- **Each style on its own (US-21 AC4).** The browser makes one request and the server makes the styles at the same time (one `generateLayout` each, with one count of the session's calls that all of them share, so the cookie does not race). A style that fails does not take the others with it: the answer has a result for each style, with the message for the one that failed (`invalid_answer`, `layout_has_overlaps`, `too_similar`, `ai_unavailable` or `limit_reached`), as long as at least one has a layout. The page shows the layouts that worked and, in the card of the one that did not, the message and a **Try again** button, which asks for that style alone and sends the layouts that worked so that the new one differs from them. The others stay as they are, and so does what the 3D room shows.
- **Every piece exactly once (AC2).** `parseLayoutAnswer` (`src/ai/layout-schema.ts`) checks the answer against the list: an entry for each piece, with the number and the type of that piece, no number twice, none missing and none extra. The poses come out in the order of the list, whatever the order of the answer, rounded to a millimetre and a tenth of a degree. What is wrong is said in a sentence ("Piece 2 (sofa) is not in the answer.").
- **One retry (AC3).** If the answer is not JSON, has the wrong shape or is not the right pieces, the model is asked once more, and told what was wrong with the first answer. If the second answer is not usable either, a `LayoutError` is thrown, the endpoint answers `502 invalid_answer`, and the page shows a message and keeps the layout and the room it had. Errors of the call itself (network, bad key) are not retried.
- **Overlaps are checked and fixed in three attempts, not asked again (US-22).** An answer that has the right pieces is checked in code (`findProblems` in `src/shared/layout-fix.ts`: every pair of pieces except a rug under another piece, and every piece against the walls, each turned as it is turned; AC1). If a piece is in another or through a wall, `fixLayout` fixes it in code, as US-18 decided, in at most three attempts (`FIX_ATTEMPTS`; AC2). Each attempt pushes the pieces that overlap apart (`repair`), then looks for the nearest free place for any that are still wrong (`placeNearest`, the biggest piece first), and asks less of the room than the one before: the first aims for 3 cm between pieces and 2 cm to a wall, the second for 1 cm and none, the third for pieces that touch, which a room that is too full may need. A piece at an angle takes more room than one at a quarter turn, so an attempt that does not work with the turns as the AI gave them is made once more with every turn made the nearest quarter turn, before the next attempt: nothing else turns a piece, and that is only done when the turns as they are do not work. The first attempt that makes the layout fine is the one that is used; a layout that was fine to begin with is left exactly as it is, with no attempt (`FixResult.attempts` is 0, 1, 2 or 3). The pieces that moved more than half a centimetre or turned more than a degree are listed under the table.
- **A layout that cannot be fixed is not shown (US-22 AC3).** If the third attempt has not made the layout fine, `LayoutOverlapError` is thrown and nothing of that layout goes to the browser: no places, and not what the AI said about it. The style has a message in its card with a **Try again** button ("The Cosy layout still had furniture overlapping, or sticking out of the room, after 3 attempts to fix it, so it is not shown. Try again, or check the size of the room and of the furniture."), the other styles stay, and the 3D room shows the first layout that worked. If no style has a layout the endpoint answers `502 layout_has_overlaps` and the page keeps what it had. The attempts are fixes in code and not asks of the AI: AC2 allows either, and an ask is a paid call of the session's limit that can take two minutes, for a mistake that fixing mends in a millisecond (the research: asking again lifted a layout's chance of having no overlap from 31% to 52% at best). The AI is asked again when the user presses Try again, which is the "button to retry" of the criterion; the new answer is told where the other layouts put their pieces, as for any style made again.
- **How well the fixing works.** On answers that are nearly right (every piece off by 5 to 50 cm, a tenth of the pieces a quarter the wrong way, a tenth at an angle, one in twenty put anywhere at all; 300 answers for each of four rooms, `layout-fix-random.test.ts`) it made every layout fine in the living room and the bedroom (22% and 39% of the floor, nearly all in the first attempt), 94% to 96% in the crowded studio (58%) and 89% to 92% in a crowded bedroom of 3 m x 2.6 m (63%), where the second and third attempts make about 12 and 30 of the 300 fine that the first cannot. The rest are the layouts of this last kind: the room could hold the pieces, but not from where the answer put them. Every layout that `fixLayout` calls fine is looked at again by two checks that share no code with it (the exact area that two pieces have in common, and where Three.js puts the corners and a grid of points of each piece, which is how the 3D room stands them), and none had a piece in another or through a wall. The page warns from 60% of the floor, and a layout is refused before the AI is asked from 70% (below). These are answers made by a random generator and not the real AI's: the real AI has made one layout so far (Nov 11), which is too little to say how often its answers need fixing, or how big its mistakes are.
- **A room that is too full.** A piece that is bigger than the room whichever way it is turned, or pieces that cover over 70% of the floor (a rug does not count, since it lies under others), are refused before the AI is asked, with a sentence that says why (`whyNoLayoutIsPossible`, `422 room_too_full`). No AI call is used. From 60% the page warns that a layout may not be possible. The numbers come from the research: no approach found a layout without overlaps at 70% and over.
- **Loading, and the limit.** While the layouts are made the button says "Generating…" with a spinner, and the page says that it can take a minute or two. Each call has a deadline of its own, 120 s by default (`GEMINI_LAYOUT_TIMEOUT_S`): on the first real runs two of three layout calls did not finish in 60 s, and Gemini answered `504 DEADLINE_EXCEEDED`, since the SDK sends the timeout to the server as its deadline. A call that runs out of time fails that style with `timed_out` ("The AI took too long to make the Cosy layout"), which is not told as the service being down, and is not retried, since it would take as long again. The browser gives up after 10 minutes, which only keeps a request from hanging: two rounds of up to two calls of 150 s at most each fit in that. Every call to the model counts towards the session's limit, so a click makes **three calls at least**, one for each style, and more if an answer cannot be used (2 for that style) or a layout has to be made again (1 or 2 more). With the default limit of 10 calls a session has room for about two clicks after a detection: raise `AI_CALL_LIMIT` for more. A style that runs into the limit while the others are made fails with `limit_reached`, and the layouts that were made are kept. The page shows how many calls have been used.
- **The layouts stay** while the user goes between the steps, and a request that is on its way goes on. They are dropped when what they were made for changes, which is the types and sizes of the furniture and the floor of the room (`layoutKey` in `src/shared/layout.ts`), since they would no longer fit. A change of colour, material or height keeps them, because a layout does not depend on them. A request that fails changes nothing, and a new set of three replaces the old and shows its first layout, while one style made again leaves what is shown as it is. The layouts, and which one is shown, belong to the 3D room step (`Room3DStep`, `src/components/room-3d-step.tsx`), which holds them for the box and the 3D view; the page gives that step a `key` made from `layoutKey`, so a new step starts, with no layouts, when the key changes. A layout is never shown for furniture it was not made for, and an answer that was still on its way is lost with the old step.
- **At most 40 pieces** (`MAX_LAYOUT_PIECES`): a room has far fewer, and the work of fixing grows with the square of the number.
- **Trying it.** `npm run layout` makes the three layouts of a sample room with real, paid calls (three, or more) and prints each with a check of it and how many of its pieces are in a place of their own. `npm run layout -- --style cosy` makes one style only, `-- room.json` uses your own room, `-- --prompt` prints what is sent to the AI for each style without calling it, and `-- --demo` shows the fixing on the "flawed" layout of the overlap research, also without a call.
- **Tests.** The checks and the fixing are unit tests (`layout.test.ts`, `layout-fix.test.ts`, `layout-styles.test.ts` and `layouts-request.test.ts` in `src/shared/`), and `layout-fix-random.test.ts` looks again at what the fixing calls fine, on random answers, with checks of its own. A crowded bedroom, for that and for the tests of a layout that cannot be fixed, is in `src/test/crowded-room.ts`. The prompt, the check of the answer, the retry and the three styles with a fake model (`src/ai/`, `layouts.test.ts` for the three at once, with how many pieces differ in each layout controlled exactly) are unit tests as well, and so are the endpoint and the client with fakes (`layout-handler.test.ts`, `layout-client.test.ts`) and the page (`layout-generator.test.tsx`, `room-3d-view.test.tsx`, `room-planner.test.tsx`). No test calls the real AI.

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Gemini API key. Server-side only; never expose it to the browser |
| `GEMINI_MODEL` | No | Gemini model name (default `gemini-3.1-pro-preview`) |
| `AI_CALL_LIMIT` | No | AI calls one browser session may make (default `10`). `0` turns AI calls off |
| `GEMINI_LAYOUT_TIMEOUT_S` | No | How long one layout call may take, in seconds (default `120`, from `10` to `150`; anything else is the default). Detection has 60 s. A call that runs out of time is a `timed_out`, and is not retried |

Secrets live in `.env.local`, which is git-ignored.

## API

The browser never talks to Gemini. Every AI call goes through a route on this server, which holds the API key.

### `POST /api/detect`

Send the photos of one room as form data, one `photo` field for each: 1 to 5 JPG, PNG or WebP photos, up to 10 MB each and 14 MB together. They are analysed in one AI call. The answer is the furniture found, plus how many AI calls the session has used. The page shrinks every photo to 1568 px before sending, which keeps a request far below the 20 MB Gemini accepts:

```json
{
  "items": [{ "label": "sofa", "width_cm": 200, "depth_cm": 90, "height_cm": 85, "color": "dark grey", "material": "fabric" }],
  "unsupported": 0,
  "calls": { "used": 1, "limit": 10 }
}
```

A failure has the form `{ "error": { "code", "message" }, "calls": { "used", "limit" } }`. The `message` is safe to show to the user; provider errors and keys only go to the server log. The types are in `src/shared/api.ts`.

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_photo` | No photo, more than 5, an unsupported type, or an empty file |
| 413 | `photo_too_large` | A photo over 10 MB, or more than 14 MB in total |
| 429 | `limit_reached` | The session has used all its AI calls. Nothing was sent to Gemini |
| 500 | `server_misconfigured` | No API key on the server |
| 502 | `invalid_answer` | Gemini's answer was invalid twice in a row |
| 503 | `ai_unavailable` | The call to Gemini failed (network, quota, outage) |

### `POST /api/layout`

Send a room description as JSON, in `description` (the room size and the furniture list, as under "Room description"; at most 40 pieces, and 64 KB for the whole request), and optionally the `styles` to make (`"spacious"`, `"cosy"`, `"work"`; all three, in that order, if there are none) and, when one style is made again, the layouts that are `existing` already, which the new one has to differ from:

```json
{
  "description": { "room": { "width_m": 4, "length_m": 5, "height_m": 2.5 }, "furniture": [ … ] },
  "styles": ["cosy"],
  "existing": [{ "style": "spacious", "poses": [{ "x_m": 0, "z_m": -1.8, "rotation_deg": 0 }, …] }]
}
```

The answer has a result for each style that was asked for, in the order it was asked for, as long as one of them is a layout. A layout has the name of its style, a description of its idea in a sentence or two, a position and a rotation for every piece in the order of the furniture list, and the pieces the app had to move or turn a little to keep them from overlapping (by their place in the list). A style that has no layout has a message for the user and a `code`, and the others are not held back by it. `calls` is how many AI calls the session has used:

```json
{
  "results": [
    { "style": "spacious", "ok": true, "name": "Spacious", "description": "Everything stands along the walls.", "poses": [{ "x_m": 0, "z_m": -1.8, "rotation_deg": 0 }, …], "adjusted": [1] },
    { "style": "cosy", "ok": false, "name": "Cosy", "code": "too_similar", "message": "The Cosy layout was too much like the others: only 1 of 4 pieces was in a different place, and at least 2 are needed." },
    { "style": "work", "ok": true, "name": "Work-focused", "description": "…", "poses": [ … ], "adjusted": [] }
  ],
  "calls": { "used": 4, "limit": 10 }
}
```

The `code` of a style that has no layout is `invalid_answer`, `layout_has_overlaps`, `too_similar`, `limit_reached`, `timed_out` or `ai_unavailable`. When **no** style has a layout the answer is a failure, in the form above. Everything is checked before the AI is asked, and the AI is not asked at all for a request that fails one of the first four checks:

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not a valid request: the room description is not valid or has more than 40 pieces, a style is unknown or asked for twice, or a layout that is already made does not fit the list. The message says what is wrong |
| 413 | `invalid_description` | The body is over 64 KB |
| 422 | `room_too_full` | A piece is bigger than the room, or the pieces cover over 70% of the floor. Nothing was sent to Gemini |
| 429 | `limit_reached` | The session has used all its AI calls, or every style ran into the limit. Nothing more was sent to Gemini |
| 500 | `server_misconfigured` | No API key on the server |
| 502 | `invalid_answer` | Gemini's answers were not usable layouts twice in a row, for every style |
| 502 | `layout_has_overlaps` | The layouts were fine in shape, but pieces still overlapped or went through a wall after the 3 attempts to fix them. None of those layouts is sent. With one style asked for, the message names it |
| 502 | `too_similar` | The one style that was made again was too much like the layouts that are already made |
| 503 | `ai_unavailable` | The calls to Gemini failed (network, quota, outage) |
| 504 | `timed_out` | The calls to Gemini did not answer within the deadline of a layout call, for every style that has no other cause |

## AI usage limit

Each browser session may make 10 AI calls (change it with `AI_CALL_LIMIT`).

- Every call to Gemini counts, including a retry: a detection or a layout whose first answer was invalid uses 2. All the photos of a room go in one call, so five photos cost the same as one, and a layout is one call for the whole room: a set of three layouts is three calls at least, one for each style. A call is counted before it is sent, so one that fails still counts. A layout that is refused before the AI is asked (a room that is too full) does not count.
- When the limit is reached the server answers `429` and sends nothing to Gemini. If the limit runs out between a first call and its retry, the retry is not sent.
- The count lives in an HttpOnly cookie (`ai_calls`) that ends with the browser session. It protects against accidents, such as a bug that loops or heavy use by one person. It does not stop someone who deletes the cookie, and requests sent in parallel can overshoot by a call or two.

The real safety net is a spend cap on the Google project that owns the API key. In [Google AI Studio](https://aistudio.google.com/spend) open the Spend page, choose **Monthly spend cap**, then **Edit spend cap** and enter a monthly limit (you need the project editor, owner or admin role). Google marks this feature as experimental and enforces it with a delay of up to about 10 minutes, so treat it as a soft cap. See the [Gemini API billing docs](https://ai.google.dev/gemini-api/docs/billing).
