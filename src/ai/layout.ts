import { whyNoLayoutIsPossible, type Pose } from "../shared/layout";
import { describeProblems, findProblems, fixLayout } from "../shared/layout-fix";
import type { RoomDescription } from "../shared/room-description";
import { generateLayoutWithGemini } from "./gemini";
import { parseLayoutAnswer } from "./layout-schema";
import type { GenerateLayoutFn, LayoutResult } from "./types";

/** The first try plus one retry. */
export const MAX_LAYOUT_ATTEMPTS = 2;

/** The model's answer was still not a usable layout after the retry, so none of it is used. */
export class LayoutError extends Error {
  readonly attempts: number;
  /** What was wrong with each attempt's answer, in order. */
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super(
      `The model did not return a valid layout after ${reasons.length} attempts. Last problem: ${reasons.at(-1)}`,
    );
    this.name = "LayoutError";
    this.attempts = reasons.length;
    this.reasons = reasons;
  }
}

/** The room cannot hold these pieces, so the model was not asked. The message is written for the user. */
export class RoomTooFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomTooFullError";
  }
}

/** The layout was a layout, but pieces still overlapped or went through a wall after the app tried to fix it. */
export class LayoutOverlapError extends Error {
  /** What is wrong, as sentences. */
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The layout still has problems after fixing: ${problems.join(" ")}`);
    this.name = "LayoutOverlapError";
    this.problems = problems;
  }
}

/**
 * Makes a layout that has the right shape into one that is fine, which is what the overlap research
 * decided: a layout without overlaps or pieces through walls is used as it is, and any other is
 * fixed in code, by pushing pieces apart and then looking for free places. It throws a
 * LayoutOverlapError when it cannot be fixed.
 */
export function finishLayout(description: RoomDescription, poses: Pose[]): { poses: Pose[]; adjusted: number[] } {
  const fixed = fixLayout(description.furniture, poses, description.room);
  if (!fixed.ok) {
    throw new LayoutOverlapError(
      describeProblems(description.furniture, findProblems(description.furniture, fixed.poses, description.room)),
    );
  }
  return { poses: fixed.poses, adjusted: fixed.adjusted };
}

/**
 * Asks the model for a layout of the furniture of a room: a place and a turn for every piece, in the
 * order of the list. The answer is checked to have every piece once and nothing else; if it does not,
 * the model is asked once more, and told what was wrong. If the second answer is also not usable it
 * throws a LayoutError rather than returning broken data. An answer that is a layout but has pieces
 * in each other or through a wall is fixed in code, and not asked for again. A room that cannot hold
 * the pieces is refused before the model is asked. Errors from the call itself (network, bad key)
 * are not retried.
 */
export async function generateLayout(
  description: RoomDescription,
  generate: GenerateLayoutFn = generateLayoutWithGemini,
): Promise<LayoutResult> {
  const tooFull = whyNoLayoutIsPossible(description);
  if (tooFull) throw new RoomTooFullError(tooFull);

  const reasons: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 1; attempt <= MAX_LAYOUT_ATTEMPTS; attempt++) {
    const answer = await generate({ description, feedback: reasons.at(-1) });
    usage.inputTokens += answer.usage?.inputTokens ?? 0;
    usage.outputTokens += answer.usage?.outputTokens ?? 0;

    const parsed = parseLayoutAnswer(answer.text, description.furniture, answer.note);
    if (parsed.ok) {
      const finished = finishLayout(description, parsed.poses);
      return { ...finished, attempts: attempt, usage };
    }
    reasons.push(parsed.reason);
  }

  throw new LayoutError(reasons);
}
