// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectFailure, DetectOutcome } from "../client/detect-client";
import { requestDetection } from "../client/detect-client";
import type { FurnitureItem } from "../shared/furniture";
import { RoomAnalyzer } from "./room-analyzer";

vi.mock("../client/detect-client", () => ({ requestDetection: vi.fn() }));
const detect = vi.mocked(requestDetection);

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: (file: Blob) => `blob:preview/${(file as File).name}`,
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const photo = (name: string) => new File([new Uint8Array(1000)], name, { type: "image/jpeg" });

const sofa: FurnitureItem = {
  label: "sofa",
  width_cm: 200,
  depth_cm: 90,
  height_cm: 85,
  color: "dark grey",
  material: "fabric",
};
const coffeeTable: FurnitureItem = {
  label: "coffee_table",
  width_cm: 100,
  depth_cm: 60,
  height_cm: 45,
  color: "oak brown",
  material: "wood",
};

const success = (
  items: FurnitureItem[] = [sofa],
  unsupported = 0,
  calls = { used: 1, limit: 10 },
): DetectOutcome => ({ ok: true, data: { items, unsupported, calls } });

const failure = (overrides: Partial<DetectFailure> = {}): DetectOutcome => ({
  ok: false,
  failure: {
    code: "ai_unavailable",
    message: "The AI service is not available right now. Please try again in a moment.",
    retryable: true,
    ...overrides,
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const setup = () => {
  const { container } = render(<RoomAnalyzer />);
  const user = userEvent.setup({ applyAccept: false });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const add = (...files: File[]) => user.upload(input, files);
  const detectButton = () => screen.getByRole("button", { name: /Detect furniture|Detecting/ });
  return { user, add, detectButton };
};

const thumbnails = () => screen.queryAllByRole("img").map((img) => img.getAttribute("alt"));
const error = () => screen.queryByRole("alert")?.textContent ?? null;

describe("RoomAnalyzer", () => {
  describe("the Detect furniture button", () => {
    it("waits for a photo", async () => {
      const { add, detectButton } = setup();

      expect((detectButton() as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText("Add at least one photo first.")).toBeTruthy();

      await add(photo("a.jpg"));

      expect((detectButton() as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByText("Add at least one photo first.")).toBeNull();
    });

    it("is disabled again when the last photo is removed", async () => {
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"));

      await user.click(screen.getByRole("button", { name: "Remove a.jpg" }));

      expect((detectButton() as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("while detecting", () => {
    it("shows a loading indicator and locks the button and the photos, then shows the list", async () => {
      const pending = deferred<DetectOutcome>();
      detect.mockReturnValue(pending.promise);
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"), photo("b.jpg"));

      await user.click(detectButton());

      expect(screen.getByRole("status").textContent).toMatch(/Looking for furniture/);
      expect(detectButton().textContent).toBe("Detecting…");
      expect((detectButton() as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Add photos" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Remove a.jpg" }) as HTMLButtonElement).disabled).toBe(true);

      pending.resolve(success());

      await screen.findByText("Detected furniture (1)");
      expect(screen.queryByRole("status")).toBeNull();
      expect(detectButton().textContent).toBe("Detect furniture");
      expect((screen.getByRole("button", { name: "Remove a.jpg" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("sends all the added photos to the detector, in the order they were added", async () => {
      detect.mockResolvedValue(success());
      const { user, add, detectButton } = setup();
      const files = [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")];
      await add(...files);

      await user.click(detectButton());

      await screen.findByText("Detected furniture (1)");
      expect(detect).toHaveBeenCalledTimes(1);
      expect(detect.mock.calls[0][0]).toEqual(files);
    });
  });

  describe("the result", () => {
    it("lists each piece with its type and size, colour and material", async () => {
      detect.mockResolvedValue(success([sofa, coffeeTable]));
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"));

      await user.click(detectButton());

      await screen.findByText("Detected furniture (2)");
      expect(screen.getByText("Sofa")).toBeTruthy();
      expect(screen.getByText("200 × 90 × 85 cm")).toBeTruthy();
      expect(screen.getByText("dark grey · fabric")).toBeTruthy();
      expect(screen.getByText("Coffee table")).toBeTruthy();
      expect(screen.getByText("100 × 60 × 45 cm")).toBeTruthy();
      expect(screen.getByText("oak brown · wood")).toBeTruthy();
    });

    it("rounds the sizes to whole centimetres", async () => {
      detect.mockResolvedValue(success([{ ...sofa, width_cm: 199.6, depth_cm: 90.2, height_cm: 85.5 }]));
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"));

      await user.click(detectButton());

      expect(await screen.findByText("200 × 90 × 86 cm")).toBeTruthy();
    });

    it("says so when no supported furniture was found", async () => {
      detect.mockResolvedValue(success([]));
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"));

      await user.click(detectButton());

      expect(await screen.findByText(/No supported furniture was found/)).toBeTruthy();
    });

    it.each([
      [1, "1 other item is not a supported furniture type and was left out."],
      [3, "3 other items are not supported furniture types and were left out."],
    ])("mentions the %i item(s) of an unsupported type that were left out", async (count, text) => {
      detect.mockResolvedValue(success([sofa], count));
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"));

      await user.click(detectButton());

      expect(await screen.findByText(text)).toBeTruthy();
    });

    it("shows how many AI calls the session has used", async () => {
      detect.mockResolvedValue(success([sofa], 0, { used: 3, limit: 10 }));
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"));

      await user.click(detectButton());

      expect(await screen.findByText("AI calls used this session: 3 of 10")).toBeTruthy();
    });

    it("warns when the photos change after the list was made", async () => {
      detect.mockResolvedValue(success());
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"), photo("b.jpg"));
      await user.click(detectButton());
      await screen.findByText("Detected furniture (1)");
      expect(screen.queryByText(/You changed the photos/)).toBeNull();

      await user.click(screen.getByRole("button", { name: "Remove b.jpg" }));

      expect(screen.getByText(/You changed the photos after this list was made/)).toBeTruthy();
    });
  });

  describe("when detection fails", () => {
    it("shows a friendly message and a Try again button, and keeps the photos", async () => {
      detect.mockResolvedValue(failure());
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"), photo("b.jpg"));

      await user.click(detectButton());

      await waitFor(() => expect(error()).toContain("The AI service is not available right now."));
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
      expect(thumbnails()).toEqual(["Preview of a.jpg", "Preview of b.jpg"]);
      expect((detectButton() as HTMLButtonElement).disabled).toBe(false);
    });

    it("tries again with the same photos when Try again is pressed", async () => {
      detect.mockResolvedValueOnce(failure()).mockResolvedValueOnce(success());
      const { user, add, detectButton } = setup();
      const files = [photo("a.jpg"), photo("b.jpg")];
      await add(...files);
      await user.click(detectButton());
      await screen.findByRole("button", { name: "Try again" });

      await user.click(screen.getByRole("button", { name: "Try again" }));

      await screen.findByText("Detected furniture (1)");
      expect(detect).toHaveBeenCalledTimes(2);
      expect(detect.mock.calls[1][0]).toEqual(files);
      expect(error()).toBeNull();
      expect(thumbnails()).toHaveLength(2);
    });

    it("shows the message for a problem that trying again cannot fix, without a Try again button", async () => {
      detect.mockResolvedValue(
        failure({
          code: "limit_reached",
          message: "You have used all 10 AI calls for this session.",
          retryable: false,
          calls: { used: 10, limit: 10 },
        }),
      );
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"));

      await user.click(detectButton());

      await waitFor(() => expect(error()).toBe("You have used all 10 AI calls for this session."));
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(screen.getByText("AI calls used this session: 10 of 10")).toBeTruthy();
      expect(thumbnails()).toEqual(["Preview of a.jpg"]);
    });

    it("clears an earlier result when a later detection fails", async () => {
      detect.mockResolvedValueOnce(success()).mockResolvedValueOnce(failure());
      const { user, add, detectButton } = setup();
      await add(photo("a.jpg"));
      await user.click(detectButton());
      await screen.findByText("Detected furniture (1)");

      await user.click(detectButton());

      await waitFor(() => expect(error()).not.toBeNull());
      expect(screen.queryByText("Detected furniture (1)")).toBeNull();
    });
  });
});
