import { mkdir as fsMkdir, readFile, rm as fsRm, stat, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const MAX_SLOTS = 10;

export const BASE_PG_PORT = 5555;
export const BASE_BACKEND_PORT = 3100;
export const BASE_MOCK_IDP_PORT = 3101;
export const BASE_FRONTEND_PORT = 5174;

export const DEFAULT_STALE_AGE_MS = 30_000;
export const DEFAULT_POLL_MS = 250;
export const DEFAULT_LOCK_PORT_BASE = 62_000;

const LOCK_DIR_PREFIX = "sui-test-slot-";
const NAMED_LOCK_PREFIX = "sui-test-";
const LOCK_FILE = "lock.json";

export function validateSlot(slot, maxSlots = MAX_SLOTS) {
  const value = typeof slot === "string" ? Number(slot) : slot;
  if (!Number.isInteger(value) || value < 0 || value >= maxSlots) {
    throw new Error(`slot must be an integer in [0, ${maxSlots - 1}], got: ${slot}`);
  }
  return value;
}

export function calculatePorts(slot) {
  const n = validateSlot(slot);
  return {
    pgPort: BASE_PG_PORT + n,
    backendPort: BASE_BACKEND_PORT + n * 10,
    mockIdpPort: BASE_MOCK_IDP_PORT + n * 10,
    frontendPort: BASE_FRONTEND_PORT + n * 10,
  };
}

export function generateRunId(slot) {
  return `sui-run-${slot}-${Date.now()}-${process.pid}`;
}

export function calculateResources(slot, runId, maxSlots = MAX_SLOTS) {
  const n = validateSlot(slot, maxSlots);
  const ports = calculatePorts(n);
  const composeProject = `sui-test-${n}`;
  const databaseUrl = `postgresql://sui_test:sui_test@localhost:${ports.pgPort}/sui_test`;
  const backendUrl = `http://localhost:${ports.backendPort}`;
  const mockIdpUrl = `http://localhost:${ports.mockIdpPort}`;
  const frontendUrl = `http://localhost:${ports.frontendPort}`;
  const redirectUri = `${backendUrl}/api/auth/callback`;
  const resolvedRunId = runId ?? generateRunId(n);

  return {
    slot: n,
    maxSlots,
    composeProject,
    ...ports,
    databaseUrl,
    backendUrl,
    mockIdpUrl,
    frontendUrl,
    redirectUri,
    runId: resolvedRunId,
    testResultsDir: path.resolve(process.cwd(), "test-results", resolvedRunId),
    reportDir: path.resolve(process.cwd(), "playwright-report", resolvedRunId),
  };
}

export function getDefaultLockRoot() {
  return path.join(process.env.TMPDIR ?? os.tmpdir(), "sui-test-locks");
}

export function getLockRoot() {
  return process.env.SUI_TEST_LOCK_DIR ?? getDefaultLockRoot();
}

export function getSlotLockPort(slot, lockPortBase = getDefaultLockPortBase()) {
  return lockPortBase + validateSlot(slot);
}

export function getNamedLockPort(name, lockPortBase = getDefaultLockPortBase()) {
  if (name === "generate") return lockPortBase - 1;
  // Stable mapping for other names; keep them outside the slot range.
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return lockPortBase + 10 + (hash % 1000);
}

export function getDefaultLockPortBase() {
  return Number(process.env.SUI_TEST_LOCK_PORT_BASE ?? DEFAULT_LOCK_PORT_BASE);
}

export function validateLockPortBase(base, maxSlots = MAX_SLOTS) {
  const value = Number(base);
  if (!Number.isInteger(value)) {
    throw new Error(`SUI_TEST_LOCK_PORT_BASE must be an integer, got: ${base}`);
  }
  if (value < 1025) {
    throw new Error(`SUI_TEST_LOCK_PORT_BASE must be at least 1025, got: ${base}`);
  }

  const maxNamedPort = value + 10 + 999;
  const maxSlotPort = value + (maxSlots - 1);
  if (maxNamedPort > 65535 || maxSlotPort > 65535) {
    throw new Error(`SUI_TEST_LOCK_PORT_BASE ${base} would derive ports above 65535`);
  }

  return value;
}

export function getLockDir(slot, lockRoot = getLockRoot()) {
  return path.join(lockRoot, `${LOCK_DIR_PREFIX}${slot}.lock`);
}

export function getNamedLockDir(name, lockRoot = getLockRoot()) {
  return path.join(lockRoot, `${NAMED_LOCK_PREFIX}${name}.lock`);
}

export function createToken() {
  return crypto.randomUUID();
}

export async function isProcessAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function createAbortError() {
  const error = new Error("slot acquisition aborted");
  error.code = "ABORTED";
  return error;
}

export async function delay(ms, signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      settled = true;
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      settled = true;
      clearTimeout(timer);
      reject(createAbortError());
    };

    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // Defensive: if abort happened synchronously, the listener won't fire.
    if (signal?.aborted && !settled) {
      onAbort();
    }
  });
}

