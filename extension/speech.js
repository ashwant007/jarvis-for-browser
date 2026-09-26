// Thin Web Speech API wrapper. Only surfaces FINAL transcripts so we do not
// act on half-formed guesses. No API key needed; native to Chrome.

(function () {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  window.JarvisMic = {
    supported: !!Recognition,
    start(onFinal, onError) {
      if (!Recognition) {
        onError && onError(new Error("SpeechRecognition not supported in this browser"));
        return () => {};
      }
      const r = new Recognition();
      r.lang = "en-US";
      r.continuous = false;
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.onresult = (ev) => {
        const t = ev.results[0][0].transcript.trim();
        if (t) onFinal && onFinal(t);
      };
      r.onerror = (ev) => onError && onError(new Error(ev.error || "mic error"));
      r.start();
      return () => { try { r.stop(); } catch {} };
    },
  };
})();
