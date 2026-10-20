/** Loud beep plus a short vibration. Both no-op when the device refuses them. */
export function playDriverAlert(): void {
  if (typeof window === "undefined") return;

  try {
    const Context =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Context) {
      const audio = new Context();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.18, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audio.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.18);
      oscillator.onended = () => {
        void audio.close();
      };
    }
  } catch {
    // Autoplay policies can reject the beep. The scan still counts.
  }

  try {
    navigator.vibrate?.([90, 40, 90]);
  } catch {
    // Vibration is optional.
  }
}
