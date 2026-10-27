import {
  BoxGeometry,
  BufferGeometry,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
} from "three";
import type { RoomSize } from "../shared/room";

/**
 * The 3D room, and the axes everything in the viewer uses. One unit is one metre. The origin is
 * the middle of the floor, and y points up from the floor: x runs along the width and z along the
 * length, so the room fills x from -width/2 to width/2, y from 0 to the height and z from
 * -length/2 to length/2. Seen from above with x to the right, z runs down the screen, as in the
 * outline of the "Your room" step. The "front" of the room is the side where z is largest, which
 * is the side the camera starts on. A piece of furniture stands on the floor, so its place is
 * given by x and z, measured from the middle of the room.
 *
 * Every wall faces into the room and is drawn on that side only. From outside, the walls nearest
 * the camera face away from it and are not drawn, so they never hide the room; the far walls are.
 * From inside, all four are.
 */

const COLOURS = {
  floor: 0xd6c9b4,
  wall: 0xf2efe9,
  edge: 0x5f5f5f,
  grid: 0xa99d89,
};

// The grid is lifted a little off the floor so the two do not flicker where they overlap.
const GRID_LIFT = 0.002;

/** One wall: a plane that faces into the room, at the given place and turned about the vertical axis. */
function wall(name: string, width: number, height: number, position: [number, number, number], turn: number, look: MeshLambertMaterial) {
  const mesh = new Mesh(new PlaneGeometry(width, height), look);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.y = turn;
  return mesh;
}

/**
 * Lines on the floor every metre, along both directions. They are counted from the corner, not
 * from the middle, so that the squares along a wall can be counted against the real room.
 */
function floorGrid({ width_m, length_m }: RoomSize) {
  const halfWidth = width_m / 2;
  const halfLength = length_m / 2;
  const points: number[] = [];
  for (let x = 0; x <= width_m; x++) points.push(x - halfWidth, 0, -halfLength, x - halfWidth, 0, halfLength);
  for (let z = 0; z <= length_m; z++) points.push(-halfWidth, 0, z - halfLength, halfWidth, 0, z - halfLength);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  const grid = new LineSegments(geometry, new LineBasicMaterial({ color: COLOURS.grid }));
  grid.name = "floor-grid";
  grid.position.y = GRID_LIFT;
  return grid;
}

/** The twelve edges of the room, which show where the walls nearest the camera would be. */
function roomEdges({ width_m, length_m, height_m }: RoomSize) {
  const box = new BoxGeometry(width_m, height_m, length_m);
  const edges = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: COLOURS.edge }));
  box.dispose();
  edges.name = "room-edges";
  // The box is centred on itself, so it is lifted half its height to stand on the floor.
  edges.position.set(0, height_m / 2, 0);
  return edges;
}

function emptyRoom(room: RoomSize) {
  const { width_m: w, length_m: l, height_m: h } = room;
  const group = new Group();
  group.name = "room";

  // The floor is centred on the origin already; only turning it to lie flat is left to do.
  const floor = new Mesh(new PlaneGeometry(w, l), new MeshLambertMaterial({ color: COLOURS.floor }));
  floor.name = "floor";
  floor.rotation.x = -Math.PI / 2;

  const paint = new MeshLambertMaterial({ color: COLOURS.wall });
  group.add(
    floor,
    wall("wall-back", w, h, [0, h / 2, -l / 2], 0, paint),
    wall("wall-front", w, h, [0, h / 2, l / 2], Math.PI, paint),
    wall("wall-left", l, h, [-w / 2, h / 2, 0], Math.PI / 2, paint),
    wall("wall-right", l, h, [w / 2, h / 2, 0], -Math.PI / 2, paint),
    floorGrid(room),
    roomEdges(room),
  );
  return group;
}

/** Light from the sky and from one side, so that walls facing different ways are not the same shade. */
function lights() {
  const sky = new HemisphereLight(0xffffff, 0xb9b1a3, 2.4);
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(-3, 8, 5);
  sky.name = "sky-light";
  sun.name = "side-light";
  return [sky, sun];
}

/** An empty room of the given size: floor, walls and lights, with nothing in it yet. */
export function createRoomScene(room: RoomSize): Scene {
  const scene = new Scene();
  scene.add(emptyRoom(room), ...lights());
  return scene;
}

/** Frees what the scene holds on the graphics card. Call it when the scene is no longer used. */
export function disposeScene(scene: Scene) {
  scene.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.dispose();
    }
  });
}
