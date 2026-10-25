/**
 * Run the API and the dashboard together with one command.
 *
 * Written by hand rather than with concurrently/npm-run-all so the repository
 * root needs no node_modules at all, and so the two behaviours that actually
 * matter are explicit:
 *
 *   · output is prefixed per process, because interleaved unlabelled logs from
 *     two dev servers are unreadable;
 *   · if either process exits, the other is killed. Otherwise a crashed API
 *     leaves a dashboard running against nothing, which looks like a bug in the
 *     dashboard.
 *
 * It also fails fast with a useful message if the database has not been built,
 * which is the one setup step a new clone always forgets.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB = resolve(ROOT, "server", "data", "sgjb.db");

if (!existsSync(DB)) {
  console.error(
    `\n  No database at server/data/sgjb.db.\n` +
      `  Build it from the committed pipeline outputs first:\n\n` +
      `      npm run ingest\n`,
  );
  process.exit(1);
}

const TARGETS = [
  { name: "api", colour: "\u001b[36m", cwd: "server", args: ["run", "dev"] },
  { name: "web", colour: "\u001b[35m", cwd: "dashboard", args: ["run", "dev"] },
];
const RESET = "\u001b[0m";

const children = [];
let shuttingDown = false;

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
  // Give them a moment to close their sockets before the parent goes.
  setTimeout(() => process.exit(code), 300);
}

for (const t of TARGETS) {
  const child = spawn("npm", t.args, {
    cwd: resolve(ROOT, t.cwd),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  children.push(child);

  const prefix = `${t.colour}[${t.name}]${RESET} `;
  const relay = (stream) => {
    let tail = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const lines = (tail + chunk).split("\n");
      tail = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) console.log(prefix + line);
    });
  };
  relay(child.stdout);
  relay(child.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log(`${prefix}exited (${signal ?? code}) — stopping the other process`);
    stopAll(code ?? 0);
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stopAll(0));

console.log(
  `\n  API        http://127.0.0.1:8787/api/health\n` +
    `  Dashboard  http://localhost:5174\n\n` +
    `  Ctrl-C stops both.\n`,
);
