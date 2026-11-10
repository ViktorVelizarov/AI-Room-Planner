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
| `src/components/` | UI components: the four-step flow (photos, room size, your room, 3D room), the photo uploader, the room size form, the furniture editor, the room description view, the 3D room view and the layout generator |
| `src/client/` | Browser-only helpers: shrinking photos before upload and calling the API |
| `src/ai/` | AI code: furniture detection and layout generation. Server-side only |
| `src/viewer/` | 3D rendering code: the 3D room with its furniture, the camera and its controls, and the loading of the furniture models. Browser only |
| `src/server/` | Server-only logic behind the API routes: the AI call limit and the request handlers |
| `src/shared/` | Types and rules used by both browser and server, such as the supported furniture labels and their typical sizes, photo rules, room size limits, the room description, the furniture library index, the footprint check for overlapping furniture, the layout (its checks and the fixing of overlaps) and the API response types |
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

The "3D room" step shows the room in the size the user entered, with the user's furniture in it, drawn with Three.js (`three`, with its types in `@types/three`). The drawing code is in `src/viewer/` and does not use React; `src/components/room-3d-view.tsx` is the thin wrapper that puts it in the page. The 3D code is loaded when the user reaches this step, not with the page.

- **Axes.** One unit is one metre. The origin is the middle of the floor, and y points up from the floor. x runs along the width and z along the length, so the room fills x from minus half the width to plus half the width, y from 0 to the height, and z from minus half the length to plus half the length. For a room 6 m wide, 4.5 m long and 2.5 m high that is x from -3 to 3, y from 0 to 2.5 and z from -2.25 to 2.25. Seen from above with x to the right, z runs down the screen, as in the outline in the "Your room" step. The front of the room is the side where z is largest, which is the side the camera starts on. A piece of furniture stands on the floor, so a layout places it by x and z alone, measured from the middle of the room on these axes: the position of a piece is the middle of its footprint, and `rotation_deg` says which way it faces (see "Layout generation"). The 3D room does not show a layout yet (US-20).
- **Walls.** Every wall faces into the room and is drawn on that side only. From outside, the walls nearest the camera face away from it and are not drawn, so they never hide the room; from inside, all four are drawn. Lines show the edges of the room, and the floor has a line every metre, counted from the corner so that the squares along a wall can be counted against the real room.
- **Furniture.** Each piece of the user's list is shown as its model from the furniture library, stretched to the piece's width, depth and height and standing on the floor. Until a layout is made, the pieces are lined up by `arrangeInRows` (`src/viewer/arrangement.ts`): in the order of the list, side by side along the back wall from the left, 10 cm from the walls and 15 cm apart, with a new row in front when one is full. They all face the front. A piece wider than the room has a row to itself, and if the furniture does not fit the room the rows go on past the front wall; the starting view then includes whatever sticks out, so nothing is cut off.
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
- **Tests.** The room's geometry, the camera maths and the arrangement of the furniture are unit tests (`camera-view.test.ts`, `room-scene.test.ts`, `arrangement.test.ts`), and the furniture is built, scaled and painted from the real library files (`furniture-scene.test.ts`, `appearance.test.ts`). The colour reader is tested on the words of the colours (`colour.test.ts`: hue, lightness and saturation, never an exact value), on the 180 real answers of the AI, and on text that is not a colour at all, and it never throws. The viewer is tested with a fake renderer, because jsdom has no WebGL (`room-viewer.test.ts`), so what is really drawn has to be checked in a browser.

## Overlapping furniture

US-18 is research: how to stop a layout from putting a piece of furniture in another one or through a wall. The notes and the decision are in `docs/overlap-avoidance.md`. In short, and what US-19 does: ask the AI in the prompt to leave gaps, check every answer in code, and fix what the check finds in code (push the pieces apart, then look for the nearest free place for any that are still wrong); if that does not work the room is too full, and the app says so. A grid and "check, then ask the AI again" were tried and not chosen.

