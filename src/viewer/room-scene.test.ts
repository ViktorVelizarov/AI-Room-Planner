import {
  Box3,
  type BufferGeometry,
  DirectionalLight,
  FrontSide,
  HemisphereLight,
  LineSegments,
  type Material,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Scene,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import type { RoomSize } from "../shared/room";
import { createRoomScene, disposeScene } from "./room-scene";

const room: RoomSize = { width_m: 6, length_m: 4.5, height_m: 2.5 };

const ROOMS: RoomSize[] = [
  room,
  { width_m: 1, length_m: 1, height_m: 2 },
  { width_m: 20, length_m: 20, height_m: 5 },
  { width_m: 3.25, length_m: 12.5, height_m: 3.4 },
];

/** A named part of the room, such as "floor" or "wall-left". */
function part<T extends Object3D = Mesh>(scene: Scene, name: string): T {
  const found = scene.getObjectByName(name);
  if (!found) throw new Error(`The room has no part called ${name}`);
  return found as T;
}

const boxOf = (object: Object3D) => new Box3().setFromObject(object);

/** Turning a wall leaves rounding errors of about 1e-16, so numbers are compared to six decimals. */
function expectNear(actual: number[], expected: number[], message: string) {
  expect(actual.length, message).toBe(expected.length);
  expected.forEach((value, index) => expect(actual[index], message).toBeCloseTo(value, 6));
}

/** The way the front of a flat part faces in the room, after it has been placed. */
const facing = (mesh: Mesh) => new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);

const WALLS = ["wall-back", "wall-front", "wall-left", "wall-right"];

