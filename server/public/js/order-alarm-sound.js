(function () {
  let ctx = null;

  function getCtx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!ctx) ctx = new Ctx();
    return ctx;
  }

  function unlockOrderAudio() {
    const c = getCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }

  ["click", "keydown", "touchstart"].forEach(ev => {
    document.addEventListener(ev, unlockOrderAudio, { passive: true });
  });

  window.playOrderAlarmSound = async function playOrderAlarmSound() {
    try {
      const c = getCtx();
      if (!c) return;
      if (c.state === "suspended") await c.resume();
      const playBeep = (freq, start, dur) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.stop(start + dur);
      };
      playBeep(880, c.currentTime, 0.18);
      playBeep(1100, c.currentTime + 0.22, 0.22);
      playBeep(880, c.currentTime + 0.55, 0.18);
    } catch {
      /* pa zë */
    }
  };
})();
