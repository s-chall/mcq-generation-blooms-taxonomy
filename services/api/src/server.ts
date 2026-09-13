import { buildApp } from "./app.js";
import { PostgresJobRepository } from "./postgres-repository.js";

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "0.0.0.0";
const repository = PostgresJobRepository.fromEnvironment();
const app = buildApp(repository, true);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

await app.listen({ host, port });