describe("createRoomScene", () => {
  it("fills exactly the size that was entered, centred on the middle of the floor", () => {
    for (const size of ROOMS) {
      const box = boxOf(part(createRoomScene(size), "room"));
      const where = JSON.stringify(size);

      expectNear(box.min.toArray(), [-size.width_m / 2, 0, -size.length_m / 2], where);
      expectNear(box.max.toArray(), [size.width_m / 2, size.height_m, size.length_m / 2], where);
    }
  });

  it("has a floor as wide and as long as the room, lying flat at the bottom around the origin", () => {
    for (const size of ROOMS) {
      const floor = boxOf(part(createRoomScene(size), "floor"));
      const where = JSON.stringify(size);

      expectNear(floor.min.toArray(), [-size.width_m / 2, 0, -size.length_m / 2], where);
      expectNear(floor.max.toArray(), [size.width_m / 2, 0, size.length_m / 2], where);
    }
  });

  it("has four walls, each as high as the room and as long as the side it stands on", () => {
    // Each wall's extent as [min x, min y, min z, max x, max y, max z].
    const extent = (scene: Scene, name: string) => {
      const box = boxOf(part(scene, name));
      return [...box.min.toArray(), ...box.max.toArray()];
    };

    for (const size of ROOMS) {
      const scene = createRoomScene(size);
      const where = JSON.stringify(size);
      const { width_m: w, length_m: l, height_m: h } = size;

      // The back and front walls run along x and stand at the two ends of z; the left and right
      // walls run along z and stand at the two ends of x.
      expectNear(extent(scene, "wall-back"), [-w / 2, 0, -l / 2, w / 2, h, -l / 2], `back wall in ${where}`);
      expectNear(extent(scene, "wall-front"), [-w / 2, 0, l / 2, w / 2, h, l / 2], `front wall in ${where}`);
      expectNear(extent(scene, "wall-left"), [-w / 2, 0, -l / 2, -w / 2, h, l / 2], `left wall in ${where}`);
      expectNear(extent(scene, "wall-right"), [w / 2, 0, -l / 2, w / 2, h, l / 2], `right wall in ${where}`);
    }
  });

  it("turns every wall to face into the room, and the floor to face up", () => {
    const scene = createRoomScene(room);
    scene.updateMatrixWorld(true);
    const expected: Record<string, number[]> = {
      "wall-back": [0, 0, 1],
      "wall-front": [0, 0, -1],
      "wall-left": [1, 0, 0],
      "wall-right": [-1, 0, 0],
      floor: [0, 1, 0],
    };

    for (const [name, direction] of Object.entries(expected)) {
      const normal = facing(part(scene, name));
      direction.forEach((value, axis) => expect(normal.getComponent(axis), name).toBeCloseTo(value, 6));
    }
  });

  it("points every wall at the middle of the room, from half the room's width or length away", () => {
    for (const size of ROOMS) {
      const scene = createRoomScene(size);
      scene.updateMatrixWorld(true);
      const middle = new Vector3(0, size.height_m / 2, 0);
      // How far each wall stands from the middle, straight along the way it faces.
      const distance: Record<string, number> = {
        "wall-back": size.length_m / 2,
        "wall-front": size.length_m / 2,
        "wall-left": size.width_m / 2,
        "wall-right": size.width_m / 2,
      };

      for (const name of WALLS) {
        const wall = part(scene, name);
        const towardsMiddle = middle.clone().sub(boxOf(wall).getCenter(new Vector3()));
        expect(facing(wall).dot(towardsMiddle), `${name} in ${JSON.stringify(size)}`).toBeCloseTo(distance[name], 6);
      }
    }
  });

  it("draws the walls and the floor on their front side only, so the near walls never block the view", () => {
    const scene = createRoomScene(room);

    for (const name of ["floor", ...WALLS]) {
      expect((part(scene, name).material as MeshLambertMaterial).side, name).toBe(FrontSide);
    }
  });

  it("marks every metre on the floor with a line each way, counted from the corner so the squares along a wall can be counted", () => {
    const grid = part<LineSegments>(createRoomScene(room), "floor-grid");
    const points = grid.geometry.getAttribute("position");
    const lines: { from: number[]; to: number[] }[] = [];
    for (let i = 0; i < points.count; i += 2) {
      lines.push({
        from: [points.getX(i), points.getZ(i)],
        to: [points.getX(i + 1), points.getZ(i + 1)],
      });
    }

    // 6 m wide, counted from the left wall at x = -3: lines at x = -3 to 3, running along the length.
    // 4.5 m long, counted from the back wall at z = -2.25: lines at z = -2.25, -1.25, -0.25, 0.75
    // and 1.75, running along the width.
    const acrossLength = lines.filter((line) => line.from[0] === line.to[0]);
    const acrossWidth = lines.filter((line) => line.from[1] === line.to[1]);
    expect(acrossLength.map((line) => line.from[0])).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(acrossWidth.map((line) => line.from[1])).toEqual([-2.25, -1.25, -0.25, 0.75, 1.75]);
    for (const line of acrossLength) expect([line.from[1], line.to[1]]).toEqual([-2.25, 2.25]);
    for (const line of acrossWidth) expect([line.from[0], line.to[0]]).toEqual([-3, 3]);
  });

  it("keeps the grid on the floor, inside the room", () => {
    for (const size of ROOMS) {
      const box = boxOf(part(createRoomScene(size), "floor-grid"));
      expect(box.min.y).toBeGreaterThan(0);
      expect(box.max.y).toBeLessThan(0.01);
      expect(box.min.x).toBeGreaterThanOrEqual(-size.width_m / 2 - 1e-9);
      expect(box.max.x).toBeLessThanOrEqual(size.width_m / 2 + 1e-9);
      expect(box.min.z).toBeGreaterThanOrEqual(-size.length_m / 2 - 1e-9);
      expect(box.max.z).toBeLessThanOrEqual(size.length_m / 2 + 1e-9);
    }
  });

  it("outlines the room, so the edges of the walls nearest the camera are still shown", () => {
    for (const size of ROOMS) {
      const box = boxOf(part(createRoomScene(size), "room-edges"));
      const where = JSON.stringify(size);

      expectNear(box.min.toArray(), [-size.width_m / 2, 0, -size.length_m / 2], where);
      expectNear(box.max.toArray(), [size.width_m / 2, size.height_m, size.length_m / 2], where);
    }
  });

  it("has light from the sky and from one side, or the room would be black", () => {
    const scene = createRoomScene(room);

    expect(scene.children.some((child) => child instanceof HemisphereLight)).toBe(true);
    expect(scene.children.some((child) => child instanceof DirectionalLight)).toBe(true);
  });

  it("makes each scene from its own parts, so freeing one does not affect another", () => {
    const first = createRoomScene(room);
    const second = createRoomScene(room);

    expect(part(first, "floor").geometry).not.toBe(part(second, "floor").geometry);
    expect(part(first, "floor").material).not.toBe(part(second, "floor").material);
    expect(part(first, "wall-back").material).not.toBe(part(second, "wall-back").material);
  });
});

describe("disposeScene", () => {
  it("frees every geometry and material of the scene", () => {
    const scene = createRoomScene(room);
    // The walls share one material, so the parts are collected as objects, each once.
    const held = new Set<BufferGeometry | Material>();
    scene.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof LineSegments)) return;
      held.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) held.add(material);
    });
    const freed = new Set<unknown>();
    for (const item of held) vi.spyOn(item, "dispose").mockImplementation(() => void freed.add(item));

    disposeScene(scene);

    // Seven shapes (floor, four walls, grid, edges) and four materials (floor, wall paint, grid, edges).
    expect(held.size).toBeGreaterThanOrEqual(11);
    for (const item of held) expect(freed.has(item), item.type).toBe(true);
  });
});
