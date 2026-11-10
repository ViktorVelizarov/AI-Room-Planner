// Tries the ways of stopping furniture from overlapping (US-18) on the sample rooms of
// docs/overlap-research/samples.json and prints what happens, as tables that go into
// docs/overlap-avoidance.md. Nothing here calls an AI, so it costs nothing and gives the same
// numbers every time.
//
//   npm run overlaps                          the samples in the docs folder, in about half a minute
//   npm run overlaps -- --samples mine.json   other samples, in the same form (for example answers of the real AI)
//   npm run overlaps -- --runs 1000 --seed 7  more random layouts, or other ones
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findProblems,
  isRug,
  isValid,
  movement,
  perturb,
  placeNearest,
  placeOnGrid,
  random,
  repair,
  type Piece,
  type Pose,
  type Problems,
  type Room,
} from "./overlap-approaches";

type Sample = { name: string; room: Room; pieces: Piece[]; layouts: Record<"reference" | "baseline" | "gaps" | "flawed", Pose[]>; flaws?: string[] };

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const RUNS = Number(option("--runs", "300"));
/** The rooms that are too full make the search look everywhere, which takes long, so they get fewer layouts. */
const CROWDED_RUNS = Math.max(50, Math.round(RUNS / 3));
const SEED = Number(option("--seed", "1"));
const SAMPLES_FILE = option("--samples", join(process.cwd(), "docs", "overlap-research", "samples.json"));

/** How close pieces are allowed to be, for the check that wants gaps, and the gap that the repair leaves. */
const TIGHT_M = 0.05;
const REPAIR = { gap: 0.03, wallGap: 0.02 };

function load(file: string): Sample[] {
  const { samples } = JSON.parse(readFileSync(file, "utf8")) as { samples: Sample[] };
  for (const sample of samples) {
    for (const [name, poses] of Object.entries(sample.layouts)) {
      if (poses.length !== sample.pieces.length) throw new Error(`${sample.name}: the layout "${name}" has ${poses.length} poses for ${sample.pieces.length} pieces.`);
    }
  }
  return samples;
}

