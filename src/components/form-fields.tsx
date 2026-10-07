import type { Ref } from "react";

const CONTROL =
  "w-full rounded-lg border border-black/20 bg-transparent px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 aria-invalid:border-red-600 dark:border-white/25 dark:aria-invalid:border-red-400";

/** A labelled text box with its error message directly under it. */
export function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  inputRef,
  numeric = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Shown under the box, and the box is marked as wrong. */
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** A number is expected, so phones show the number keyboard. */
  numeric?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        inputMode={numeric ? "decimal" : undefined}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={CONTROL}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** A labelled drop-down list. */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
