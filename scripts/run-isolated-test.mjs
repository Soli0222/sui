import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  MAX_SLOTS,
  acquireNamedLock,
  acquireSlot,
  calculateResources,
  getLockRoot,
  validateSlot,
} from "./test-isolation/resources.mjs";

const VALID_KINDS = ["integration", "e2e", "performance"];

let currentChild = null;

function log(...args) {
  console.error("[sui-test]", ...args);
}

function resolveFixedSlot() {
  const raw = process.env.SUI_TEST_SLOT;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  return validateSlot(raw, MAX_SLOTS);
}

function buildComposeUpArgs(resources) {
  return [
    "compose",
    "-p", resources.composeProject,
    "-f", "compose_db.yaml",
    "up",
    "-d",
    "--wait",
  ];
}

function buildComposeDownArgs(resources) {
  return [
    "compose",
    "-p", resources.composeProject,
    "-f", "compose_db.yaml",
    "down",
    "--volumes",
    "--remove-orphans",
  ];
}

function buildTestCommand(kind) {
  switch (kind) {
    case "integration":
      return ["pnpm", ["--filter", "@sui/backend", "test:integration:run"]];
    case "e2e":
      return ["pnpm", ["test:e2e"]];
    case "performance":
      return [
        "pnpm",
        ["--filter", "@sui/backend", "exec", "vitest", "run", "--config", "vitest.performance.config.ts"],
      ];
    default:
      throw new Error(`unknown test kind: ${kind}`);
  }
}

function setSharedEnv(resources) {
  process.env.SUI_TEST_SLOT = String(resources.slot);
  process.env.SUI_TEST_COMPOSE_PROJECT = resources.composeProject;
  process.env.SUI_TEST_PG_PORT = String(resources.pgPort);
  process.env.DATABASE_URL = resources.databaseUrl;
}

function setE2eEnv(resources) {
  process.env.PORT = String(resources.backendPort);
  process.env.MOCK_IDP_PORT = String(resources.mockIdpPort);
  process.env.SUI_OIDC_ISSUER = resources.mockIdpUrl;
  process.env.SUI_OIDC_CLIENT_ID = "sui-e2e";
  process.env.SUI_OIDC_CLIENT_SECRET = "e2e-secret";
  process.env.SUI_OIDC_REDIRECT_URI = resources.redirectUri;
  process.env.SUI_OIDC_ALLOWED_SUBJECTS = "e2e-user";
  process.env.SUI_COOKIE_SECURE = "false";
  process.env.SUI_FRONTEND_URL = resources.frontendUrl;
  process.env.SUI_AUTH_MODE = "enabled";
  process.env.VITE_API_BASE = resources.backendUrl;
  process.env.SUI_E2E_RUN_ID = resources.runId;
  process.env.SUI_E2E_BACKEND_PORT = String(resources.backendPort);
  process.env.SUI_E2E_IDP_PORT = String(resources.mockIdpPort);
  process.env.SUI_E2E_FRONTEND_PORT = String(resources.frontendPort);
}

function createAbortError() {
  const error = new Error("slot acquisition aborted");
  error.code = "ABORTED";
  return error;
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let onAbort;
    let settled = false;

    function settle(value) {
      if (settled) return;
      settled = true;
      if (options.signal && onAbort) {
        options.signal.removeEventListener("abort", onAbort);
      }
      if (value instanceof Error) {
        reject(value);
      } else {
        resolve(value);
      }
    }

    onAbort = () => {
      if (child && !child.killed) {
        child.kill("SIGTERM");
      }
    };

    if (options.signal?.aborted) {
      return settle(createAbortError());
    }

    child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      env: options.env ?? process.env,
      cwd: options.cwd ?? process.cwd(),
    });
    currentChild = child;

    child.on("error", (error) => {
      currentChild = null;
      settle(error);
    });

    child.on("exit", (code, signal) => {
      currentChild = null;
      if (signal) {
        const error = new Error(`${command} exited with signal ${signal}`);
        error.signal = signal;
        error.exitCode = null;
        settle(error);
      } else if (code !== 0) {
        const error = new Error(`${command} exited with code ${code}`);
        error.exitCode = code;
        settle(error);
      } else {
        settle();
      }
    });

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
      // Recheck after listener installation to close the race between the
      // pre-spawn check and registration.  If already aborted, we kill the
      // just-started child exactly once.
      if (options.signal.aborted) {
        onAbort();
      }
    }
  });
}

function logResources(resources) {
  log("resolved resources:", {
    slot: resources.slot,
    runId: resources.runId,
    composeProject: resources.composeProject,
    pgPort: resources.pgPort,
    backendPort: resources.backendPort,
    mockIdpPort: resources.mockIdpPort,
    frontendPort: resources.frontendPort,
    databaseUrl: resources.databaseUrl,
    frontendUrl: resources.frontendUrl,
    testResultsDir: resources.testResultsDir,
    reportDir: resources.reportDir,
  });
}

