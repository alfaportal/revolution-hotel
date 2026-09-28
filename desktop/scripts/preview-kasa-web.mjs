/** Shfaq kasa-recepcion.html nga kodi (dev) — API proxy te HOTEL i hapur. */
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const portFile = path.join(
  process.env.APPDATA || "",
  "Revolution HOTEL",
  "server-port.txt",
);
const apiPort = fs.existsSync(portFile)
  ? String(fs.readFileSync(portFile, "utf8")).trim() || "3001"
  : "3001";
const WEB_PORT = Number(process.env.KASA_PREVIEW_PORT) || 3020;

const app = express();
app.use(express.static(publicDir, { index: false }));

app.use("/api", (req, res) => {
  const opts = {
    hostname: "127.0.0.1",
    port: apiPort,
    path: req.originalUrl,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
  };
  const proxy = http.request(opts, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  proxy.on("error", () => res.status(502).send("HOTEL nuk punon — hape Revolution HOTEL."));
  req.pipe(proxy);
});

app.get("/", (_req, res) => res.redirect("/kasa-recepcion.html"));

app.listen(WEB_PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${WEB_PORT}/kasa-recepcion.html`;
  console.log(url, "(API ->", apiPort + ")");
  import("child_process").then(({ execFile }) => {
    execFile("cmd", ["/c", "start", "", url], () => {});
  });
});
