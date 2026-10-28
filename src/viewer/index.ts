// Viewer module: the 3D room scene, furniture models and (later) VR.
// Runs in the browser. Must not import anything from ../ai.
export { createRoomViewer, type FurnitureReport, type RoomViewer, type RoomViewerOptions } from "./room-viewer";
export { arrangeInRows, type Placement } from "./arrangement";
export type { ModelLoader, PlacedPiece, UnmatchedPiece } from "./furniture-scene";
export type { CameraMove, CameraView } from "./camera-view";
export { MODEL_FOLDER, furnitureLibrary, loadFurnitureModel, modelFor, modelUrl, parseFurnitureModel } from "./furniture-library";