export function buildComposeUpArgsFor(resources) {
  return buildComposeUpArgs(resources);
}

export function buildComposeDownArgsFor(resources) {
  return buildComposeDownArgs(resources);
}

export function buildTestCommandFor(kind) {
  return buildTestCommand(kind);
}

export async function runLifecycle({
  kind,
  fixedSlot,
  maxSlots = MAX_SLOTS,
  lockRoot = getLockRoot(),
  lockPortBase,
  runCommandFn = runCommand,
  signal,
  runId,
  deps,
} = {}) {
  let acquired = null;
  let resources = null;
  let exitCode = 0;
  let teardownError = null;

  async function cleanup() {
    if (resources) {
      try {
        // Cleanup compose down is deliberately un-aborted so it can finish even
        // when the lifecycle signal has fired.  Do not pass `signal` here.
        await runCommandFn("docker", buildComposeDownArgs(resources), { stdio: "ignore" });
        log("docker compose down completed for project", resources.composeProject);
      } catch (error) {
        log("docker compose down failed:", error.message);
        teardownError = error;
      }
    }
    if (acquired) {
      try {
        await acquired.release();
        log("released slot", acquired.slot);
      } catch (error) {
        log("failed to release slot:", error.message);
        teardownError = error;
      }
    }
  }

  try {
    acquired = await acquireSlot({ fixedSlot, maxSlots, lockRoot, lockPortBase, signal, deps });
    resources = calculateResources(acquired.slot, runId, maxSlots);
    logResources(resources);
    setSharedEnv(resources);
    if (kind === "e2e") {
      setE2eEnv(resources);
    }

    await mkdir(resources.testResultsDir, { recursive: true });
    await mkdir(path.join(resources.testResultsDir, "auth"), { recursive: true });

    // Pre-clean any leftover state from a hard crash or previous run.
    await runCommandFn("docker", buildComposeDownArgs(resources), { stdio: "ignore", signal });
    log("pre-clean completed for project", resources.composeProject);

    await runCommandFn("docker", buildComposeUpArgs(resources), { signal });

    const generateLock = await acquireNamedLock({ name: "generate", lockRoot, lockPortBase, signal, deps });
    try {
      await runCommandFn("pnpm", ["--filter", "@sui/db", "exec", "prisma", "generate"], { signal });
    } finally {
      try {
        await generateLock.release();
      } catch (error) {
        log("failed to release generate lock:", error.message);
        teardownError = error;
      }
    }

    await runCommandFn("pnpm", ["--filter", "@sui/db", "exec", "prisma", "migrate", "deploy"], { signal });

    const [testCommand, testArgs] = buildTestCommand(kind);
    await runCommandFn(testCommand, testArgs, { signal });
  } catch (error) {
    if (error.code === "ABORTED" || error.message === "slot acquisition aborted") {
      exitCode = 130;
    } else if (error.signal) {
      const signalNumber = error.signal === "SIGINT" ? 2 : error.signal === "SIGTERM" ? 15 : 0;
      exitCode = 128 + (signalNumber || 1);
    } else {
      log("test run failed:", error.message ?? error);
      exitCode = error.exitCode ?? 1;
    }
  } finally {
    await cleanup();
  }

  if (teardownError && exitCode === 0) {
    exitCode = 1;
  }

  return exitCode;
}

export function createFatalErrorHandler({
  getCurrentChild,
  setExitCode,
  controller,
  logFn = log,
  killSignal = "SIGTERM",
} = {}) {
  let handled = false;
  return (error) => {
    if (handled) return;
    handled = true;
    logFn("fatal error:", error);
    setExitCode(1);
    const child = getCurrentChild();
    if (child && !child.killed) {
      child.kill(killSignal);
    }
    controller.abort();
  };
}

function main() {
  const kind = process.argv[2];
  if (!VALID_KINDS.includes(kind)) {
    console.error(`Usage: node scripts/run-isolated-test.mjs <${VALID_KINDS.join("|")}>`);
    process.exit(1);
  }

  const fixedSlot = resolveFixedSlot();
  const lockRoot = getLockRoot();
  const controller = new AbortController();

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      log(`received ${signal}`);
      if (currentChild && !currentChild.killed) {
        currentChild.kill(signal);
      }
      controller.abort();
    });
  }

  const handleFatal = createFatalErrorHandler({
    getCurrentChild: () => currentChild,
    setExitCode: (code) => { process.exitCode = code; },
    controller,
  });

  process.on("uncaughtException", handleFatal);
  process.on("unhandledRejection", handleFatal);

  runLifecycle({
    kind,
    fixedSlot,
    lockRoot,
    signal: controller.signal,
  }).then(
    (exitCode) => {
      if (process.exitCode === undefined) {
        process.exitCode = exitCode;
      }
      process.exit();
    },
    (error) => {
      log("runner error:", error);
      if (process.exitCode === undefined) {
        process.exitCode = 1;
      }
      process.exit();
    },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
