import { buildServer } from "./app.js";

const port = Number(process.env["PORT"] ?? 3001);
const host = process.env["HOST"] ?? "127.0.0.1";

const app = await buildServer({ logger: true });

try {
  await app.listen({ port, host });
  app.log.info(`CAN Log Narrator API listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
