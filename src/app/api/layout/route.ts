import { createLayoutHandler } from "@/server/layout-handler";

// POST /api/layout: how the browser asks the AI for a layout. The API key stays on the server.
export const POST = createLayoutHandler();
