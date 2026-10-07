"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  FURNITURE_LABELS,
  FURNITURE_NAMES,
  MATERIALS,
  MATERIAL_NAMES,
  parseItemSize,
  type FurnitureItem,
  type FurnitureLabel,
  type ItemDimension,
  type Material,
} from "../shared/furniture";
import { SelectField, TextField } from "./form-fields";

const SIZE_FIELDS = [
  { key: "width", label: "Width (cm)" },
  { key: "depth", label: "Depth (cm)" },
  { key: "height", label: "Height (cm)" },
] as const;

type Field = ItemDimension | "color";

const typeOptions = FURNITURE_LABELS.map((label) => ({ value: label, label: FURNITURE_NAMES[label] }));
const materialOptions = MATERIALS.map((material) => ({ value: material, label: MATERIAL_NAMES[material] }));

/** A size for a text box: whole numbers stay whole, and at most one decimal is shown. */
const cm = (n: number) => String(Number(n.toFixed(1)));

/** The fields of one piece of furniture: type, size, colour and material. */
export function FurnitureItemForm({
  item,
  onSave,
  onCancel,
}: {
  item: FurnitureItem;
  /** Called with the piece, only when every field is valid. */
  onSave: (item: FurnitureItem) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [label, setLabel] = useState<FurnitureLabel>(item.label);
  const [material, setMaterial] = useState<Material>(item.material);
  const [color, setColor] = useState(item.color);
  const [sizes, setSizes] = useState<Record<ItemDimension, string>>({
    width: cm(item.width_cm),
    depth: cm(item.depth_cm),
    height: cm(item.height_cm),
  });
  const [touched, setTouched] = useState<Record<Field, boolean>>({
    width: false,
    depth: false,
    height: false,
    color: false,
  });
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});

  const checks = {
    width: parseItemSize("width", sizes.width),
    depth: parseItemSize("depth", sizes.depth),
    height: parseItemSize("height", sizes.height),
  };
  const colorError = color.trim() === "" ? "Enter a colour, for example grey." : undefined;

  const errorOf = (field: Field) => {
    if (!touched[field]) return undefined;
    if (field === "color") return colorError;
    const check = checks[field];
    return check.ok ? undefined : check.message;
  };
  const touch = (field: Field) => setTouched((current) => ({ ...current, [field]: true }));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched({ width: true, depth: true, height: true, color: true });

    const { width, depth, height } = checks;
    if (!width.ok || !depth.ok || !height.ok || colorError) {
      const order: Field[] = ["width", "depth", "height", "color"];
      const firstWrong = order.find((field) =>
        field === "color" ? colorError : !checks[field].ok,
      );
      if (firstWrong) inputs.current[firstWrong]?.focus();
      return;
    }
    onSave({
      label,
      width_cm: width.value,
      depth_cm: depth.value,
      height_cm: height.value,
      color: color.trim(),
      material,
    });
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-label={`Edit ${FURNITURE_NAMES[item.label]}`}
      className="flex flex-col gap-4 bg-black/[.03] px-4 py-4 dark:bg-white/[.04]"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id={`${id}-type`}
          label="Type"
          value={label}
          onChange={(value) => setLabel(value as FurnitureLabel)}
          options={typeOptions}
        />
        <SelectField
          id={`${id}-material`}
          label="Material"
          value={material}
          onChange={(value) => setMaterial(value as Material)}
          options={materialOptions}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {SIZE_FIELDS.map(({ key, label: fieldLabel }) => (
          <TextField
            key={key}
            id={`${id}-${key}`}
            label={fieldLabel}
            numeric
            value={sizes[key]}
            onChange={(value) => setSizes((current) => ({ ...current, [key]: value }))}
            onBlur={() => touch(key)}
            error={errorOf(key)}
            inputRef={(element) => {
              inputs.current[key] = element;
            }}
          />
        ))}
      </div>

      <TextField
        id={`${id}-color`}
        label="Colour"
        value={color}
        onChange={setColor}
        onBlur={() => touch("color")}
        error={errorOf("color")}
        inputRef={(element) => {
          inputs.current.color = element;
        }}
      />

      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-black/15 px-5 py-2 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/20 dark:hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
