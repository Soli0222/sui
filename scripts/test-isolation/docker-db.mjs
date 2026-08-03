import { spawn } from "node:child_process";
import { calculateResources, validateSlot } from "./resources.mjs";

const command = process.argv[2];
if (command !== "up" && command !== "down" && command !== "ps") {
  console.error("Usage: node scripts/test-isolation/docker-db.mjs <up|down|ps>");
  process.exit(1);
}

const rawSlot = process.env.SUI_TEST_SLOT;
if (rawSlot === undefined || rawSlot === "") {
  console.error("SUI_TEST_SLOT is required");
  process.exit(1);
}

const slot = validateSlot(rawSlot);
const resources = calculateResources(slot, "manual");

const args = [
  "compose",
  "-p", resources.composeProject,
  "-f", "compose_db.yaml",
];

if (command === "up") {
  args.push("up", "-d", "--wait");
} else if (command === "down") {
  args.push("down", "--volumes", "--remove-orphans");
} else {
  args.push("ps");
}

const env = {
  ...process.env,
  SUI_TEST_PG_PORT: String(resources.pgPort),
};

const child = spawn("docker", args, { stdio: "inherit", env });

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 0));
  }
  process.exit(code ?? 0);
});