function getLockMetaPath(lockDir) {
  return path.join(lockDir, LOCK_FILE);
}

export async function readLockMeta(lockDir) {
  try {
    const content = await readFile(getLockMetaPath(lockDir), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function writeLockMeta(lockDir, meta) {
  await writeFile(getLockMetaPath(lockDir), JSON.stringify(meta));
}

export async function isStaleLockDir(lockDir, staleAgeMs, isProcessAliveFn = isProcessAlive) {
  const stats = await stat(lockDir).catch(() => null);
  if (!stats) {
    return true;
  }

  const age = Date.now() - stats.mtime.getTime();
  if (age < staleAgeMs) {
    return false;
  }

  const meta = await readLockMeta(lockDir);
  if (!meta) {
    return true;
  }

  return !(await isProcessAliveFn(meta.pid));
}

// ---------------------------------------------------------------------------
// TCP-port lock protocol
//
// Ownership is decided by the OS bind(2) call performed by net.Server.listen.
// Listen success means the slot/named lock is exclusively ours; EADDRINUSE
// means another process holds it.  When a holder exits its server is closed
// and the port is released, so a stale owner is automatically recovered.
// lock.json in $TMPDIR is only observable metadata; the port is the lock.
// ---------------------------------------------------------------------------

const defaultListen = (server, { port, host }) => new Promise((resolve, reject) => {
  let errorHandler;
  let listeningHandler;

  function cleanup() {
    server.off("error", errorHandler);
    server.off("listening", listeningHandler);
  }

  errorHandler = (err) => {
    cleanup();
    reject(err);
  };

  listeningHandler = () => {
    cleanup();
    resolve();
  };

  server.once("error", errorHandler);
  server.once("listening", listeningHandler);
  server.listen({ port, host });
});

const defaultClose = (server) => new Promise((resolve, reject) => {
  if (!server) {
    resolve();
    return;
  }

  try {
    // Node's server.close(callback) may pass an error to the callback when the
    // server was not running.  Surface any such error instead of resolving.
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  } catch (error) {
    reject(error);
  }
});

function destroySocket(socket) {
  if (socket && typeof socket.destroy === "function") {
    socket.destroy();
  }
}

const defaultCreateServer = () => net.createServer(destroySocket);

const defaultDeps = {
  ensureLockRoot: (lockRoot) => fsMkdir(lockRoot, { recursive: true }),
  createServer: defaultCreateServer,
  listen: defaultListen,
  close: defaultClose,
  mkdir: fsMkdir,
  rm: fsRm,
  writeFile,
  readFile,
  createToken,
};

async function writeOwnedMeta(lockDir, token, deps) {
  const merged = { ...defaultDeps, ...deps };
  const meta = { pid: process.pid, token, startedAt: Date.now() };
  await merged.mkdir(lockDir, { recursive: true });
  await merged.writeFile(getLockMetaPath(lockDir), JSON.stringify(meta));
  return meta;
}

function collectCleanupErrors(rmError, closeError) {
  const errors = [];
  if (rmError) errors.push(rmError);
  if (closeError) errors.push(closeError);
  return errors;
}

async function claimPort({ lockDir, lockPort, token, deps }) {
  const merged = { ...defaultDeps, ...deps };
  await merged.ensureLockRoot(path.dirname(lockDir));

  const server = merged.createServer();
  try {
    await merged.listen(server, { port: lockPort, host: "127.0.0.1" });
  } catch (error) {
    // A real EADDRINUSE means another live owner holds the port.  We have not
    // touched the metadata directory yet.  If the server did manage to start,
    // close it; otherwise the server is not bound and can be discarded.
    let listenCloseError = null;
    if (server.listening) {
      try {
        await merged.close(server);
      } catch (e) {
        listenCloseError = e;
      }
    }
    if (listenCloseError) {
      throw new AggregateError([error, listenCloseError], error.message, { cause: error });
    }
    if (error.code === "EADDRINUSE") {
      return null;
    }
    throw error;
  }

  // We hold the TCP lease.  While the port is still exclusively ours, remove any
  // stale or partial metadata, recreate the directory, and write our own token.
  try {
    await merged.rm(lockDir, { recursive: true, force: true });
    await writeOwnedMeta(lockDir, token, deps);
  } catch (error) {
    // Cleanup partial metadata while we still hold the port, then release the
    // port.  The original write error remains the primary cause unless the
    // cleanup itself fails, in which case we surface all failures.
    let rmError = null;
    let closeError = null;
    try {
      await merged.rm(lockDir, { recursive: true, force: true });
    } catch (e) {
      rmError = e;
    } finally {
      try {
        await merged.close(server);
      } catch (e) {
        closeError = e;
      }
    }

    const cleanupErrors = collectCleanupErrors(rmError, closeError);
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], error.message, { cause: error });
    }
    throw error;
  }

  let released = false;
  return {
    server,
    token,
    lockDir,
    lockPort,
    release: async () => {
      if (released) return;
      released = true;

      // Remove our metadata while the TCP lease is still held, then close the
      // server in finally.  No other process can claim the port until the
      // server closes, so we cannot delete a replacement owner's path.
      // Do not suppress failures: surface them as a release error.
      let releaseRmError = null;
      let releaseCloseError = null;
      try {
        await merged.rm(lockDir, { recursive: true, force: true });
      } catch (error) {
        releaseRmError = error;
      } finally {
        try {
          await merged.close(server);
        } catch (error) {
          releaseCloseError = error;
        }
      }

      const releaseErrors = collectCleanupErrors(releaseRmError, releaseCloseError);
      if (releaseErrors.length > 0) {
        throw new AggregateError(releaseErrors, "release failed");
      }
    },
  };
}

