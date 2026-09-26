import { fork } from "node:child_process";
import { openSync, closeSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface WorkerEnvironment {
  baseURL: string;
  databaseUrl: string;
  stop: () => Promise<void>;
}

export async function startWorker(workerIndex: number): Promise<WorkerEnvironment> {
  if (!process.env.SUI_E2E_RUN_ID || !process.env.SUI_E2E_STATIC_DIR) {
    throw new Error("Use make test-e2e to prepare the isolated E2E environment");
  }
  const logDir = path.resolve("test-results", process.env.SUI_E2E_RUN_ID, "workers");
  mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${workerIndex}.log`);
  const log = openSync(logPath, "w");
  const child = fork(path.resolve("e2e/helpers/worker-server.ts"), [], {
    execArgv: [
      "--import", pathToFileURL(path.resolve("packages/backend/node_modules/tsx/dist/loader.mjs")).href,
    ],
    env: { ...process.env, SUI_E2E_WORKER_ID: String(workerIndex) },
    stdio: ["ignore", log, log, "ipc"],
  });
  closeSync(log);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try { await exited; } finally { clearTimeout(timer); }
  };
  try {
    const ready = await new Promise<{ baseURL: string; databaseUrl: string }>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Worker startup timed out; see ${logPath}`)), 45_000);
      const onExit = (code: number | null) => finish(new Error(`Worker exited (${code}); see ${logPath}`));
      const onError = (error: Error) => finish(error);
      const onMessage = (message: unknown) => {
        if (message && typeof message === "object" && "baseURL" in message && "databaseUrl" in message
          && typeof message.baseURL === "string" && typeof message.databaseUrl === "string") {
          finish(undefined, { baseURL: message.baseURL, databaseUrl: message.databaseUrl });
        }
      };
      function finish(error?: Error, value?: { baseURL: string; databaseUrl: string }) {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        child.off("message", onMessage);
        if (error) reject(error);
        else resolve(value!);
      }
      child.once("exit", onExit);
      child.once("error", onError);
      child.on("message", onMessage);
    });
    return { ...ready, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
