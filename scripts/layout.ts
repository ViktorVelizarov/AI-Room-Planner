// Asks the AI for a layout of the furniture of a room and prints it, as the app does (US-19).
//
//   npm run layout                   a sample living room: one paid call, or two if the first answer cannot be used
//   npm run layout -- room.json      your own room, as a room description: the "Room description (JSON)" of the 3D step
//   npm run layout -- --prompt       print the instructions that are sent to the AI, and stop: no call, no cost
//   npm run layout -- --demo         no call: make believe that the AI made the "flawed" layout of the overlap
//                                    research, to see how the app fixes mistakes
//
// Needs GEMINI_API_KEY in .env.local for a real call. Exits with code 1 if no layout could be made.
import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import {
  LayoutError,
  LayoutOverlapError,
  MissingApiKeyError,
  RoomTooFullError,
  generateLayout,
  type GenerateLayoutFn,
} from "../src/ai";
import { buildLayoutPrompt } from "../src/ai/layout-prompt";
import { typicalItem, type FurnitureLabel } from "../src/shared/furniture";
import { describeFacing, describePiece, floorCoverage } from "../src/shared/layout";
import { describeProblems, findProblems } from "../src/shared/layout-fix";
import { parseRoomDescription, type RoomDescription } from "../src/shared/room-description";

loadEnvConfig(process.cwd());

const SAMPLES = "docs/overlap-research/samples.json";

type Sample = {
  room: { width_m: number; length_m: number };
  pieces: { label: FurnitureLabel; width_cm: number; depth_cm: number }[];
  layouts: { flawed: { x_m: number; z_m: number; rotation_deg: number }[] };
};

/** The first sample room of the overlap research, as a room description, with the typical height, a colour and a material for each piece. */
async function sampleRoom(): Promise<{ description: RoomDescription; flawed: Sample["layouts"]["flawed"] }> {
  const { samples } = JSON.parse(await readFile(SAMPLES, "utf8")) as { samples: Sample[] };
  const [sample] = samples;
  const description = parseRoomDescription({
    room: { ...sample.room, height_m: 2.5 },
    furniture: sample.pieces.map(({ label, width_cm, depth_cm }) => ({ ...typicalItem(label), width_cm, depth_cm })),
  });
  if (!description.ok) throw new Error(`The sample room is not valid: ${description.problems.join(" ")}`);
  return { description: description.description, flawed: sample.layouts.flawed };
}

const metres = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const file = args.find((arg) => !arg.startsWith("--"));
  const unknown = [...flags].filter((flag) => flag !== "--prompt" && flag !== "--demo");
  if (unknown.length > 0 || (flags.has("--demo") && file)) {
    console.error("Usage: npm run layout -- [room.json] [--prompt | --demo]   (--demo uses the sample room, so it takes no file)");
    process.exit(1);
  }

  let description: RoomDescription;
  let fake: GenerateLayoutFn | undefined;
  if (file) {
    const checked = parseRoomDescription(JSON.parse(await readFile(file, "utf8")));
    if (!checked.ok) {
      console.error(`${file} is not a valid room description:\n- ${checked.problems.join("\n- ")}`);
      process.exit(1);
    }
    description = checked.description;
  } else {
    const sample = await sampleRoom();
    description = sample.description;
    if (flags.has("--demo")) {
      const labels = description.furniture.map((item) => item.label);
      fake = async () => ({
        text: JSON.stringify({ pieces: sample.flawed.map((pose, index) => ({ index, label: labels[index], ...pose })) }),
      });
      console.log("Demo: no AI is asked. The layout is the 'flawed' one of the overlap research, as if the AI had made it.\n");
    }
  }

  if (flags.has("--prompt")) {
    console.log(buildLayoutPrompt(description));
    return;
  }

  console.log(
    `Room ${description.room.width_m} x ${description.room.length_m} m, ${description.furniture.length} pieces covering ${Math.round(floorCoverage(description) * 100)}% of the floor.\n`,
  );
  try {
    const started = Date.now();
    const result = await generateLayout(description, fake);
    console.log(`Layout made in ${((Date.now() - started) / 1000).toFixed(1)} s, ${result.attempts} attempt(s), ${result.usage.inputTokens} tokens in and ${result.usage.outputTokens} out.\n`);

    const names = description.furniture.map((item, index) => describePiece(item.label, index));
    const width = Math.max(...names.map((name) => name.length));
    result.poses.forEach((pose, index) => {
      const moved = result.adjusted.includes(index) ? "  (adjusted by the app)" : "";
      console.log(`${names[index].padEnd(width)}  x ${metres(pose.x_m).padStart(6)}  z ${metres(pose.z_m).padStart(6)}  faces ${describeFacing(pose.rotation_deg)}${moved}`);
    });
    const problems = findProblems(description.furniture, result.poses, description.room);
    console.log(`\nChecked: ${problems.overlaps.length + problems.outside.length === 0 ? "no piece overlaps another or goes through a wall." : describeProblems(description.furniture, problems).join(" ")}`);
  } catch (error) {
    if (error instanceof RoomTooFullError) console.error(error.message);
    else if (error instanceof LayoutError) console.error(`The AI did not make a usable layout in ${error.attempts} attempts:\n- ${error.reasons.join("\n- ")}`);
    else if (error instanceof LayoutOverlapError) console.error(`The layout could not be made fine:\n- ${error.problems.join("\n- ")}`);
    else if (error instanceof MissingApiKeyError) console.error(error.message);
    else console.error("The call to the AI failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void main();