- **The footprint check** is `src/shared/footprint.ts`. A piece is a rectangle on the floor: `x_m` and `z_m` (the middle of the piece, as the 3D room has it), `width_m` and `depth_m`, and `rotation_deg`, which is 0 for a piece facing the front of the room (+z) and turns the front towards +x for a positive angle, as `rotation.y` does in Three.js (a test compares the two). `overlap(a, b, gap)` says how deep two footprints are in each other and which way to push them apart (`null` if they are apart or only touch), `overlapArea(a, b)` how much floor they share, and `outsideRoom(footprint, room, wallGap)` how far a piece sticks out of the room. A rug is the one piece that may lie under others, which is for the code that uses these functions to allow.
- **The approaches that were tried** are in `scripts/overlap-approaches.ts`: `findProblems` (the check on a whole layout), `repair`, `placeNearest`, `placeOnGrid`, and `perturb`, which makes layouts that are nearly right. They are research code, tested in `overlap-approaches.test.ts`. The ones that were chosen are the code of the app in `src/shared/layout-fix.ts` (US-19, below); the research script keeps its own copies, so that the tables can be made again as they were.
- **Running the research again.** `npm run overlaps` takes about half a minute and calls no AI. It runs the approaches on the three sample rooms of `docs/overlap-research/samples.json`, on random layouts and on fuller rooms, and prints the tables of the notes. `npm run overlaps -- --samples <file>` uses other rooms and layouts in the same form, for example answers of the real AI once there are some, and `-- --runs 1000 --seed 7` makes other random layouts.

## Layout generation

`generateLayout(description)` in `src/ai/layout.ts` asks Gemini to arrange the furniture of a confirmed room description and returns a position and a rotation for every piece. The 3D room step has a **Generate layout** button under the 3D view, which calls it through `POST /api/layout` (below) and lists the result in a table. The 3D view does not show the layout yet (US-20).

- **A layout** is a list of poses in the order of the furniture list: `{ x_m, z_m, rotation_deg }` (`Pose` in `src/shared/layout.ts`). `x_m` and `z_m` are the middle of the piece's footprint in metres from the middle of the room, x towards the right wall and z towards the front wall; `rotation_deg` is the way its front faces: 0 the front wall, 90 the right wall, 180 the back wall, 270 the left wall, and anything in between for a piece that is angled. The size of a piece is not in the layout: it is in the furniture list.
- **The question.** `buildLayoutPrompt` (`src/ai/layout-prompt.ts`) tells the model the room, each piece (its number, type and the size of its footprint) and what the three numbers mean, with a worked example in the numbers of this room. It gives the rules (every piece inside the room, nothing overlapping except on a rug, 10 cm between pieces, each piece once) and how a designer arranges the 15 types: big pieces against the walls, the sofa facing the TV stand, the nightstands beside the bed, and so on. Colours and materials are not in it: they say nothing about where a piece goes. The call has no photos, and the model must answer in the shape of a JSON schema.
- **Every piece exactly once (AC2).** `parseLayoutAnswer` (`src/ai/layout-schema.ts`) checks the answer against the list: an entry for each piece, with the number and the type of that piece, no number twice, none missing and none extra. The poses come out in the order of the list, whatever the order of the answer, rounded to a millimetre and a tenth of a degree. What is wrong is said in a sentence ("Piece 2 (sofa) is not in the answer.").
- **One retry (AC3).** If the answer is not JSON, has the wrong shape or is not the right pieces, the model is asked once more, and told what was wrong with the first answer. If the second answer is not usable either, a `LayoutError` is thrown, the endpoint answers `502 invalid_answer`, and the page shows a message and keeps the layout and the room it had. Errors of the call itself (network, bad key) are not retried.
- **Overlaps are fixed, not asked again.** An answer that has the right pieces but puts one in another, or through a wall, is not worth a second paid call for a small mistake. `fixLayout` (`src/shared/layout-fix.ts`) fixes it in code, as US-18 decided: it pushes the pieces that overlap apart (`repair`), then looks for the nearest free place for any that are still wrong (`placeNearest`, the biggest piece first), aiming for 3 cm between pieces and 2 cm to a wall. If the room is too full for that it aims for 1 cm and then for none, and as a last resort it turns pieces that are angled to the nearest quarter turn. A layout that is fine is left exactly as it is. The pieces that moved more than half a centimetre or turned more than a degree are listed under the table. If nothing makes the layout fine, `LayoutOverlapError` gives `502 layout_has_overlaps`.
- **A room that is too full.** A piece that is bigger than the room whichever way it is turned, or pieces that cover over 70% of the floor (a rug does not count, since it lies under others), are refused before the AI is asked, with a sentence that says why (`whyNoLayoutIsPossible`, `422 room_too_full`). No AI call is used. From 60% the page warns that a layout may not be possible. The numbers come from the research: no approach found a layout without overlaps at 70% and over.
- **Loading, and the limit (AC4).** While the layout is made the button says "Generating…" with a spinner, and the page says that it can take up to a minute. Every call to the model counts towards the session's limit (a layout whose first answer cannot be used makes 2 calls), and the page shows how many calls have been used.
- **The layout stays** while the user goes between the steps, and a request that is on its way goes on. It is dropped when what it was made for changes, which is the types and sizes of the furniture and the floor of the room (`layoutKey` in `src/shared/layout.ts`), since it would no longer fit. A change of colour, material or height keeps it, because a layout does not depend on them. A layout that fails changes nothing.
- **At most 40 pieces** (`MAX_LAYOUT_PIECES`): a room has far fewer, and the work of fixing grows with the square of the number.
- **Trying it.** `npm run layout` makes one real, paid request for a sample room and prints the poses and a check of them. `npm run layout -- --prompt` prints what is sent to the AI without calling it, and `-- --demo` shows the fixing on the "flawed" layout of the overlap research, also without a call.
- **Tests.** The checks and the fixing are unit tests (`layout.test.ts` and `layout-fix.test.ts` in `src/shared/`), as are the prompt, the check of the answer and the retry with a fake model (`src/ai/`), the endpoint and the client with fakes (`layout-handler.test.ts`, `layout-client.test.ts`) and the page (`layout-generator.test.tsx`, `room-planner.test.tsx`). No test calls the real AI.

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Gemini API key. Server-side only; never expose it to the browser |
| `GEMINI_MODEL` | No | Gemini model name (default `gemini-3.1-pro-preview`) |
| `AI_CALL_LIMIT` | No | AI calls one browser session may make (default `10`). `0` turns AI calls off |

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

