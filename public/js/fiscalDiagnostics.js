/**
 * Fiscal register COM diagnostics for the owner panel (browser-side).
 * Uses Web Serial API on the POS Windows PC; optional local POS agent on :9247.
 */
(function (global) {
  const FISCAL_BAUD = 9600;
  const OPEN_TIMEOUT_MS = 4500;
  const LOCAL_AGENT_BASES = [
    "http://127.0.0.1:9247/fiscal",
    "http://localhost:9247/fiscal",
  ];

  function serialSupported() {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  function normalizeCom(port) {
    const raw = String(port || "").trim().toUpperCase();
    const m = raw.match(/^COM(\d+)$/);
    return m ? `COM${m[1]}` : "";
  }

  function comSuggestions(current) {
    const cur = normalizeCom(current);
    const alts = [];
    for (let n = 1; n <= 8 && alts.length < 3; n += 1) {
      const label = `COM${n}`;
      if (label !== cur) alts.push(label);
    }
    return alts;
  }

  function formatSuggestions(comPort, extra) {
    const alts = comSuggestions(comPort);
    const out = [];
    if (alts.length) out.push(`Provo ${alts.join(", ")}`);
    out.push("Kontrollo kabllot");
    if (extra) out.push(extra);
    return out;
  }

  async function fetchLocalAgent(path, options) {
    for (const base of LOCAL_AGENT_BASES) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2800);
        const res = await fetch(`${base}${path}`, { ...options, signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        const data = await res.json().catch(() => ({}));
        if (data && data.ok !== false) return data;
      } catch {
        /* next base */
      }
    }
    return null;
  }

  async function openAndProbe(port) {
    const openPromise = port.open({
      baudRate: FISCAL_BAUD,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Koha e lidhjes skadoi — porti nuk përgjigjet.")), OPEN_TIMEOUT_MS);
    });
    await Promise.race([openPromise, timeout]);
    try {
      await new Promise(r => setTimeout(r, 250));
      return { ok: true };
    } finally {
      try {
        await port.close();
      } catch {
        /* ignore */
      }
    }
  }

  async function testAuthorizedPorts() {
    const ports = await navigator.serial.getPorts();
    const errors = [];
    for (const port of ports) {
      try {
        await openAndProbe(port);
        return { ok: true, port };
      } catch (e) {
        errors.push(String(e?.message || e));
      }
    }
    return { ok: false, errors };
  }

  async function testConnection(comPort) {
    const com = normalizeCom(comPort);
    if (!com) {
      return {
        ok: false,
        error: "Vendosni portin COM (p.sh. COM3) para testit.",
        suggestions: formatSuggestions(""),
      };
    }

    const agent = await fetchLocalAgent(`/test?com=${encodeURIComponent(com)}`);
    if (agent?.connected || agent?.ok) {
      return {
        ok: true,
        method: "agent",
        com_port: agent.com_port || com,
        message: agent.message || `Arka fiskale u arrit në ${agent.com_port || com}.`,
      };
    }
    if (agent && agent.connected === false) {
      return {
        ok: false,
        error: agent.error || `Nuk u arrit lidhja në ${com}.`,
        suggestions: agent.suggestions || formatSuggestions(com),
      };
    }

    if (!serialSupported()) {
      return {
        ok: false,
        error: "Testi i drejtpërdrejtë kërkon Chrome ose Edge në kompjuterin POS ku është lidhur USB-ja e arkës.",
        suggestions: formatSuggestions(com, "Hapni këtë faqe nga PC i restorantit, jo nga telefoni"),
      };
    }

    const authorized = await testAuthorizedPorts();
    if (authorized.ok) {
      return {
        ok: true,
        method: "serial",
        message: `Lidhja me arkën fiskale u verifikua. Porti i konfiguruar: ${com}.`,
      };
    }

    try {
      const port = await navigator.serial.requestPort();
      await openAndProbe(port);
      return {
        ok: true,
        method: "serial",
        message: `Pajisja u lidh me sukses. Nëse nuk përputhet me ${com}, përditësoni Portin COM dhe ruajeni settings.`,
      };
    } catch (e) {
      const name = String(e?.name || "");
      const msg = String(e?.message || e);
      if (name === "NotFoundError" || /cancel/i.test(msg)) {
        return {
          ok: false,
          error: `Nuk u arrit lidhja në ${com}. Pajisja nuk u zgjodh ose nuk përgjigjet.`,
          suggestions: formatSuggestions(com, "Sigurohuni që POS nuk e përdor portin në të njëjtën kohë"),
        };
      }
      if (/failed to open|access|busy|in use/i.test(msg)) {
        return {
          ok: false,
          error: `Porti ${com} nuk u hap: ${msg}`,
          suggestions: formatSuggestions(com, "Mbyllni programet e tjera që përdorin portin serial"),
        };
      }
      return {
        ok: false,
        error: `Gabim lidhjeje: ${msg}`,
        suggestions: formatSuggestions(com),
      };
    }
  }

  async function autoFindPort() {
    const agent = await fetchLocalAgent("/scan", { method: "POST", body: "{}" });
    if (agent?.com_port) {
      return {
        ok: true,
        method: "agent",
        com_port: normalizeCom(agent.com_port) || agent.com_port,
        message: agent.message || `U gjet arka fiskale në ${agent.com_port}.`,
      };
    }

    if (!serialSupported()) {
      return {
        ok: false,
        error: "Skanimi automatik kërkon Chrome ose Edge në kompjuterin ku është lidhur arka fiskale.",
        suggestions: ["Hapni panelin nga PC i POS-it", "Kontrollo kabllot USB"],
      };
    }

    const authorized = await testAuthorizedPorts();
    if (authorized.ok) {
      return {
        ok: true,
        method: "serial",
        message: "U gjet një pajisje e arritshme. Kontrolloni Device Manager për numrin COM (p.sh. COM3) dhe vendoseni më poshtë.",
      };
    }

    try {
      const port = await navigator.serial.requestPort();
      await openAndProbe(port);
      return {
        ok: true,
        method: "serial",
        message: "Pajisja u gjet dhe u testua. Shikoni Device Manager → Portet (COM & LPT) për numrin e saktë.",
      };
    } catch (e) {
      const msg = String(e?.message || e);
      if (/cancel/i.test(msg) || e?.name === "NotFoundError") {
        return {
          ok: false,
          error: "Nuk u gjet asnjë arkë fiskale.",
          suggestions: formatSuggestions(""),
        };
      }
      return {
        ok: false,
        error: `Skanimi dështoi: ${msg}`,
        suggestions: formatSuggestions(""),
      };
    }
  }

  global.FiscalDiagnostics = {
    serialSupported,
    normalizeCom,
    comSuggestions,
    testConnection,
    autoFindPort,
  };
})(window);
