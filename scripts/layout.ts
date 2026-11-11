// Asks the AI for layouts of the furniture of a room and prints them, as the app does (US-19, US-21).
//
//   npm run layout                   a sample living room in all three styles: three paid calls, or more if an answer cannot be used
//   npm run layout -- --style cosy   one style only (spacious, cosy or work): one paid call, or two if the first answer cannot be used
//   npm run layout -- room.json      your own room, as a room description: the "Room description (JSON)" of the 3D step
//   npm run layout -- --prompt       print the instructions that are sent to the AI for each style, and stop: no call, no cost
//   npm run layout -- --demo         no call: make believe that the AI made the "flawed" layout of the overlap
//                                    research, in one style, to see how the app fixes mistakes
//
// Needs GEMINI_API_KEY in .env.local for a real call. Exits with code 1 if no layout could be made.
import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import {
  AiTimeoutError,
  MissingApiKeyError,
  RoomTooFullError,
  generateLayoutWithGemini,
  generateLayouts,
  type GenerateLayoutFn,
  type StyleOutcome,
} from "../src/ai";
import { buildLayoutPrompt } from "../src/ai/layout-prompt";
import { typicalItem, type FurnitureLabel } from "../src/shared/furniture";
import { describeFacing, describePiece, floorCoverage } from "../src/shared/layout";
import { describeProblems, findProblems } from "../src/shared/layout-fix";
import { LAYOUT_STYLES, STYLE_NAMES, isLayoutStyle, piecesInOwnPlaces, piecesNeededInOwnPlaces, type LayoutStyle } from "../src/shared/layout-styles";
import { parseRoomDescription, type RoomDescription } from "../src/shared/room-description";

loadEnvConfig(process.cwd());

const SAMPLES = "docs/overlap-research/samples.json";
const USAGE = "Usage: npm run layout -- [room.json] [--style spacious|cosy|work] [--prompt | --demo]   (--demo uses the sample room, so it takes no file)";

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

/** What was asked on the command line, or `undefined` after saying what is wrong with it. */
function readArguments(args: string[]): { file?: string; style?: LayoutStyle; flags: Set<string> } | undefined {
  const flags = new Set<string>();
  let file: string | undefined;
  let style: LayoutStyle | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--style") {
      const value = args[++i];
      if (!isLayoutStyle(value)) return undefined;
      style = value;
    } else if (arg === "--prompt" || arg === "--demo") {
      flags.add(arg);
    } else if (arg.startsWith("--") || file) {
      return undefined;
    } else {
      file = arg;
    }
  }
  return flags.has("--demo") && file ? undefined : { file, style, flags };
}

function printLayout(description: RoomDescription, outcome: Extract<StyleOutcome, { ok: true }>, others: readonly (readonly { x_m: number; z_m: number; rotation_deg: number }[])[]) {
  console.log(`${STYLE_NAMES[outcome.style]}: ${outcome.description}`);
  const names = description.furniture.map((item, index) => describePiece(item.label, index));
  const width = Math.max(...names.map((name) => name.length));
  outcome.poses.forEach((pose, index) => {
    const moved = outcome.adjusted.includes(index) ? "  (adjusted by the app)" : "";
    console.log(`  ${names[index].padEnd(width)}  x ${metres(pose.x_m).padStart(6)}  z ${metres(pose.z_m).padStart(6)}  faces ${describeFacing(pose.rotation_deg)}${moved}`);
  });
  const problems = findProblems(description.furniture, outcome.poses, description.room);
  console.log(`  Checked: ${problems.overlaps.length + problems.outside.length === 0 ? "no piece overlaps another or goes through a wall." : describeProblems(description.furniture, problems).join(" ")}`);
  if (others.length > 0) {
    const own = piecesInOwnPlaces(outcome.poses, others).length;
    const needed = piecesNeededInOwnPlaces(outcome.poses.length);
    console.log(`  Different from the other layouts: ${own} of ${outcome.poses.length} pieces are in a place of their own, ${needed} are needed (${own >= needed ? "clearly different" : "too much alike"}).`);
  }
  console.log("");
}

async function main() {
  const parsed = readArguments(process.argv.slice(2));
  if (!parsed) {
    console.error(USAGE);
    process.exit(1);
  }
  const { file, style, flags } = parsed;

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
        text: JSON.stringify({
          description: "The layout of the overlap research that has mistakes in it, as if the AI had made it.",
          pieces: sample.flawed.map((pose, index) => ({ index, label: labels[index], ...pose })),
        }),
      });
      console.log("Demo: no AI is asked. The layout is the 'flawed' one of the overlap research, as if the AI had made it.\n");
    }
  }

  // The demo makes one layout, since one answer is all it has; so does a style that is asked for by name.
  const styles: readonly LayoutStyle[] = style ? [style] : flags.has("--demo") ? ["spacious"] : LAYOUT_STYLES;

  if (flags.has("--prompt")) {
    for (const each of styles) {
      console.log(`===== ${STYLE_NAMES[each]} =====\n`);
      console.log(buildLayoutPrompt(description, undefined, { style: each, alongside: styles.filter((other) => other !== each) }));
      console.log("");
    }
    return;
  }

  console.log(
    `Room ${description.room.width_m} x ${description.room.length_m} m, ${description.furniture.length} pieces covering ${Math.round(floorCoverage(description) * 100)}% of the floor.\n`,
  );

  let calls = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };
  const ask = fake ?? generateLayoutWithGemini;
  const counted: GenerateLayoutFn = async (request) => {
    calls += 1;
    const answer = await ask(request);
    usage.inputTokens += answer.usage?.inputTokens ?? 0;
    usage.outputTokens += answer.usage?.outputTokens ?? 0;
    return answer;
  };

  try {
    const started = Date.now();
    const outcomes = await generateLayouts(description, styles, counted);
    console.log(`Made in ${((Date.now() - started) / 1000).toFixed(1)} s, ${calls} model call(s), ${usage.inputTokens} tokens in and ${usage.outputTokens} out.\n`);

    const made = outcomes.filter((outcome): outcome is Extract<StyleOutcome, { ok: true }> => outcome.ok);
    for (const outcome of outcomes) {
      if (outcome.ok) {
        printLayout(description, outcome, made.filter((other) => other !== outcome).map((other) => other.poses));
        continue;
      }
      const { failure } = outcome;
      const name = STYLE_NAMES[outcome.style];
      if (failure.code === "invalid_answer") console.error(`${name}: the AI did not make a usable layout in ${failure.reasons.length} attempts:\n- ${failure.reasons.join("\n- ")}\n`);
      else if (failure.code === "layout_has_overlaps") console.error(`${name}: the layout could not be made fine:\n- ${failure.problems.join("\n- ")}\n`);
      else if (failure.code === "too_similar") console.error(`${name}: too much like the other layouts: ${failure.own} of ${failure.pieces} pieces in places of their own, ${failure.needed} needed.\n`);
      else if (failure.error instanceof MissingApiKeyError) console.error(`${failure.error.message}\n`);
      else if (failure.error instanceof AiTimeoutError) console.error(`${name}: the AI did not answer within ${failure.error.timeoutMs / 1000} s. A longer deadline can be set with GEMINI_LAYOUT_TIMEOUT_S (10 to 150).\n`);
      else console.error(`${name}: the call to the AI failed:`, failure.error instanceof Error ? failure.error.message : failure.error, "\n");
    }
    if (made.length === 0) process.exit(1);
  } catch (error) {
    if (error instanceof RoomTooFullError) console.error(error.message);
    else console.error("The call to the AI failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void main();