Send a room description as JSON (the room size and the furniture list, as under "Room description"; at most 40 pieces and 64 KB). The answer is a position and a rotation for every piece, in the order of the furniture list, which pieces the app had to move or turn a little to keep them from overlapping (by their place in the list), and how many AI calls the session has used:

```json
{
  "layout": [
    { "x_m": 0, "z_m": -1.8, "rotation_deg": 0 },
    { "x_m": 0.5, "z_m": 0.35, "rotation_deg": 180 }
  ],
  "adjusted": [1],
  "calls": { "used": 1, "limit": 10 }
}
```

A failure has the same form as above. Everything is checked before the AI is asked, and the AI is not asked at all for a request that fails one of the first four checks:

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_description` | The body is not a valid room description, or has more than 40 pieces. The message says what is wrong |
| 413 | `invalid_description` | The body is over 64 KB |
| 422 | `room_too_full` | A piece is bigger than the room, or the pieces cover over 70% of the floor. Nothing was sent to Gemini |
| 429 | `limit_reached` | The session has used all its AI calls. Nothing was sent to Gemini |
| 500 | `server_misconfigured` | No API key on the server |
| 502 | `invalid_answer` | Gemini's answer was not a usable layout twice in a row |
| 502 | `layout_has_overlaps` | The layout was fine in shape, but pieces still overlapped or went through a wall after the app tried to fix it |
| 503 | `ai_unavailable` | The call to Gemini failed (network, quota, outage) |

## AI usage limit

Each browser session may make 10 AI calls (change it with `AI_CALL_LIMIT`).

- Every call to Gemini counts, including a retry: a detection or a layout whose first answer was invalid uses 2. All the photos of a room go in one call, so five photos cost the same as one, and a layout is one call for the whole room. A call is counted before it is sent, so one that fails still counts. A layout that is refused before the AI is asked (a room that is too full) does not count.
- When the limit is reached the server answers `429` and sends nothing to Gemini. If the limit runs out between a first call and its retry, the retry is not sent.
- The count lives in an HttpOnly cookie (`ai_calls`) that ends with the browser session. It protects against accidents, such as a bug that loops or heavy use by one person. It does not stop someone who deletes the cookie, and requests sent in parallel can overshoot by a call or two.

The real safety net is a spend cap on the Google project that owns the API key. In [Google AI Studio](https://aistudio.google.com/spend) open the Spend page, choose **Monthly spend cap**, then **Edit spend cap** and enter a monthly limit (you need the project editor, owner or admin role). Google marks this feature as experimental and enforces it with a delay of up to about 10 minutes, so treat it as a soft cap. See the [Gemini API billing docs](https://ai.google.dev/gemini-api/docs/billing).