const table = (headers: string[], rows: (string | number)[][]) =>
  [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
const percent = (part: number, whole: number) => `${Math.round((100 * part) / whole)}%`;
const cm = (value: number) => (Math.round(value * 10) / 10).toString();
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/** The problems of a layout as a few words. */
const describe = (problems: Problems) => {
  const parts = [];
  if (problems.overlaps.length) parts.push(`${problems.overlaps.length} overlapping`);
  if (problems.outside.length) parts.push(`${problems.outside.length} outside`);
  return parts.length ? parts.join(", ") : "none";
};

type Attempt = { poses: Pose[]; ok: boolean; detail: string };
type Approach = { name: string; run: (sample: Sample, poses: Pose[]) => Attempt };

const valid = (sample: Sample, poses: Pose[]) => isValid(findProblems(sample.pieces, poses, sample.room));

/** The approaches that change the layout, as one function each. The first, the check alone, changes nothing. */
const APPROACHES: Approach[] = [
  { name: "check only", run: (sample, poses) => ({ poses, ok: valid(sample, poses), detail: "" }) },
  {
    name: "check and repair",
    run: (sample, poses) => {
      const result = repair(sample.pieces, poses, sample.room, REPAIR);
      return { poses: result.poses, ok: valid(sample, result.poses), detail: `${result.rounds} rounds` };
    },
  },
  {
    name: "check and search for a free place",
    run: (sample, poses) => {
      const result = placeNearest(sample.pieces, poses, sample.room, REPAIR);
      return { poses: result.poses, ok: result.unplaced.length === 0 && valid(sample, result.poses), detail: `${result.unplaced.length} without a place` };
    },
  },
  {
    name: "repair, then search",
    run: (sample, poses) => {
      const repaired = repair(sample.pieces, poses, sample.room, REPAIR);
      if (valid(sample, repaired.poses)) return { poses: repaired.poses, ok: true, detail: `${repaired.rounds} rounds` };
      const result = placeNearest(sample.pieces, repaired.poses, sample.room, REPAIR);
      return { poses: result.poses, ok: result.unplaced.length === 0 && valid(sample, result.poses), detail: `${repaired.rounds} rounds, then ${result.unplaced.length} without a place` };
    },
  },
  {
    name: "grid 25 cm, rounding only",
    run: (sample, poses) => {
      const result = placeOnGrid(sample.pieces, poses, sample.room, 0.25, { enforce: false });
      return { poses: result.poses, ok: result.unplaced.length === 0 && valid(sample, result.poses), detail: `${Math.round(result.wasted * 100)}% space lost` };
    },
  },
  {
    name: "grid 25 cm, one piece to a cell",
    run: (sample, poses) => {
      const result = placeOnGrid(sample.pieces, poses, sample.room, 0.25);
      return { poses: result.poses, ok: result.unplaced.length === 0 && valid(sample, result.poses), detail: `${Math.round(result.wasted * 100)}% space lost, ${result.unplaced.length} without a place` };
    },
  },
  {
    name: "grid 50 cm, one piece to a cell",
    run: (sample, poses) => {
      const result = placeOnGrid(sample.pieces, poses, sample.room, 0.5);
      return { poses: result.poses, ok: result.unplaced.length === 0 && valid(sample, result.poses), detail: `${Math.round(result.wasted * 100)}% space lost, ${result.unplaced.length} without a place` };
    },
  },
];

function trials(samples: Sample[]) {
  console.log("## Trials on the sample layouts\n");
  console.log("The references first: a layout that is fine must pass every check, with a gap of 2 cm to walls and pieces.\n");
  console.log(
    table(
      ["Room", "Problems", "Closer than 2 cm"],
      samples.map((sample) => [
        sample.name,
        describe(findProblems(sample.pieces, sample.layouts.reference, sample.room)),
        describe(findProblems(sample.pieces, sample.layouts.reference, sample.room, { gap: 0.02, wallGap: 0.02 })),
      ]),
    ),
  );

  for (const kind of ["baseline", "gaps", "flawed"] as const) {
    console.log(`\n### Layouts "${kind}"\n`);
    const rows: (string | number)[][] = [];
    for (const sample of samples) {
      const poses = sample.layouts[kind];
      const before = findProblems(sample.pieces, poses, sample.room);
      const tight = findProblems(sample.pieces, poses, sample.room, { gap: TIGHT_M, wallGap: TIGHT_M });
      rows.push([sample.name, "as given", describe(before), `${tight.overlaps.length} pairs and ${tight.outside.length} walls under ${TIGHT_M * 100} cm`, "", ""]);
      for (const approach of APPROACHES.slice(1)) {
        const attempt = approach.run(sample, poses);
        const after = findProblems(sample.pieces, attempt.poses, sample.room);
        const moved = movement(poses, attempt.poses);
        rows.push(["", approach.name, attempt.ok ? "**fine**" : `not fine: ${describe(after)}`, attempt.detail, `${cm(moved.mean_cm)} / ${cm(moved.max_cm)}`, `${moved.moved} moved, ${moved.turned} turned`]);
      }
    }
    console.log(table(["Room", "Approach", "Result", "Notes", "Moved, mean / most (cm)", "Pieces"], rows));
  }
}

function simulation(samples: Sample[]) {
  console.log(`\n## ${RUNS} random layouts for each room and each size of error (seed ${SEED})\n`);
  console.log("Each layout is the room's reference with every piece off by a random error in x and in z, and 5% of the pieces turned a quarter the wrong way. The first column is how often the layout is fine as it comes.\n");
  const rows: (string | number)[][] = [];
  const milliseconds = APPROACHES.map(() => 0);
  for (const sample of samples) {
    for (const sigma of [0.05, 0.1, 0.2, 0.3]) {
      const next = random(SEED * 1000 + Math.round(sigma * 100));
      const ok = APPROACHES.map(() => 0);
      const shift = APPROACHES.map(() => [] as number[]);
      for (let run = 0; run < RUNS; run++) {
        const poses = perturb(sample.layouts.reference, sigma, 0.05, next);
        APPROACHES.forEach((approach, index) => {
          const started = performance.now();
          const attempt = approach.run(sample, poses);
          milliseconds[index] += performance.now() - started;
          if (attempt.ok) {
            ok[index]++;
            shift[index].push(movement(poses, attempt.poses).mean_cm);
          }
        });
      }
      rows.push([
        rows.length % 4 === 0 ? sample.name : "",
        `${sigma * 100} cm`,
        ...APPROACHES.map((_, index) => `${percent(ok[index], RUNS)}${index > 0 && shift[index].length ? ` (${cm(mean(shift[index]))})` : ""}`),
      ]);
    }
  }
  console.log(table(["Room", "Error", ...APPROACHES.map((approach) => approach.name)], rows));
  console.log("\nThe percentages are layouts that end up fine. In brackets: how far the pieces had to move, in cm on average per piece, among those that ended up fine.");
  const layouts = samples.length * 4 * RUNS;
  console.log(`\nTime for one layout, on average: ${APPROACHES.map((approach, index) => `${approach.name} ${(milliseconds[index] / layouts).toFixed(2)} ms`).join("; ")}.`);
}

const named = (name: string) => APPROACHES.find((approach) => approach.name === name)!;
const CROWDING = ["check only", "check and repair", "check and search for a free place", "repair, then search", "grid 25 cm, one piece to a cell"].map(named);

/** The area of the pieces that stand on the floor (not the rug) as a part of the floor. */
const fill = (sample: Sample, scale: number) =>
  sample.pieces.filter((piece) => !isRug(piece)).reduce((sum, piece) => sum + (piece.width_cm * piece.depth_cm) / 10000, 0) / (sample.room.width_m * scale * sample.room.length_m * scale);

function crowding(samples: Sample[]) {
  console.log(`\n## Smaller and smaller rooms (${CROWDED_RUNS} layouts each)\n`);
  console.log("The room is made smaller, the pieces keep their size and the reference moves in with the walls, so the room gets fuller. The error is 10 cm. The columns say how often the layout ends up fine.\n");
  const rows: (string | number)[][] = [];
  for (const sample of samples) {
    for (const scale of [1, 0.9, 0.8, 0.7]) {
      const small: Sample = { ...sample, room: { width_m: sample.room.width_m * scale, length_m: sample.room.length_m * scale } };
      const reference = sample.layouts.reference.map((pose) => ({ ...pose, x_m: pose.x_m * scale, z_m: pose.z_m * scale }));
      const next = random(SEED * 77 + Math.round(scale * 10));
      const ok = CROWDING.map(() => 0);
      for (let run = 0; run < CROWDED_RUNS; run++) {
        const poses = perturb(reference, 0.1, 0.05, next);
        CROWDING.forEach((approach, index) => {
          if (approach.run(small, poses).ok) ok[index]++;
        });
      }
      rows.push([scale === 1 ? sample.name : "", `${Math.round(100 * fill(sample, scale))}%`, ...ok.map((count) => percent(count, CROWDED_RUNS))]);
    }
  }
  console.log(table(["Room", "Floor covered by pieces", ...CROWDING.map((approach) => approach.name)], rows));
}

/** The lines of code in a function of a file, without the blank lines and the comments. */
function codeLines(file: string, name: string): number {
  const lines = readFileSync(join(process.cwd(), file), "utf8").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^(export )?function ${name}\\b`).test(line));
  if (start < 0) throw new Error(`No function ${name} in ${file}.`);
  let count = 0;
  for (let index = start; index < lines.length; index++) {
    if (!/^\s*(\/\/|\/\*|\*)/.test(lines[index]) && lines[index].trim() !== "") count++;
    if (lines[index] === "}") break;
  }
  return count;
}

function effort() {
  console.log("\n## How much code each approach is (lines, without comments and blank lines)\n");
  const rows = [
    ["the check of the footprints", `${codeLines("src/shared/footprint.ts", "overlap") + codeLines("src/shared/footprint.ts", "footprintCorners") + codeLines("src/shared/footprint.ts", "outsideRoom")} (overlap, corners, room) + ${codeLines("scripts/overlap-approaches.ts", "findProblems")} (every pair)`],
    ["repair", `${codeLines("scripts/overlap-approaches.ts", "repair") + codeLines("scripts/overlap-approaches.ts", "shiftInside")}, on top of the check`],
    ["search for a free place", `${codeLines("scripts/overlap-approaches.ts", "placeNearest") + codeLines("scripts/overlap-approaches.ts", "movesAround")}, on top of the check`],
    ["grid", `${codeLines("scripts/overlap-approaches.ts", "placeOnGrid")}, on top of the check (which the AI's mistakes still need)`],
  ];
  console.log(table(["Approach", "Code"], rows));
}

const samples = load(SAMPLES_FILE);
for (const [name, section] of [["trials", trials], ["simulation", simulation], ["crowding", crowding]] as const) {
  const started = Date.now();
  section(samples);
  console.error(`(${name}: ${((Date.now() - started) / 1000).toFixed(1)} s)`);
}
effort();
