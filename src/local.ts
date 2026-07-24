import { serve } from "@hono/node-server";
import { app } from "./runtime.js";

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, ({ port: listeningPort }) => console.info(`Listening on http://localhost:${listeningPort}`));
