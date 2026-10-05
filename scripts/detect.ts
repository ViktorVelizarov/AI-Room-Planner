// Sends room photos to the furniture detector and prints what comes back.
//
//   npm run detect -- photo.jpg                 one photo
//   npm run detect -- a.jpg b.png c.webp        several photos, one call each, with a summary
//   npm run detect -- --room a.jpg b.jpg c.jpg  all photos are one room: a single call, one list
//
// Needs GEMINI_API_KEY in .env.local. Exits with code 1 if anything has no valid answer.
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  DetectionError,
  MissingApiKeyError,
  detectFurniture,
  type DetectionImage,
} from "../src/ai";

loadEnvConfig(process.cwd());

const MIME_TYPES: Record<string, DetectionImage["mimeType"]> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const cm = (n: number) => String(Math.round(n));

/** The Gemini SDK puts the API's whole JSON error body in `message`; show just its text. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const body = JSON.parse(message) as { error?: { message?: string; status?: string } };
    if (body.error?.message) {
      return `${body.error.message}${body.error.status ? ` (${body.error.status})` : ""}`;
    }
  } catch {
    // not JSON, use the message as it is
  }
  return message;
}

/** One call to the detector: `label` names it in the output, `paths` are the photos sent together. */
type Job = { label: string; paths: string[] };

async function main() {
  const args = process.argv.slice(2);
  const room = args.includes("--room");
  const paths = args.filter((arg) => arg !== "--room");
  if (paths.length === 0) {
    console.error("Usage: npm run detect -- [--room] <photo> [<photo> ...]");
    process.exitCode = 1;
    return;
  }

  const jobs: Job[] = room
    ? [{ label: `room (${paths.length} photos)`, paths }]
    : paths.map((path) => ({ label: basename(path), paths: [path] }));

  let valid = 0;
  let validFirstTry = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const { label, paths: jobPaths } of jobs) {
    const unsupported = jobPaths.filter((path) => !MIME_TYPES[extname(path).toLowerCase()]);
    if (unsupported.length > 0) {
      console.log(`${label}: FAILED`);
      console.log(
        `  only .jpg, .png and .webp photos are supported: ${unsupported.map((p) => basename(p)).join(", ")}`,
      );
      console.log();
      continue;
    }

    try {
      const images: DetectionImage[] = await Promise.all(
        jobPaths.map(async (path) => ({
          data: (await readFile(path)).toString("base64"),
          mimeType: MIME_TYPES[extname(path).toLowerCase()],
        })),
      );
      const started = performance.now();
      const result = await detectFurniture(images);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);

      valid++;
      if (result.attempts === 1) validFirstTry++;
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;

      const retried = result.attempts > 1 ? " (valid after a retry)" : "";
      const skipped = result.unsupported ? `, ${result.unsupported} unsupported left out` : "";
      console.log(
        `${label}: valid${retried}, ${result.items.length} items${skipped}, ${seconds} s, ` +
          `${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`,
      );
      for (const item of result.items) {
        const size = `${cm(item.width_cm)} x ${cm(item.depth_cm)} x ${cm(item.height_cm)} cm`;
        console.log(
          `  ${item.label.padEnd(13)} ${size.padEnd(20)} ${item.color.padEnd(14)} ${item.material}`,
        );
      }
      console.log();
    } catch (error) {
      if (error instanceof MissingApiKeyError) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }
      console.log(`${label}: FAILED`);
      if (error instanceof DetectionError) {
        error.reasons.forEach((reason, i) => console.log(`  attempt ${i + 1}: ${reason}`));
      } else {
        console.log(`  ${describeError(error)}`);
      }
      console.log();
    }
  }

  if (jobs.length > 1) {
    console.log(
      `Valid answers: ${valid} of ${jobs.length} (${validFirstTry} on the first attempt). ` +
        `Tokens: ${inputTokens} in / ${outputTokens} out.`,
    );
  }
  if (valid < jobs.length) process.exitCode = 1;
}

void main();
