"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DetectResponse } from "../shared/api";
import { toEntries, type FurnitureEntry } from "../shared/furniture-list";
import type { RoomSize } from "../shared/room";
import type { RoomDescription } from "../shared/room-description";
import { RoomAnalyzer } from "./room-analyzer";
import { RoomDescriptionView } from "./room-description-view";
import { RoomSizeForm } from "./room-size-form";
import { RoomSummary } from "./room-summary";
import { StepIndicator } from "./step-indicator";

// The 3D code is large, so it is loaded when the user first reaches the 3D room, not with the page.
const Room3DView = dynamic(() => import("./room-3d-view").then((module) => module.Room3DView), {
  ssr: false,
  loading: () => (
    <p
      role="status"
      className="flex h-80 items-center justify-center rounded-lg bg-black/4 text-sm text-zinc-600 sm:h-112 dark:bg-white/6 dark:text-zinc-400"
    >
      Loading the 3D view…
    </p>
  ),
});

/**
 * One step of the flow. Steps that are not current are hidden, not removed, so the photos,
 * the detected furniture and the typed sizes are still there when the user goes back.
 */
function Step({
  active,
  label,
  children,
}: {
  active: boolean;
  label: string;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const wasActive = useRef(active);

  // The button that was pressed is now hidden, so move the focus to the new step.
  useEffect(() => {
    if (active && !wasActive.current) element.current?.focus();
    wasActive.current = active;
  }, [active]);

  return (
    <div
      ref={element}
      role="group"
      aria-label={label}
      tabIndex={-1}
      hidden={!active}
      className="flex flex-col gap-6 outline-none"
    >
      {children}
    </div>
  );
}

const PHOTOS = 0;
const ROOM_SIZE = 1;
const SUMMARY = 2;
const ROOM_3D = 3;

/** The whole flow: photos and furniture, then the room size, then the room as it stands, then the 3D room. */
export function RoomPlanner() {
  const [step, setStep] = useState(PHOTOS);
  const [detected, setDetected] = useState<DetectResponse | null>(null);
  const [roomSize, setRoomSize] = useState<RoomSize | null>(null);
  // The furniture the user is working on: what the AI found, plus their corrections.
  const [entries, setEntries] = useState<FurnitureEntry[]>([]);
  // The size and the furniture as confirmed in the last step, which the 3D room is made from.
  // Made again each time the user continues, so the 3D room step always shows the latest.
  const [description, setDescription] = useState<RoomDescription | null>(null);

  function handleResult(data: DetectResponse | null) {
    setDetected(data);
    // A new detection starts the list again; while one runs or fails, the corrections stay.
    if (data) setEntries(toEntries(data.items));
  }

  return (
    <div className="flex flex-col gap-8">
      <StepIndicator current={step} />

      <Step active={step === PHOTOS} label="Photos">
        <RoomAnalyzer onResultChange={handleResult} />
        {detected && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep(ROOM_SIZE)}
              className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Continue to room size
            </button>
          </div>
        )}
      </Step>

      <Step active={step === ROOM_SIZE} label="Room size">
        <section
          aria-labelledby="size-heading"
          className="flex flex-col gap-5 rounded-2xl border border-black/10 p-6 dark:border-white/15"
        >
          <div>
            <h2 id="size-heading" className="text-lg font-semibold">
              Room size
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Enter the size of your room in metres, so the 3D room matches it.
            </p>
          </div>
          <RoomSizeForm
            onBack={() => setStep(PHOTOS)}
            onConfirm={(size) => {
              setRoomSize(size);
              setStep(SUMMARY);
            }}
          />
        </section>
      </Step>

      <Step active={step === SUMMARY} label="Your room">
        {detected && roomSize && (
          <RoomSummary
            size={roomSize}
            entries={entries}
            unsupported={detected.unsupported}
            onEntriesChange={setEntries}
            onBack={() => setStep(ROOM_SIZE)}
            onConfirm={(confirmed) => {
              setDescription(confirmed);
              setStep(ROOM_3D);
            }}
          />
        )}
      </Step>

      <Step active={step === ROOM_3D} label="3D room">
        {/* Only while this step is open, so the 3D view is made when it is needed and freed when the user leaves. */}
        {description && step === ROOM_3D && (
          <section
            aria-labelledby="room-3d-heading"
            className="flex flex-col gap-5 rounded-2xl border border-black/10 p-6 dark:border-white/15"
          >
            <div>
              <h2 id="room-3d-heading" className="text-lg font-semibold">
                3D room
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Your room at the size you entered, with your furniture lined up along the back wall
                in the order of your list. Look around it to check that the room and the furniture
                match the real ones.
              </p>
            </div>

            <Room3DView description={description} />

            <div>
              <button
                type="button"
                onClick={() => setStep(SUMMARY)}
                className="rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/20 dark:hover:bg-white/10"
              >
                Back to your room
              </button>
            </div>

            <RoomDescriptionView description={description} />
          </section>
        )}
      </Step>
    </div>
  );
}
