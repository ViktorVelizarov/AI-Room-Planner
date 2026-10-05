export const STEP_NAMES = ["Photos", "Room size", "Your room"] as const;

/** Shows which of the steps the user is on. `current` is the 0-based index. */
export function StepIndicator({ current }: { current: number }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap gap-2 text-sm">
      {STEP_NAMES.map((name, index) => {
        const active = index === current;
        return (
          <li
            key={name}
            aria-current={active ? "step" : undefined}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
              active
                ? "border-foreground bg-foreground font-medium text-background"
                : "border-black/15 text-zinc-600 dark:border-white/20 dark:text-zinc-400"
            }`}
          >
            <span aria-hidden="true">{index + 1}</span>
            {name}
          </li>
        );
      })}
    </ol>
  );
}
