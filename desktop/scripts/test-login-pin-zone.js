"use strict";

/** Provë API: login_mode + PIN 4/6 dhe mesazh wrong_zone (pa UI). */
const http = require("http");

const BASE = process.env.HOTEL_TEST_BASE || "http://127.0.0.1:3001";

function post(path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let json = {};
          try { json = JSON.parse(raw || "{}"); } catch { /* ignore */ }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const recepPin = process.env.TEST_RECEP_PIN;
  const waitPin = process.env.TEST_WAIT_PIN;
  if (!recepPin || !waitPin) {
    console.log("SKIP: vendos TEST_RECEP_PIN dhe TEST_WAIT_PIN (nga admin staf) për provë live.");
    process.exit(0);
  }
  const r1 = await post("/api/login/pin", { pin: recepPin, login_mode: "recepsion" });
  console.log("recepsion OK?", r1.status === 200 && r1.json.token ? "PO" : "JO", r1.json.gabim || "");
  const r2 = await post("/api/login/pin", { pin: recepPin, login_mode: "kamarier" });
  console.log("recep pin në restorant wrong_zone?", r2.json.wrong_zone === true ? "PO" : "JO", r2.json.gabim || "");
  const w1 = await post("/api/login/pin", { pin: waitPin, login_mode: "kamarier" });
  console.log("restorant OK?", w1.status === 200 && w1.json.token ? "PO" : "JO", w1.json.gabim || "");
  process.exit(r1.status === 200 && r2.json.wrong_zone && w1.status === 200 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
