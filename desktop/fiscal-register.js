const os = require("os");
const { execSync } = require("child_process");

const COM_PORTS = ["COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9"];
const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

function getConfig(db) {
  return {
    register_name: db.getSetting("fiscal_register_name", "") || "",
    com_port: db.getSetting("fiscal_com_port", "") || "",
    baud_rate: Number(db.getSetting("fiscal_baud_rate", "9600")) || 9600,
  };
}

function saveConfig(db, { register_name, com_port, baud_rate }) {
  if (register_name !== undefined) {
    db.setSetting("fiscal_register_name", String(register_name).trim());
  }
  if (com_port !== undefined) {
    db.setSetting("fiscal_com_port", String(com_port).trim().toUpperCase());
  }
  if (baud_rate !== undefined) {
    db.setSetting("fiscal_baud_rate", String(Number(baud_rate) || 9600));
  }
}

function listAvailableComPorts() {
  if (os.platform() !== "win32") return [];
  try {
    const out = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json -Compress"',
      { encoding: "utf8", timeout: 10000 },
    );
    const trimmed = out.trim();
    if (!trimmed) return [];
    const data = JSON.parse(trimmed);
    const arr = Array.isArray(data) ? data : [data];
    return arr.map(p => String(p).toUpperCase()).filter(Boolean).sort();
  } catch {
    return [];
  }
}

function testComConnection(comPort, baudRate) {
  if (os.platform() !== "win32") {
    return { ok: false, error: "Lidhja COM funksionon vetëm në Windows." };
  }
  const port = String(comPort || "").toUpperCase();
  const baud = Number(baudRate) || 9600;
  if (!port) return { ok: false, error: "Zgjidhni portin COM." };

  const available = listAvailableComPorts();
  if (!available.includes(port)) {
    return { ok: false, error: `Porti ${port} nuk u gjet në sistem.` };
  }

  const script = [
    `$p = New-Object System.IO.Ports.SerialPort '${port}',${baud}`,
    "$p.ReadTimeout = 800",
    "$p.WriteTimeout = 800",
    "try {",
    "  $p.Open()",
    "  $p.Close()",
    "  Write-Output 'OK'",
    "} catch {",
    "  Write-Output ('ERR:' + $_.Exception.Message)",
    "} finally {",
    "  if ($p.IsOpen) { $p.Close() }",
    "}",
  ].join("; ");

  try {
    const out = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`,
      { encoding: "utf8", timeout: 15000 },
    ).trim();
    if (out === "OK") return { ok: true };
    if (out.startsWith("ERR:")) return { ok: false, error: out.slice(4) };
    return { ok: false, error: out || "Nuk u hap porti COM." };
  } catch (e) {
    return { ok: false, error: e.message || "Testi i portit COM dështoi." };
  }
}

async function getStatus(db) {
  const config = getConfig(db);
  const available_ports = listAvailableComPorts();

  if (!config.register_name && !config.com_port) {
    return {
      ...config,
      connected: false,
      available_ports,
      com_ports: COM_PORTS,
      baud_rates: BAUD_RATES,
      message: (() => {
        try {
          return require("./i18n").t("Regjistroni emrin/numrin e arkës dhe portin COM.");
        } catch {
          return "Regjistroni emrin/numrin e arkës dhe portin COM.";
        }
      })(),
    };
  }

  if (!config.com_port) {
    return {
      ...config,
      connected: false,
      available_ports,
      com_ports: COM_PORTS,
      baud_rates: BAUD_RATES,
      message: "Zgjidhni portin COM (p.sh. COM7) dhe klikoni Ruaj.",
    };
  }

  if (!available_ports.includes(config.com_port)) {
    return {
      ...config,
      connected: false,
      available_ports,
      com_ports: COM_PORTS,
      baud_rates: BAUD_RATES,
      message: `Porti ${config.com_port} nuk është i lidhur. Kontrolloni kabllon USB/serial.`,
    };
  }

  const test = testComConnection(config.com_port, config.baud_rate);
  if (test.ok) {
    const label = config.register_name ? `${config.register_name} · ` : "";
    return {
      ...config,
      connected: true,
      available_ports,
      com_ports: COM_PORTS,
      baud_rates: BAUD_RATES,
      message: `${label}${config.com_port} @ ${config.baud_rate} baud — arka është e lidhur.`,
    };
  }

  return {
    ...config,
    connected: false,
    available_ports,
    com_ports: COM_PORTS,
    baud_rates: BAUD_RATES,
    message: test.error || `Porti ${config.com_port} nuk u hap.`,
  };
}

module.exports = {
  COM_PORTS,
  BAUD_RATES,
  getConfig,
  saveConfig,
  listAvailableComPorts,
  testComConnection,
  getStatus,
};
