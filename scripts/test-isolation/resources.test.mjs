import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
  BASE_BACKEND_PORT,
  BASE_FRONTEND_PORT,
  BASE_MOCK_IDP_PORT,
  BASE_PG_PORT,
  MAX_SLOTS,
  acquireNamedLock,
  acquireSlot,
  calculatePorts,
  calculateResources,
  delay,
  getSlotLockPort,
  isProcessAlive,
  validateLockPortBase,
  validateSlot,
} from "./resources.mjs";

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  resolve(value) { this._resolve(value); }
  reject(error) { this._reject(error); }
}

class Mutex {
  constructor() {
    this._promise = Promise.resolve();
  }

  async acquire() {
    let release;
    const current = this._promise;
    this._promise = new Promise((resolve) => { release = resolve; });
    await current;
    return () => {
      if (release) {
        release();
        release = null;
      }
    };
  }
}

function makeEaddrinuse() {
  const error = new Error("address in use");
  error.code = "EADDRINUSE";
  return error;
}

class FakePortLockStore {
  constructor({
    isProcessAliveFn = () => true,
    writeShouldFail = null,
    listenShouldFailAfter = null,
  } = {}) {
    this.ports = new Map();
    this.lockDirs = new Map();
    this.isProcessAliveFn = isProcessAliveFn;
    this.writeShouldFail = writeShouldFail;
    this.listenShouldFailAfter = listenShouldFailAfter;
    this.tokenCounter = 0;
    this.listenCount = 0;
    this.closedServers = [];
    this._mutex = new Mutex();
  }

  getSlotLockPort(slot) {
    return 10_000 + slot;
  }

  getNamedLockPort(name) {
    return name === "generate" ? 9999 : 11_000;
  }

  getLockDir(slot, lockRoot = "/locks") {
    return path.join(lockRoot, `sui-test-slot-${slot}.lock`);
  }

  getNamedLockDir(name, lockRoot = "/locks") {
    return path.join(lockRoot, `sui-test-${name}.lock`);
  }

  createToken() {
    return `token-${++this.tokenCounter}`;
  }

  async ensureLockRoot() {
    // no-op for in-memory store
  }

  async mkdir(dir) {
    if (!this.lockDirs.has(dir)) {
      this.lockDirs.set(dir, { meta: null, mtime: 0 });
    }
  }

  async rm(dir) {
    this.lockDirs.delete(dir);
  }

  async writeFile(filePath, content) {
    if (this.writeShouldFail) throw this.writeShouldFail;
    const dir = path.dirname(filePath);
    const entry = this.lockDirs.get(dir);
    if (!entry) throw new Error("lock dir missing");
    entry.meta = JSON.parse(content);
    entry.mtime = Date.now();
  }

  async readFile(filePath) {
    const dir = path.dirname(filePath);
    const entry = this.lockDirs.get(dir);
    if (!entry || !entry.meta) throw new Error("not found");
    return JSON.stringify(entry.meta);
  }

  createServer() {
    return {
      listening: false,
      _port: null,
      _token: null,
      on() {},
      off() {},
      once() {},
    };
  }

  async listen(server, { port }) {
    this.listenCount += 1;
    if (this.listenShouldFailAfter && this.listenCount >= this.listenShouldFailAfter) {
      throw makeEaddrinuse();
    }

    const release = await this._mutex.acquire();
    try {
      const current = this.ports.get(port);
      if (current && !current.released && this.isProcessAliveFn(current.pid)) {
        throw makeEaddrinuse();
      }

      this.ports.set(port, {
        server,
        pid: process.pid,
        token: server._token,
        released: false,
      });
      server.listening = true;
      server._port = port;
    } finally {
      release();
    }
  }

  async close(server) {
    if (!server) return;
    this.closedServers.push(server);

    const release = await this._mutex.acquire();
    try {
      if (server._port !== null) {
        const entry = this.ports.get(server._port);
        if (entry && entry.server === server) {
          entry.released = true;
          this.ports.delete(server._port);
        }
      }
      server.listening = false;
    } finally {
      release();
    }
  }

  async delay() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  isPortHeld(port) {
    const entry = this.ports.get(port);
    return Boolean(entry && !entry.released);
  }

  hasMeta(lockDir) {
    return this.lockDirs.has(lockDir);
  }

  meta(lockDir) {
    return this.lockDirs.get(lockDir)?.meta ?? null;
  }
}

