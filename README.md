# AI Room Layout Generator

Upload photos of your room, let AI find the furniture, and see new layouts in a 3D room. Built with Next.js, TypeScript and Gemini.

## Setup

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Before using any AI feature, copy `.env.example` to `.env.local` and put your Gemini API key in it.

Open <http://localhost:3000>. The placeholder page should load without errors.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (also type-checks) |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint |

## Project structure

| Folder | Purpose |
| --- | --- |
| `src/app/` | Pages and API routes (Next.js App Router) |
| `src/ai/` | AI code: furniture detection and layout generation. Server-side only |
| `src/viewer/` | 3D rendering code: room scene, furniture models. Browser only |

`src/ai/` and `src/viewer/` must not import from each other, so each can be run and tested on its own.

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Gemini API key. Server-side only; never expose it to the browser |
| `GEMINI_MODEL` | No | Gemini model name (default `gemini-3.1-pro-preview`) |

Secrets live in `.env.local`, which is git-ignored.
