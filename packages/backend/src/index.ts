import { serve } from "@hono/node-server";
import { createApp } from "./app";
const app = createApp();

const port = Number(process.env.PORT ?? "3000");

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`sui backend listening on http://localhost:${info.port}`);
  },
);
