import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { e2eClockEnv } from "./test-isolation/e2e-clock.mjs";
import {
  MAX_SLOTS,
  acquireNamedLock,
  acquireSlot,
  calculateResources,
  getLockRoot,
  validateSlot,
} from "./test-isolation/resources.mjs";

const VALID_KINDS = ["integration", "e2e", "performance", "migration", "audit"];

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

// Parse quoted CLI arguments without evaluating shell substitutions or operators.
export function parseE2eArgs(value) {
  const args = [];
  let arg = "", quote = "", started = false, escaped = false;
  for (const char of value) {
    if (escaped) { arg += char; escaped = false; started = true; }
    else if (char === "\\" && quote !== "'") { escaped = true; started = true; }
    else if (quote) {
      if (char === quote) quote = "";
      else arg += char;
    } else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) {
      if (started) { args.push(arg); arg = ""; started = false; }
    } else { arg += char; started = true; }
  }
  if (quote || escaped) throw new Error("E2E_ARGS has an unterminated quote or escape");
  if (started) args.push(arg);
  return args;
}

function buildTestCommand(kind) {
  switch (kind) {
    case "integration":
      return ["pnpm", ["--filter", "@sui/backend", "test:integration:run"]];
    case "e2e":
      return ["pnpm", ["test:e2e", ...parseE2eArgs(process.env.E2E_ARGS ?? "")]];
    case "migration":
      return ["node", ["packages/db/scripts/test-audit-migration.mjs"]];
    case "audit":
      return ["node", ["scripts/test-audit-stdout.mjs"]];
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
  process.env.SUI_TEST_BACKEND_PORT = String(resources.backendPort);
  process.env.DATABASE_URL = resources.databaseUrl;
}

function setE2eEnv(resources) {
  process.env.SUI_E2E_RUN_ID = resources.runId;
  process.env.SUI_E2E_TEMPLATE_URL = resources.databaseUrl;
  process.env.SUI_E2E_STATIC_DIR = path.join(resources.testResultsDir, "frontend");
}

function createAbortError() {
  const error = new Error("slot acquisition aborted");
  error.code = "ABORTED";
  return error;
}

const ownedProcessGroups = new WeakSet();
const signalledChildren = new WeakSet();

function signalChild(child, signal) {
  if (!child || signalledChildren.has(child)) return;
  signalledChildren.add(child);
  if (ownedProcessGroups.has(child) && child.pid) {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  } else if (!child.killed) {
    child.kill(signal);
  }
}

async function drainProcessGroup(child) {
  if (!ownedProcessGroups.has(child) || !signalledChildren.has(child) || !child.pid) return;
  const deadline = performance.now() + 10_000;
  while (true) {
    try { process.kill(-child.pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; throw error; }
    if (performance.now() >= deadline) {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let onAbort;
    let settled = false;
    let abortRequested = false;

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
      abortRequested = true;
      signalChild(child, "SIGTERM");
    };

    if (options.signal?.aborted) {
      return settle(createAbortError());
    }

    child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      env: options.env ?? process.env,
      cwd: options.cwd ?? process.cwd(),
      // A private process group lets cancellation reach pnpm/tsx descendants too.
      detached: process.platform !== "win32",
    });
    if (process.platform !== "win32") ownedProcessGroups.add(child);
    currentChild = child;

    child.on("error", (error) => {
      currentChild = null;
      settle(error);
    });

    child.on("exit", async (code, signal) => {
      currentChild = null;
      try { await drainProcessGroup(child); }
      catch (error) { settle(error); return; }
      if (signal || abortRequested) {
        const exitSignal = signal ?? "SIGTERM";
        const error = new Error(`${command} exited with signal ${exitSignal}`);
        error.signal = exitSignal;
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

    if (kind !== "migration") {
      await runCommandFn("pnpm", ["--filter", "@sui/db", "exec", "prisma", "migrate", "deploy"], { signal });
    }

    if (kind === "e2e") {
      // Build once per run; distinct output directories also isolate concurrent runs.
      await runCommandFn("pnpm", ["--filter", "@sui/frontend", "exec", "vite", "build",
        "--outDir", process.env.SUI_E2E_STATIC_DIR], { signal });
    }

    const [testCommand, testArgs] = buildTestCommand(kind);
    const env = kind === "e2e" ? e2eClockEnv() : process.env;
    if (kind === "e2e") log("E2E business clock:", env.SUI_E2E_NOW);
    await runCommandFn(testCommand, testArgs, { signal, env });
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
    signalChild(child, killSignal);
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
      signalChild(currentChild, signal);
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
