"use client";

import { useState } from "react";
import { requestDetection, type DetectFailure } from "../client/detect-client";
import type { Calls, DetectResponse } from "../shared/api";
import { FurnitureList } from "./furniture-list";
import { PhotoUploader } from "./photo-uploader";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; data: DetectResponse; photoKey: string }
  | { status: "failed"; failure: DetectFailure };

/** Identifies a set of photos, to notice when they change after a detection. */
const keyOf = (files: File[]) =>
  files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");

/** The photo step and the detection step: add photos, find the furniture in them, see the list. */
export function RoomAnalyzer() {
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<State>({ status: "idle" });
  const [calls, setCalls] = useState<Calls | null>(null);

  const loading = state.status === "loading";

  async function detect() {
    setState({ status: "loading" });
    const outcome = await requestDetection(files);
    if (outcome.ok) {
      setCalls(outcome.data.calls);
      setState({ status: "done", data: outcome.data, photoKey: keyOf(files) });
    } else {
      if (outcome.failure.calls) setCalls(outcome.failure.calls);
      setState({ status: "failed", failure: outcome.failure });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PhotoUploader onPhotosChange={setFiles} disabled={loading} />

      <section
        aria-labelledby="detect-heading"
        className="flex flex-col gap-5 rounded-2xl border border-black/10 p-6 dark:border-white/15"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="detect-heading" className="text-lg font-semibold">
              Furniture in your room
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {files.length === 0
                ? "Add at least one photo first."
                : "The AI looks at all your photos together and lists each piece once."}
            </p>
          </div>
          <button
            type="button"
            onClick={detect}
            disabled={files.length === 0 || loading}
            className="flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-background/30 border-t-background motion-reduce:animate-none"
              />
            )}
            {loading ? "Detecting…" : "Detect furniture"}
          </button>
        </div>

        {loading && (
          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            Looking for furniture in your photos. This can take up to a minute.
          </p>
        )}

        {state.status === "failed" && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
          >
            <p>{state.failure.message}</p>
            {state.failure.retryable && (
              <button
                type="button"
                onClick={detect}
                className="shrink-0 rounded-full border border-red-900/30 px-4 py-1.5 font-medium hover:bg-red-900/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-red-100/30 dark:hover:bg-red-100/10"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {state.status === "done" && (
          <>
            {state.photoKey !== keyOf(files) && (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                You changed the photos after this list was made. Press Detect furniture to update it.
              </p>
            )}
            <FurnitureList items={state.data.items} unsupported={state.data.unsupported} />
          </>
        )}

        {calls && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            AI calls used this session: {calls.used} of {calls.limit}
          </p>
        )}
      </section>
    </div>
  );
}
