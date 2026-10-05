"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  DEFAULT_ROOM_SIZE,
  formatMetres,
  parseDimension,
  type RoomDimension,
  type RoomSize,
} from "../shared/room";
import { RoomOutline } from "./room-outline";

const FIELDS = [
  { key: "width", label: "Width (m)", size: "width_m" },
  { key: "length", label: "Length (m)", size: "length_m" },
  { key: "height", label: "Height (m)", size: "height_m" },
] as const;

type Props = {
  /** What the fields start with. */
  initial?: RoomSize;
  onBack: () => void;
  /** Called with the size, only when every field is valid. */
  onConfirm: (size: RoomSize) => void;
};

/** Width, length and height of the room, with a top-down outline that follows the numbers. */
export function RoomSizeForm({ initial = DEFAULT_ROOM_SIZE, onBack, onConfirm }: Props) {
  const id = useId();
  const [text, setText] = useState<Record<RoomDimension, string>>({
    width: formatMetres(initial.width_m),
    length: formatMetres(initial.length_m),
    height: formatMetres(initial.height_m),
  });
  // The last valid values, which the outline draws while a field holds something unusable.
  const [drawn, setDrawn] = useState<RoomSize>(initial);
  // A field's message appears once the user has left it, or tried to continue.
  const [touched, setTouched] = useState<Record<RoomDimension, boolean>>({
    width: false,
    length: false,
    height: false,
  });
  const inputs = useRef<Partial<Record<RoomDimension, HTMLInputElement | null>>>({});

  const checks = {
    width: parseDimension("width", text.width),
    length: parseDimension("length", text.length),
    height: parseDimension("height", text.height),
  };

  function handleChange(key: RoomDimension, size: keyof RoomSize, value: string) {
    setText({ ...text, [key]: value });
    const check = parseDimension(key, value);
    if (check.ok) setDrawn({ ...drawn, [size]: check.value });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched({ width: true, length: true, height: true });

    const { width, length, height } = checks;
    if (!width.ok || !length.ok || !height.ok) {
      const firstInvalid = FIELDS.find((field) => !checks[field.key].ok);
      if (firstInvalid) inputs.current[firstInvalid.key]?.focus();
      return;
    }
    onConfirm({ width_m: width.value, length_m: length.value, height_m: height.value });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2 sm:items-center">
        <div className="flex flex-col gap-4">
          {FIELDS.map(({ key, label, size }) => {
            const check = checks[key];
            const error = touched[key] && !check.ok ? check.message : undefined;
            const inputId = `${id}-${key}`;
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <label htmlFor={inputId} className="text-sm font-medium">
                  {label}
                </label>
                <input
                  id={inputId}
                  ref={(element) => {
                    inputs.current[key] = element;
                  }}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={text[key]}
                  onChange={(event) => handleChange(key, size, event.target.value)}
                  onBlur={() => setTouched({ ...touched, [key]: true })}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                  className="w-full rounded-lg border border-black/20 bg-transparent px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 aria-invalid:border-red-600 dark:border-white/25 dark:aria-invalid:border-red-400"
                />
                {error && (
                  <p id={`${inputId}-error`} className="text-sm text-red-700 dark:text-red-400">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <RoomOutline
          width_m={drawn.width_m}
          length_m={drawn.length_m}
          height_m={drawn.height_m}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/20 dark:hover:bg-white/10"
        >
          Back
        </button>
        <button
          type="submit"
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Continue
        </button>
      </div>
    </form>
  );
}
