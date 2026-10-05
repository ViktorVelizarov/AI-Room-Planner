"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DetectResponse } from "../shared/api";
import type { RoomSize } from "../shared/room";
import { RoomAnalyzer } from "./room-analyzer";
import { RoomSizeForm } from "./room-size-form";
import { RoomSummary } from "./room-summary";
import { StepIndicator } from "./step-indicator";

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

/** The whole flow: photos and furniture, then the room size, then the room as it stands. */
export function RoomPlanner() {
  const [step, setStep] = useState(PHOTOS);
  const [detected, setDetected] = useState<DetectResponse | null>(null);
  const [roomSize, setRoomSize] = useState<RoomSize | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <StepIndicator current={step} />

      <Step active={step === PHOTOS} label="Photos">
        <RoomAnalyzer onResultChange={setDetected} />
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
            items={detected.items}
            unsupported={detected.unsupported}
            onBack={() => setStep(ROOM_SIZE)}
          />
        )}
      </Step>
    </div>
  );
}
