import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { getEventListeners } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import {
  buildComposeDownArgsFor,
  buildComposeUpArgsFor,
  buildTestCommandFor,
  createFatalErrorHandler,
  runCommand,
  runLifecycle,
} from "../run-isolated-test.mjs";
import { MAX_SLOTS, getSlotLockPort } from "./resources.mjs";

const originalEnv = { ...process.env };

let runnerTestBase = 63_000;
function nextRunnerLockPortBase() {
  runnerTestBase += 100;
  return runnerTestBase;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen({ port, host: "127.0.0.1" }, () => {
      s.close(() => resolve(true));
    });
    s.on("error", () => resolve(false));
  });
}

function tmpDir() {
  return path.join(os.tmpdir(), `sui-runner-test-${Date.now()}-${process.pid}`);
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
}

async function cleanupRunDirs(runId) {
  for (const base of ["test-results", "playwright-report"]) {
    const dir = path.resolve(process.cwd(), base, runId);
    await rm(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  restoreEnv();
});

describe("runner command building", () => {
  const resources = {
    slot: 3,
    composeProject: "sui-test-3",
    pgPort: 5558,
    backendPort: 3130,
    mockIdpPort: 3131,
    frontendPort: 5204,
  };

  it("builds a project-scoped docker compose up command", () => {
    const args = buildComposeUpArgsFor(resources);
    assert.deepEqual(args, [
      "compose",
      "-p",
      "sui-test-3",
      "-f",
      "compose_db.yaml",
      "up",
      "-d",
      "--wait",
    ]);
  });

  it("builds a project-scoped docker compose down command with volume cleanup", () => {
    const args = buildComposeDownArgsFor(resources);
    assert.deepEqual(args, [
      "compose",
      "-p",
      "sui-test-3",
      "-f",
      "compose_db.yaml",
      "down",
      "--volumes",
      "--remove-orphans",
    ]);
  });

  it("does not include any global port filter in compose commands", () => {
    for (const builder of [buildComposeUpArgsFor, buildComposeDownArgsFor]) {
      const args = builder(resources).join(" ");
      assert.ok(!args.includes("docker ps"), `command contains 'docker ps': ${args}`);
      assert.ok(!args.includes("publish="), `command contains port filter: ${args}`);
      assert.ok(args.includes("sui-test-3"), `command missing project name: ${args}`);
    }
  });

  it("builds the correct test commands for each kind", () => {
    assert.deepEqual(buildTestCommandFor("integration"), [
      "pnpm",
      ["--filter", "@sui/backend", "test:integration:run"],
    ]);
    assert.deepEqual(buildTestCommandFor("e2e"), ["pnpm", ["test:e2e"]]);
    assert.deepEqual(buildTestCommandFor("performance"), [
      "pnpm",
      ["--filter", "@sui/backend", "exec", "vitest", "run", "--config", "vitest.performance.config.ts"],
    ]);
  });
});

describe("runner lifecycle", () => {
  const lockRoot = tmpDir();

  after(async () => {
    await rm(lockRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("pre-cleans, starts the DB, runs the test, and releases the slot on success", async () => {
    const runId = `runner-success-${Date.now()}`;
    const lockPortBase = nextRunnerLockPortBase();
    const slot = 2;
    const calls = [];

    const runCommandFn = async (command, args) => {
      calls.push([command, args]);
    };

    const exitCode = await runLifecycle({
      kind: "integration",
      fixedSlot: slot,
      maxSlots: MAX_SLOTS,
      lockRoot,
      lockPortBase,
      runCommandFn,
      runId,
    });

    assert.equal(exitCode, 0);

    const projectName = `sui-test-${slot}`;
    const dockerDownIndexes = calls
      .map(([cmd, args], index) => (cmd === "docker" && args.includes("down") ? index : -1))
      .filter((i) => i !== -1);
    const dockerUpIndex = calls.findIndex(
      ([cmd, args]) => cmd === "docker" && args.includes("up"),
    );
    const testIndex = calls.findIndex(
      ([cmd, args]) => cmd === "pnpm" && args.includes("test:integration:run"),
    );

    assert.equal(dockerDownIndexes.length, 2, "must pre-clean and final-cleanup");
    const [preCleanIndex, finalDownIndex] = dockerDownIndexes;

    assert.ok(preCleanIndex < dockerUpIndex, "pre-clean must run before docker up");
    assert.ok(dockerUpIndex < testIndex, "docker up must run before the test");
    assert.ok(testIndex < finalDownIndex, "final docker down must run after the test");
    assert.ok(calls[dockerUpIndex][1].includes(projectName));
    for (const i of dockerDownIndexes) {
      assert.ok(calls[i][1].includes(projectName));
    }

    assert.equal(await isPortFree(getSlotLockPort(slot, lockPortBase)), true, "slot lock port must be released");

    await cleanupRunDirs(runId);
  });

  it("returns the test exit code, runs docker down, and releases the slot on failure", async () => {
    const runId = `runner-failure-${Date.now()}`;
    const lockPortBase = nextRunnerLockPortBase();
    const slot = 3;
    const calls = [];

    const runCommandFn = async (command, args) => {
      calls.push([command, args]);
      if (command === "pnpm" && args.includes("test:integration:run")) {
        const error = new Error("intentional test failure");
        error.exitCode = 42;
        throw error;
      }
    };

    const exitCode = await runLifecycle({
      kind: "integration",
      fixedSlot: slot,
      maxSlots: MAX_SLOTS,
      lockRoot,
      lockPortBase,
      runCommandFn,
      runId,
    });

    assert.equal(exitCode, 42);

    const downCalls = calls.filter(([cmd, args]) => cmd === "docker" && args.includes("down"));
    assert.equal(downCalls.length, 2, "pre-clean and final down must run");
    assert.ok(downCalls.every(([, args]) => args.includes(`sui-test-${slot}`)));

    assert.equal(await isPortFree(getSlotLockPort(slot, lockPortBase)), true, "slot lock port must be released");

    await cleanupRunDirs(runId);
  });

  it("returns a non-zero exit code and releases the slot when final cleanup fails", async () => {
    const runId = `runner-cleanup-failure-${Date.now()}`;
    const lockPortBase = nextRunnerLockPortBase();
    const slot = 5;
    let downCount = 0;

    const runCommandFn = async (command, args) => {
      if (command === "docker" && args.includes("down")) {
        downCount += 1;
        if (downCount === 2) {
          const error = new Error("cleanup down failed");
          error.exitCode = 7;
          throw error;
        }
      }
    };

    const exitCode = await runLifecycle({
      kind: "integration",
      fixedSlot: slot,
      maxSlots: MAX_SLOTS,
      lockRoot,
      lockPortBase,
      runCommandFn,
      runId,
    });

    assert.equal(exitCode, 1, "a cleanup failure must make the run fail");

    assert.equal(await isPortFree(getSlotLockPort(slot, lockPortBase)), true, "slot lock port must be released");

    await cleanupRunDirs(runId);
  });

  it("returns 130 and cleans up when the test receives SIGINT", async () => {
    const runId = `runner-sigint-${Date.now()}`;
    const lockPortBase = nextRunnerLockPortBase();
    const slot = 6;
    const calls = [];

    const runCommandFn = async (command, args) => {
      calls.push([command, args]);
      if (command === "pnpm" && args.includes("test:integration:run")) {
        const error = new Error("killed by SIGINT");
        error.signal = "SIGINT";
        throw error;
      }
    };

    const exitCode = await runLifecycle({
      kind: "integration",
      fixedSlot: slot,
      maxSlots: MAX_SLOTS,
      lockRoot,
      lockPortBase,
      runCommandFn,
      runId,
    });

    assert.equal(exitCode, 130);

    const downCalls = calls.filter(([cmd, args]) => cmd === "docker" && args.includes("down"));
    assert.equal(downCalls.length, 2, "pre-clean and final down must run");
    assert.ok(downCalls.every(([, args]) => args.includes(`sui-test-${slot}`)));

    assert.equal(await isPortFree(getSlotLockPort(slot, lockPortBase)), true, "slot lock port must be released");

    await cleanupRunDirs(runId);
  });

  it("aborts cleanly when the signal is already aborted", async () => {
    const runId = `runner-abort-${Date.now()}`;
    const lockPortBase = nextRunnerLockPortBase();
    const slot = 4;
    const controller = new AbortController();
    controller.abort();

    const runCommandFn = async () => {
      throw new Error("runCommandFn should not be called");
    };

    const exitCode = await runLifecycle({
      kind: "integration",
      fixedSlot: slot,
      maxSlots: MAX_SLOTS,
      lockRoot,
      lockPortBase,
      runCommandFn,
      signal: controller.signal,
      runId,
    });

    assert.equal(exitCode, 130);

    assert.equal(await isPortFree(getSlotLockPort(slot, lockPortBase)), true, "slot lock port must be released");

    await cleanupRunDirs(runId);
  });

  it("returns 130 and cleans up when the test command is aborted mid-run", async () => {
    const runId = `runner-abort-midrun-${Date.now()}`;
    const lockPortBase = nextRunnerLockPortBase();
    const slot = 7;
    const calls = [];

    let startTestResolve;
    const testStarted = new Promise((resolve) => { startTestResolve = resolve; });

    const runCommandFn = async (command, args, options) => {
      calls.push([command, args]);
      if (command === "pnpm" && args.includes("test:integration:run")) {
        startTestResolve();
        return new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("killed by abort");
            error.code = "ABORTED";
            reject(error);
          }, { once: true });
        });
      }
      if (options.signal?.aborted) {
        const error = new Error("aborted");
        error.code = "ABORTED";
        throw error;
      }
    };

    const controller = new AbortController();
    const lifecycle = runLifecycle({
      kind: "integration",
      fixedSlot: slot,
      maxSlots: MAX_SLOTS,
      lockRoot,
      lockPortBase,
      runCommandFn,
      signal: controller.signal,
      runId,
    });

    await testStarted;
    controller.abort();

    const exitCode = await lifecycle;

    assert.equal(exitCode, 130);

    const downCalls = calls.filter(([cmd, args]) => cmd === "docker" && args.includes("down"));
    assert.equal(downCalls.length, 2, "pre-clean and final down must run");
    assert.ok(downCalls.every(([, args]) => args.includes(`sui-test-${slot}`)));

    assert.equal(await isPortFree(getSlotLockPort(slot, lockPortBase)), true, "slot lock port must be released");

    await cleanupRunDirs(runId);
  });

  it("returns non-zero and cleans up when slot release fails", async () => {
    const runId = `runner-release-failure-${Date.now()}`;
    const lockPortBase = nextRunnerLockPortBase();
    const slot = 8;

    // Inject a close() that fails only on the second release call.  The first
    // release is the generate lock; the second is the slot release.
    // The real net.Server is still closed in the failure case so the test
    // worker does not leak a listening handle.
    let closeCallCount = 0;
    const slotDeps = {
      close: (server) => new Promise((resolve, reject) => {
        closeCallCount += 1;
        if (!server) {
          resolve();
          return;
        }
        if (server.listening === false) {
          // net.Server.close() would throw ERR_SERVER_NOT_RUNNING; mirror that.
          reject(new Error("Server is not running"));
          return;
        }
        server.close((error) => {
          if (closeCallCount === 2) {
            reject(new Error("slot release close failed"));
            return;
          }
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
    };

    const runCommandFn = async (command, args) => {
      if (command === "pnpm" && args.includes("test:integration:run")) {
        return;
      }
      if (command === "pnpm" && args.join(" ").includes("prisma generate")) {
        return;
      }
      if (command === "pnpm" && args.join(" ").includes("prisma migrate")) {
        return;
      }
      if (command === "docker") {
        return;
      }
    };

    const exitCode = await runLifecycle({
      kind: "integration",
      fixedSlot: slot,
      maxSlots: MAX_SLOTS,
      lockRoot,
      lockPortBase,
      runCommandFn,
      deps: slotDeps,
      runId,
    });

    assert.equal(exitCode, 1, "release failure must make the run fail");

    await cleanupRunDirs(runId);
  });
});

describe("runCommand", () => {
  it("rejects without spawning when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const start = Date.now();

    let error;
    try {
      await runCommand("node", ["-e", "setTimeout(()=>{}, 10000)"], { signal: controller.signal });
    } catch (e) {
      error = e;
    }

    assert.ok(error, "must reject");
    assert.equal(error.code, "ABORTED");
    assert.equal(error.message, "slot acquisition aborted");
    assert.ok(Date.now() - start < 500, "must reject immediately without starting the child");
  });

  it("terminates a child that started just before the abort signal", async () => {
    const controller = new AbortController();

    const command = runCommand("node", ["-e", "setTimeout(()=>{}, 10000)"], { signal: controller.signal });

    // Wait a tiny amount so the child spawns and the listener is registered,
    // then abort.  runCommand() rechecks after listener installation.
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    let error;
    try {
      await command;
    } catch (e) {
      error = e;
    }

    assert.ok(error, "must reject");
    assert.equal(error.signal, "SIGTERM");
    assert.ok(error.message.includes("exited with signal"), "must report the child was killed");
  });

  it("removes the abort listener after the child exits", async () => {
    const controller = new AbortController();

    await runCommand("node", ["-e", "process.exit(0)"], { signal: controller.signal });

    assert.equal(getEventListeners(controller.signal, "abort").length, 0, "listener must be removed");
  });
});

describe("fatal error handling", () => {
  it("kills the active child, sets exit code, and aborts the controller", () => {
    const controller = new AbortController();
    const child = {
      killed: false,
      killedWith: null,
      kill(signal) {
        this.killed = true;
        this.killedWith = signal;
      },
    };
    let exitCodeSet = null;

    const handleFatal = createFatalErrorHandler({
      getCurrentChild: () => child,
      setExitCode: (code) => { exitCodeSet = code; },
      controller,
      logFn: () => {},
    });

    handleFatal(new Error("fatal"));

    assert.equal(exitCodeSet, 1, "must set exit code to 1");
    assert.equal(child.killed, true, "must kill the active child");
    assert.equal(child.killedWith, "SIGTERM", "must use SIGTERM by default");
    assert.equal(controller.signal.aborted, true, "must abort the lifecycle controller");

    // Idempotent: a second fatal call must not re-kill or reset state.
    handleFatal(new Error("again"));
    assert.equal(exitCodeSet, 1);
    assert.equal(child.killedWith, "SIGTERM");
  });
});
