// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
let runtime: ChildProcess;
let backend: Server;
let publicPort: number;

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function close(server: Server) {
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "multica-runtime-"));
  await mkdir(join(directory, "apps/web"), { recursive: true });
  await copyFile(new URL("./runtime-server.mjs", import.meta.url), join(directory, "runtime.mjs"));
  await writeFile(join(directory, "apps/web/server.js"), `
    const http = require("node:http");
    const server = http.createServer((req, res) => res.end("next:" + req.url));
    server.on("upgrade", (req, socket) => socket.end("HTTP/1.1 101 Switching Protocols\\r\\nX-Upstream: next\\r\\n\\r\\n"));
    server.listen(Number(process.env.PORT), process.env.HOSTNAME, () => console.log("next fixture ready"));
  `);
  backend = createServer((req, res) => res.end(`backend:${req.url}`));
  backend.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 101 Switching Protocols\r\nX-Upstream: backend\r\n\r\n"));
  const backendPort = await listen(backend);
  const reservation = createServer();
  publicPort = await listen(reservation);
  await close(reservation);
  const nextPort = await listen(reservation);
  await close(reservation);
  runtime = spawn(process.execPath, [join(directory, "runtime.mjs")], {
    cwd: directory,
    env: { NODE_ENV: "test", HOSTNAME: "127.0.0.1", PORT: String(publicPort), NEXT_INTERNAL_PORT: String(nextPort), REMOTE_API_URL: `http://127.0.0.1:${backendPort}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Runtime fixture did not start")), 5000);
    let output = "";
    runtime.once("error", (error) => { clearTimeout(timer); reject(error); });
    runtime.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Runtime fixture exited: ${code}`)); });
    runtime.stdout!.on("data", (chunk) => {
      output += chunk;
      if (output.includes("next fixture ready") && output.includes("Web runtime proxy listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});

afterAll(async () => {
  if (runtime && runtime.exitCode === null && runtime.signalCode === null) {
    const exited = once(runtime, "exit");
    runtime.kill("SIGTERM");
    await exited;
  }
  await close(backend);
  if (directory) await rm(directory, { recursive: true, force: true });
});

it.each([
  ["/collab?ticket=test", "backend"],
  ["/api/ping", "backend"],
  ["/collaborator", "next"],
])("routes HTTP %s to %s", async (path, upstream) => {
  const response = await fetch(`http://127.0.0.1:${publicPort}${path}`);
  expect(await response.text()).toBe(`${upstream}:${path}`);
});

it.each([
  ["/collab?ticket=test", "backend"],
  ["/ws", "backend"],
  ["/_next/webpack-hmr", "next"],
  ["/collab/other", "next"],
])("routes WebSocket %s to %s", async (path, upstream) => {
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connect({ port: publicPort, host: "127.0.0.1" }, () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    });
    socket.setTimeout(3000, () => socket.destroy(new Error("Upgrade timed out")));
    socket.on("error", reject);
    let headers = "";
    socket.on("data", (chunk) => {
      headers += chunk;
      if (headers.includes("\r\n\r\n")) { socket.destroy(); resolve(headers); }
    });
  });
  expect(response).toContain("HTTP/1.1 101");
  expect(response).toContain(`X-Upstream: ${upstream}`);
});

it("returns 502 when the collaboration backend is unavailable", async () => {
  await close(backend);
  expect((await fetch(`http://127.0.0.1:${publicPort}/collab`)).status).toBe(502);
});
