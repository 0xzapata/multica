import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { spawn } from "node:child_process";

const publicPort = Number(process.env.PORT || 3000);
const publicHost = process.env.HOSTNAME || "0.0.0.0";
const nextPort = Number(process.env.NEXT_INTERNAL_PORT || 3001);
const nextHost = "127.0.0.1";

if (publicPort === nextPort) {
  console.error("PORT and NEXT_INTERNAL_PORT must be different.");
  process.exit(1);
}

const backendUrl = parseRemoteApiUrl(process.env.REMOTE_API_URL || "http://backend:8080");
const nextUrl = new URL(`http://${nextHost}:${nextPort}`);

const nextServer = spawn(process.execPath, ["apps/web/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(nextPort),
    HOSTNAME: nextHost,
  },
});

nextServer.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

const server = http.createServer((req, res) => {
  const targetBaseUrl = isBackendPath(req.url) ? backendUrl : nextUrl;
  proxyHttp(req, res, targetBaseUrl);
});

server.on("upgrade", (req, socket, head) => {
  if (isWebSocketPath(req.url)) {
    proxyWebSocket(req, socket, head, backendUrl);
    return;
  }
  proxyWebSocket(req, socket, head, nextUrl);
});

server.listen(publicPort, publicHost, () => {
  console.log(`Web runtime proxy listening on ${publicHost}:${publicPort}`);
  console.log(`Proxying backend routes to ${backendUrl.origin}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    nextServer.kill(signal);
  });
}

function parseRemoteApiUrl(value) {
  if (!value) {
    console.error("REMOTE_API_URL is required at runtime.");
    process.exit(1);
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("REMOTE_API_URL must use http or https.");
    }
    return url;
  } catch (error) {
    console.error(`Invalid REMOTE_API_URL: ${error.message}`);
    process.exit(1);
  }
}

function isBackendPath(rawUrl = "/") {
  const pathname = new URL(rawUrl, "http://localhost").pathname;
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/uploads" ||
    pathname.startsWith("/uploads/") ||
    pathname === "/ws"
  );
}

function isWebSocketPath(rawUrl = "/") {
  return new URL(rawUrl, "http://localhost").pathname === "/ws";
}

function proxyHttp(req, res, targetBaseUrl) {
  const targetUrl = new URL(req.url || "/", targetBaseUrl);
  const client = targetUrl.protocol === "https:" ? https : http;
  const headers = filterHopByHopHeaders(req.headers);
  headers.host = targetUrl.host;

  const proxyReq = client.request(
    targetUrl,
    {
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, filterHopByHopHeaders(proxyRes.headers));
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`Proxy error: ${error.message}`);
  });

  req.pipe(proxyReq);
}

function proxyWebSocket(req, socket, head, targetBaseUrl) {
  const targetUrl = new URL(req.url || "/", targetBaseUrl);
  const port = Number(targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80));
  const host = targetUrl.hostname;
  const connect = targetUrl.protocol === "https:" ? tls.connect : net.connect;

  const upstream = connect({ host, port, servername: host }, () => {
    upstream.write(buildUpgradeRequest(req, targetUrl));
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

function buildUpgradeRequest(req, targetUrl) {
  const path = `${targetUrl.pathname}${targetUrl.search}`;
  const lines = [`${req.method} ${path} HTTP/${req.httpVersion}`];
  lines.push(`Host: ${targetUrl.host}`);

  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index];
    const value = req.rawHeaders[index + 1];
    if (name.toLowerCase() === "host") {
      continue;
    }
    lines.push(`${name}: ${value}`);
  }

  return `${lines.join("\r\n")}\r\n\r\n`;
}

function filterHopByHopHeaders(headers) {
  const filtered = { ...headers };
  for (const header of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    delete filtered[header];
  }
  return filtered;
}