function depsFromStore(store) {
  return {
    getLockDir: store.getLockDir.bind(store),
    getNamedLockDir: store.getNamedLockDir.bind(store),
    getSlotLockPort: store.getSlotLockPort.bind(store),
    getNamedLockPort: store.getNamedLockPort.bind(store),
    createToken: store.createToken.bind(store),
    ensureLockRoot: store.ensureLockRoot.bind(store),
    mkdir: store.mkdir.bind(store),
    rm: store.rm.bind(store),
    writeFile: store.writeFile.bind(store),
    readFile: store.readFile.bind(store),
    createServer: store.createServer.bind(store),
    listen: store.listen.bind(store),
    close: store.close.bind(store),
    delay: store.delay.bind(store),
    isProcessAlive: store.isProcessAliveFn,
    _store: store,
  };
}

function makeDeps(overrides = {}) {
  const store = new FakePortLockStore(overrides);
  return depsFromStore(store);
}

function tmpDir() {
  return path.join(os.tmpdir(), `sui-test-isolation-${Date.now()}-${process.pid}`);
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen({ port, host: "127.0.0.1" }, () => {
      s.close(() => resolve(true));
    });
    s.on("error", () => resolve(false));
  });
}

describe("slot validation and resource calculation", () => {
  it("validates slots 0..MAX_SLOTS-1", () => {
    for (let i = 0; i < MAX_SLOTS; i += 1) {
      assert.equal(validateSlot(i), i);
      assert.equal(validateSlot(String(i)), i);
    }
  });

  it("rejects invalid slots", () => {
    assert.throws(() => validateSlot(-1), /slot must be an integer/);
    assert.throws(() => validateSlot(MAX_SLOTS), /slot must be an integer/);
    assert.throws(() => validateSlot("abc"), /slot must be an integer/);
    assert.throws(() => validateSlot("1.5"), /slot must be an integer/);
    assert.throws(() => validateSlot(1.5), /slot must be an integer/);
  });

  it("validates lock-port base as an integer within the safe range", () => {
    assert.equal(validateLockPortBase(62_000), 62_000);
    assert.equal(validateLockPortBase("62000"), 62_000);
    assert.equal(validateLockPortBase(1025), 1025);
    assert.equal(validateLockPortBase(64426), 64426);
  });

  it("rejects invalid lock-port bases", () => {
    assert.throws(() => validateLockPortBase("abc"), /must be an integer/);
    assert.throws(() => validateLockPortBase(1024.5), /must be an integer/);
    assert.throws(() => validateLockPortBase(1024), /at least 1025/);
    assert.throws(() => validateLockPortBase(64527), /above 65535/);
    assert.throws(() => validateLockPortBase(70_000), /above 65535/);
  });

  it("rejects a lock-port base that would place slot or named ports above 65535", () => {
    assert.throws(() => validateLockPortBase(65_000, MAX_SLOTS), /above 65535/);
  });

  it("calculates per-slot ports using the documented formulas", () => {
    for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
      const ports = calculatePorts(slot);
      assert.equal(ports.pgPort, BASE_PG_PORT + slot);
      assert.equal(ports.backendPort, BASE_BACKEND_PORT + slot * 10);
      assert.equal(ports.mockIdpPort, BASE_MOCK_IDP_PORT + slot * 10);
      assert.equal(ports.frontendPort, BASE_FRONTEND_PORT + slot * 10);
    }
  });

  it("produces no overlapping ports or paths across all slots", () => {
    const seen = new Set();
    for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
      const resources = calculateResources(slot, `run-${slot}`);
      const values = [
        resources.composeProject,
        resources.pgPort,
        resources.backendPort,
        resources.mockIdpPort,
        resources.frontendPort,
        resources.databaseUrl,
      ];
      for (const value of values) {
        assert.ok(!seen.has(value), `duplicate resource value: ${value}`);
        seen.add(value);
      }
    }
  });

  it("keeps every derived port inside the safe range", () => {
    for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
      const { pgPort, backendPort, mockIdpPort, frontendPort } = calculatePorts(slot);
      for (const port of [pgPort, backendPort, mockIdpPort, frontendPort]) {
        assert.ok(port >= 1024, `port ${port} is below 1024`);
        assert.ok(port <= 65535, `port ${port} is above 65535`);
      }
    }
  });
});

