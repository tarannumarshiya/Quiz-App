class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = localStorage.getItem('quiz_audio_muted') === 'true';
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('quiz_audio_muted', this.isMuted);
    return this.isMuted;
  }

  getMuteState() {
    return this.isMuted;
  }

  // Common wrapper to ensure sound runs only if not muted and initialized
  playSound(generator) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      generator(this.ctx);
    } catch (e) {
      console.warn("Failed to play synthesized sound:", e);
    }
  }

  playClick() {
    this.playSound((ctx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.06);
    });
  }

  playCorrect() {
    this.playSound((ctx) => {
      const now = ctx.currentTime;
      
      // High-pitched dual-note chime (arpeggio)
      const playNote = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.15, startTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.start(startTime);
        osc.stop(startTime + duration + 0.01);
      };

      playNote(523.25, now, 0.15); // C5
      playNote(659.25, now + 0.08, 0.25); // E5
      playNote(783.99, now + 0.16, 0.4); // G5
    });
  }

  playWrong() {
    this.playSound((ctx) => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      // Low, vibrating buzzer sound using sawtooth
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.25);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.start(now);
      osc.stop(now + 0.3);
    });
  }

  playTick() {
    this.playSound((ctx) => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      // Short, high-frequency "tock"
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.start(now);
      osc.stop(now + 0.05);
    });
  }

  playCountdownEnd() {
    this.playSound((ctx) => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      // Alarm horn
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc.start(now);
      osc.stop(now + 0.5);
    });
  }

  playVictory() {
    this.playSound((ctx) => {
      const now = ctx.currentTime;
      
      const playTonicChord = (freq, delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + delay);

        gain.gain.setValueAtTime(0, now + delay);
        gain.gain.linearRampToValueAtTime(0.1, now + delay + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.6);

        osc.start(now + delay);
        osc.stop(now + delay + 0.7);
      };

      // C Major arpeggio ending on a chord
      playTonicChord(261.63, 0);     // C4
      playTonicChord(329.63, 0.1);   // E4
      playTonicChord(392.00, 0.2);   // G4
      playTonicChord(523.25, 0.3);   // C5
      
      // Supporting chord at the end
      playTonicChord(329.63, 0.3);
      playTonicChord(392.00, 0.3);
    });
  }
}

export const audio = new AudioEngine();