export async function acquireSlot({
  fixedSlot,
  maxSlots = MAX_SLOTS,
  lockRoot = getLockRoot(),
  lockPortBase = getDefaultLockPortBase(),
  pollMs = DEFAULT_POLL_MS,
  signal,
  deps,
} = {}) {
  validateSlot(fixedSlot ?? 0, maxSlots);
  const base = validateLockPortBase(lockPortBase, maxSlots);

  const requested = fixedSlot !== undefined ? validateSlot(fixedSlot, maxSlots) : null;
  const slots = requested !== null ? [requested] : Array.from({ length: maxSlots }, (_, i) => i);

  const merged = { ...defaultDeps, ...deps };
  await merged.ensureLockRoot(lockRoot);

  while (!signal?.aborted) {
    for (const slot of slots) {
      const lockDir = (deps?.getLockDir ? deps.getLockDir(slot, lockRoot) : getLockDir(slot, lockRoot));
      const lockPort = (deps?.getSlotLockPort ? deps.getSlotLockPort(slot, base) : getSlotLockPort(slot, base));
      const token = (merged.createToken ?? createToken)();
      const acquired = await claimPort({ lockDir, lockPort, token, deps: merged });
      if (acquired) {
        return {
          slot,
          lockDir: acquired.lockDir,
          lockPort: acquired.lockPort,
          token: acquired.token,
          release: acquired.release,
        };
      }
    }
    await (merged.delay ?? delay)(pollMs, signal);
  }

  throw createAbortError();
}

export async function acquireNamedLock({
  name,
  lockRoot = getLockRoot(),
  lockPortBase = getDefaultLockPortBase(),
  maxSlots = MAX_SLOTS,
  pollMs = DEFAULT_POLL_MS,
  signal,
  deps,
} = {}) {
  const base = validateLockPortBase(lockPortBase, maxSlots);
  const merged = { ...defaultDeps, ...deps };
  await merged.ensureLockRoot(lockRoot);

  while (!signal?.aborted) {
    const lockDir = (deps?.getNamedLockDir ? deps.getNamedLockDir(name, lockRoot) : getNamedLockDir(name, lockRoot));
    const lockPort = (deps?.getNamedLockPort ? deps.getNamedLockPort(name, base) : getNamedLockPort(name, base));
    const token = (merged.createToken ?? createToken)();
    const acquired = await claimPort({ lockDir, lockPort, token, deps: merged });
    if (acquired) {
      return {
        name,
        lockDir: acquired.lockDir,
        lockPort: acquired.lockPort,
        token: acquired.token,
        release: acquired.release,
      };
    }
    await (merged.delay ?? delay)(pollMs, signal);
  }

  throw createAbortError();
}
