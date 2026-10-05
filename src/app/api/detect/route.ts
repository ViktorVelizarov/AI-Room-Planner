import { createDetectHandler } from "@/server/detect-handler";

// POST /api/detect: the only way the browser reaches the AI. The API key stays on the server.
export const POST = createDetectHandler();