describe("port lock acquisition and ownership", () => {
  it("acquires a free slot, writes metadata, and removes it on release", async () => {
    const deps = makeDeps();

    const acquired = await acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });
    assert.equal(acquired.slot, 0);
    assert.ok(deps._store.isPortHeld(deps.getSlotLockPort(0)));
    assert.equal(deps._store.meta(acquired.lockDir)?.token, acquired.token);

    await acquired.release();
    assert.ok(!deps._store.isPortHeld(deps.getSlotLockPort(0)));
    assert.ok(!deps._store.hasMeta(acquired.lockDir), "metadata must be removed during release");
  });

  it("acquires a fixed slot and waits until it is free", async () => {
    const deps = makeDeps();
    const first = await acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });

    const waiting = acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });

    await first.release();

    const second = await waiting;
    assert.equal(second.slot, 0);
    assert.notEqual(second.token, first.token);

    await second.release();
  });

  it("automatically allocates the first free slot without disturbing the others", async () => {
    const deps = makeDeps();
    const maxSlots = 5;
    const holders = [];
    for (let slot = 0; slot < maxSlots; slot += 1) {
      holders.push(await acquireSlot({ fixedSlot: slot, maxSlots, pollMs: 0, deps }));
    }

    for (let slot = 0; slot < maxSlots; slot += 1) {
      assert.ok(deps._store.isPortHeld(deps.getSlotLockPort(slot)), `slot ${slot} must be held`);
    }

    const firstDelayEntered = new Deferred();
    const firstDelayExit = new Deferred();
    let delayCalls = 0;
    const originalDelay = deps.delay;
    deps.delay = async (ms, signal) => {
      delayCalls += 1;
      if (delayCalls === 1) {
        firstDelayEntered.resolve();
        await firstDelayExit.promise;
      } else {
        await originalDelay(ms, signal);
      }
    };

    const waiter = acquireSlot({ maxSlots, pollMs: 0, deps });

    await firstDelayEntered.promise;
    assert.equal(delayCalls, 1, "waiter must have scanned all slots and then delayed");
    for (let slot = 0; slot < maxSlots; slot += 1) {
      assert.ok(deps._store.isPortHeld(deps.getSlotLockPort(slot)), `slot ${slot} must still be held`);
    }

    await holders[2].release();
    firstDelayExit.resolve();

    const acquired = await waiter;
    assert.equal(acquired.slot, 2, "waiter must acquire the released slot");

    await acquired.release();
    for (let slot = 0; slot < maxSlots; slot += 1) {
      if (slot !== 2) {
        await holders[slot].release();
      }
    }
  });

  it("release() removes its own metadata and never touches a replacement", async () => {
    const deps = makeDeps();

    // Inject a barrier so close() releases the port immediately but release()
    // does not return until a replacement has claimed the port.  This forces the
    // race where the old owner would, in a path-based protocol, read its own
    // token and then delete the replacement's lock.  The override must be
    // installed before acquisition because release() closes the server from a
    // closure captured at claim time.
    const portReleased = new Deferred();
    const closeBarrier = new Deferred();
    const originalClose = deps.close;
    deps.close = async (server) => {
      await originalClose(server);
      if (server?._port !== null) {
        portReleased.resolve();
        await closeBarrier.promise;
      }
    };

    const first = await acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });
    const firstLockDir = first.lockDir;

    const firstReleasePromise = first.release();

    await portReleased.promise;

    assert.ok(!deps._store.hasMeta(firstLockDir), "first owner's metadata must be removed before close");

    const second = await acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });
    assert.equal(second.slot, 0);
    assert.notEqual(second.token, first.token);
    assert.ok(deps._store.isPortHeld(deps.getSlotLockPort(0)), "second owner must hold the port");
    assert.equal(deps._store.meta(second.lockDir)?.token, second.token, "second owner's metadata must be written");

    closeBarrier.resolve();
    await firstReleasePromise;

    assert.ok(deps._store.isPortHeld(deps.getSlotLockPort(0)), "second owner must still hold the port after first release returns");
    assert.equal(deps._store.meta(second.lockDir)?.token, second.token, "second owner's metadata must survive");

    await second.release();
  });

  it("concurrent reclaimers cannot both acquire the same released slot", async () => {
    const deps = makeDeps();
    const first = await acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });

    // Release the old owner, then race two reclaimers for the same port.
    await first.release();

    const contentionSeen = new Deferred();
    const originalListen = deps.listen;
    deps.listen = async (server, options) => {
      try {
        await originalListen(server, options);
      } catch (error) {
        if (error.code === "EADDRINUSE") {
          contentionSeen.resolve();
        }
        throw error;
      }
    };

    const controller = new AbortController();
    contentionSeen.promise.then(() => controller.abort());

    const race = [
      acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, signal: controller.signal, deps }),
      acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, signal: controller.signal, deps }),
    ];

    const results = await Promise.allSettled(race);
    const fulfilled = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "exactly one concurrent reclaimer should win");
    assert.equal(rejected.length, 1, "the loser must abort, not hold a dangling lock");
    assert.ok(rejected[0].reason instanceof Error);
    assert.equal(deps._store.meta(fulfilled[0].lockDir)?.token, fulfilled[0].token);

    assert.ok(deps._store.isPortHeld(deps.getSlotLockPort(0)), "winner must still hold the port");
    assert.equal(deps._store.hasMeta(fulfilled[0].lockDir), true);

    await fulfilled[0].release();
  });

  it("cleans up metadata and closes the port when metadata write fails", async () => {
    const writeError = new Error("write failed");
    const deps = makeDeps({ writeShouldFail: writeError });
    const lockDir = deps.getLockDir(0);

    await assert.rejects(
      acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps }),
      { message: "write failed" },
    );

    assert.ok(!deps._store.isPortHeld(deps.getSlotLockPort(0)), "port must be released after write failure");
    assert.ok(!deps._store.hasMeta(lockDir), "metadata directory must be removed after write failure");
    assert.ok(deps._store.closedServers.length > 0, "server must be closed after write failure");
  });

  it("surfaces cleanup failures during metadata write as an AggregateError", async () => {
    const store = new FakePortLockStore({ writeShouldFail: new Error("write failed") });
    const originalRm = store.rm.bind(store);
    let rmCallCount = 0;
    store.rm = async (dir) => {
      rmCallCount += 1;
      if (rmCallCount === 2) throw new Error("rm cleanup failed");
      return originalRm(dir);
    };
    const deps = depsFromStore(store);

    let error;
    try {
      await acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });
    } catch (e) {
      error = e;
    }

    assert.ok(error instanceof AggregateError, "must surface an AggregateError when cleanup fails");
    assert.equal(error.message, "write failed", "primary message must be the write error");
    assert.ok(error.errors.some((e) => e.message === "write failed"), "must include the write error");
    assert.ok(error.errors.some((e) => e.message === "rm cleanup failed"), "must include the cleanup failure");
  });

  it("release() rejects and surfaces an rm failure", async () => {
    const store = new FakePortLockStore();
    const originalRm = store.rm.bind(store);
    let rmShouldFail = false;
    store.rm = async (dir) => {
      if (rmShouldFail) throw new Error("rm failed");
      return originalRm(dir);
    };
    const deps = depsFromStore(store);

    const acquired = await acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });
    rmShouldFail = true;

    let error;
    try {
      await acquired.release();
    } catch (e) {
      error = e;
    }

    assert.ok(error instanceof AggregateError, "must surface an AggregateError");
    assert.equal(error.message, "release failed", "must report release failed");
    assert.ok(error.errors.some((e) => e.message === "rm failed"));
    assert.ok(!deps._store.isPortHeld(deps.getSlotLockPort(0)), "port must still be closed even if rm failed");
  });

  it("release() rejects and surfaces a close failure", async () => {
    const store = new FakePortLockStore();
    const originalClose = store.close.bind(store);
    let closeShouldFail = false;
    store.close = async (server) => {
      if (closeShouldFail && server?.listening) throw new Error("close failed");
      return originalClose(server);
    };
    const deps = depsFromStore(store);

    const acquired = await acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });
    closeShouldFail = true;

    let error;
    try {
      await acquired.release();
    } catch (e) {
      error = e;
    }

    assert.ok(error instanceof AggregateError, "must surface an AggregateError");
    assert.equal(error.message, "release failed", "must report release failed");
    assert.ok(error.errors.some((e) => e.message === "close failed"));
    assert.ok(deps._store.isPortHeld(deps.getSlotLockPort(0)), "port must remain held when close fails");

  });

  it("reclaims a named lock and removes stale metadata under the TCP lease", async () => {
    const deps = makeDeps({ isProcessAliveFn: () => true });
    const first = await acquireNamedLock({ name: "generate", pollMs: 0, deps });
    const staleToken = first.token;

    deps._store.isProcessAliveFn = () => false;

    const second = await acquireNamedLock({ name: "generate", pollMs: 0, deps });
    assert.notEqual(second.token, staleToken);
    assert.equal(deps._store.meta(second.lockDir)?.token, second.token);

    await second.release();
    assert.ok(!deps._store.hasMeta(second.lockDir), "replacement metadata must be removed on release");
  });

  it("does not touch a winner's metadata from a losing EADDRINUSE path", async () => {
    const deps = makeDeps();
    const winner = await acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });
    const winnerToken = winner.token;

    const contentionSeen = new Deferred();
    const originalListen = deps.listen;
    deps.listen = async (server, options) => {
      try {
        await originalListen(server, options);
      } catch (error) {
        if (error.code === "EADDRINUSE") {
          contentionSeen.resolve();
        }
        throw error;
      }
    };

    const loser = acquireSlot({ fixedSlot: 0, maxSlots: 1, pollMs: 0, deps });

    await contentionSeen.promise;

    // While the loser is losing on the port, the winner's metadata must be
    // untouched and the loser must not have created any metadata.
    assert.equal(deps._store.meta(winner.lockDir)?.token, winnerToken);
    assert.equal(deps._store.hasMeta(winner.lockDir), true);

    await winner.release();

    const acquired = await loser;
    assert.notEqual(acquired.token, winnerToken, "loser must write its own token once it wins");
    assert.equal(deps._store.meta(acquired.lockDir)?.token, acquired.token);

    await acquired.release();
  });
});

