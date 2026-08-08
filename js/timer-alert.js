let audioContext = null;
let activeOscillators = [];

function audioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext;
}

export async function prepareTimerAlert() {
  const AudioContext = audioContextConstructor();
  if (!AudioContext) return false;

  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch {
      return false;
    }
  }
  return audioContext.state === "running";
}

export function stopTimerAlert() {
  activeOscillators.forEach(oscillator => {
    try {
      oscillator.stop();
    } catch {}
  });
  activeOscillators = [];
}

export async function triggerTimerAlert() {
  if (navigator.vibrate) {
    navigator.vibrate([400, 150, 400, 150, 700]);
  }

  if (!audioContext || audioContext.state !== "running") {
    const ready = await prepareTimerAlert();
    if (!ready) return false;
  }

  stopTimerAlert();
  const startAt = audioContext.currentTime;
  const notes = [
    { delay: 0, frequency: 880 },
    { delay: 0.35, frequency: 660 },
    { delay: 0.7, frequency: 880 }
  ];

  activeOscillators = notes.map(({ delay, frequency }) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noteStart = startAt + delay;
    const noteEnd = noteStart + 0.24;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.5, noteStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.02);
    oscillator.addEventListener("ended", () => {
      activeOscillators = activeOscillators.filter(item => item !== oscillator);
    }, { once: true });
    return oscillator;
  });

  return true;
}
