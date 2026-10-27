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

## Project structure

| Folder | Purpose |
| --- | --- |
| `src/app/` | Pages and API routes (Next.js App Router) |
| `src/components/` | UI components: the four-step flow (photos, room size, your room, 3D room), the photo uploader, the room size form, the furniture editor and the room description view |
| `src/client/` | Browser-only helpers: shrinking photos before upload and calling the API |
| `src/ai/` | AI code: furniture detection and layout generation. Server-side only |
| `src/viewer/` | 3D rendering code: room scene, furniture models. Browser only |
| `src/server/` | Server-only logic behind the API routes: the AI call limit and the request handlers |
| `src/shared/` | Types and rules used by both browser and server, such as the supported furniture labels and their typical sizes, photo rules, room size limits, the room description and the API response types |
| `scripts/` | Command-line tools, such as `detect.ts` |

`src/ai/` and `src/viewer/` must not import from each other, so each can be run and tested on its own. Both may import from `src/shared/`.

## Furniture detection

`detectFurniture(images)` in `src/ai/` sends the photos of one room to Gemini in a single call and returns the furniture it found, with a piece that appears in several photos listed once: type (one of 15 supported labels), size in cm (width, depth, height), main colour and main material. It never returns positions; those come from the layout step later.

- The answer is validated against a schema. If it is invalid or incomplete, the model is asked once more; if the second answer is also invalid, a `DetectionError` is thrown and no data is used.
- Things the model labels `other` (not a supported type) are left out of the result.
- Errors from the call itself (no network, bad key) are not retried.

## Room description

The room description is the one piece of data the rest of the app builds on: the room size and the furniture list, together. The 3D room reads it, and so will the layout generator. It is made when the user presses **Continue to 3D room** on the "Your room" step, from the size and the furniture list as the user confirmed them.

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
- Until the 3D room is built, its step shows the description as JSON (`RoomDescriptionView`), which is the debug view.

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

## AI usage limit

Each browser session may make 10 AI calls (change it with `AI_CALL_LIMIT`).

- Every call to Gemini counts, including a retry: a detection whose first answer was invalid uses 2. All the photos of a room go in one call, so five photos cost the same as one. A call is counted before it is sent, so one that fails still counts.
- When the limit is reached the server answers `429` and sends nothing to Gemini. If the limit runs out between a detection's first call and its retry, the retry is not sent.
- The count lives in an HttpOnly cookie (`ai_calls`) that ends with the browser session. It protects against accidents, such as a bug that loops or heavy use by one person. It does not stop someone who deletes the cookie, and requests sent in parallel can overshoot by a call or two.

The real safety net is a spend cap on the Google project that owns the API key. In [Google AI Studio](https://aistudio.google.com/spend) open the Spend page, choose **Monthly spend cap**, then **Edit spend cap** and enter a monthly limit (you need the project editor, owner or admin role). Google marks this feature as experimental and enforces it with a delay of up to about 10 minutes, so treat it as a soft cap. See the [Gemini API billing docs](https://ai.google.dev/gemini-api/docs/billing).