describe("delay abort listener cleanup", () => {
  it("does not accumulate abort listeners across non-aborted delays", async () => {
    const controller = new AbortController();
    const signal = controller.signal;

    for (let i = 0; i < 100; i += 1) {
      await delay(0, signal);
      assert.equal(getEventListeners(signal, "abort").length, 0, `listener count should be 0 after delay ${i}`);
    }
  });

  it("removes the abort listener when the signal fires", async () => {
    const controller = new AbortController();
    const signal = controller.signal;

    const delayPromise = delay(10_000, signal);
    assert.equal(getEventListeners(signal, "abort").length, 1);

    controller.abort();
    await assert.rejects(delayPromise, /aborted/);

    assert.equal(getEventListeners(signal, "abort").length, 0);
  });
});

describe("real TCP port lock acquisition", () => {
  const lockRoot = tmpDir();
  let lockPortBase;
  let realTestBase = 56_000;
  let current = null;

  before(async () => {
    await mkdir(lockRoot, { recursive: true });
  });

  after(async () => {
    await rm(lockRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    realTestBase += 100;
    lockPortBase = realTestBase;
  });

  afterEach(async () => {
    if (current) {
      await current.release().catch(() => {});
      current = null;
    }
  });

  it("acquires, writes an owner file, removes it on release, and frees the port", async () => {
    const acquired = await acquireSlot({
      fixedSlot: 0,
      maxSlots: 1,
      pollMs: 0,
      lockRoot,
      lockPortBase,
    });
    current = acquired;
    assert.equal(acquired.slot, 0);

    const meta = JSON.parse(await readFile(path.join(acquired.lockDir, "lock.json"), "utf8"));
    assert.equal(meta.pid, process.pid);
    assert.equal(typeof meta.token, "string");
    assert.equal(meta.token, acquired.token);

    await acquired.release();
    current = null;

    assert.equal(await isPortFree(getSlotLockPort(0, lockPortBase)), true);
    await assert.rejects(readFile(path.join(acquired.lockDir, "lock.json")), { code: "ENOENT" });
  });

  it("reclaims stale metadata under the TCP lease and removes it on release", async () => {
    const first = await acquireSlot({
      fixedSlot: 0,
      maxSlots: 1,
      pollMs: 0,
      lockRoot,
      lockPortBase,
    });
    current = first;

    await first.release();
    current = null;

    // Simulate a stale owner by writing a lock.json with a dead pid while the
    // TCP port is free (first.release() closed the server and removed metadata).
    const lockDir = first.lockDir;
    await rm(lockDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      path.join(lockDir, "lock.json"),
      JSON.stringify({ pid: 99999999, token: "stale-token", startedAt: 0 }),
    );

    const second = await acquireSlot({
      fixedSlot: 0,
      maxSlots: 1,
      pollMs: 0,
      lockRoot,
      lockPortBase,
      staleAgeMs: 0,
    });
    current = second;

    const newMeta = JSON.parse(await readFile(path.join(second.lockDir, "lock.json"), "utf8"));
    assert.notEqual(newMeta.token, "stale-token");
    assert.equal(newMeta.pid, process.pid);

    await second.release();
    current = null;

    assert.equal(await isPortFree(getSlotLockPort(0, lockPortBase)), true);
    await assert.rejects(readFile(path.join(second.lockDir, "lock.json")), { code: "ENOENT" });
  });
});

describe("process liveness", () => {
  it("detects the current process as alive", async () => {
    assert.equal(await isProcessAlive(process.pid), true);
  });

  it("detects a non-existent process as not alive", async () => {
    assert.equal(await isProcessAlive(99999999), false);
  });
});
