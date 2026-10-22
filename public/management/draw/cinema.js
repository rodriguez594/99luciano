// The cinematic reveal for /management/draw (about 13 seconds): the note glides to the middle under a
// spotlight, teases open, the name sharpens out of a blur over a heartbeat, a riser and a drumroll,
// then a hit. All sound is made here with the Web Audio API (no music files, so no rights to clear).
(function () {
  var LEN = 13000;

  // ---------- sound ----------

  function Sound() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    var comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    // A second of white noise to reuse
    var len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var d = this.noise.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.t0 = this.ctx.currentTime + 0.05;
  }

  Sound.prototype.at = function (ms) { return this.t0 + ms / 1000; };

  Sound.prototype.env = function (node, t, a, peak, hold, r) {
    var g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + a);
    g.setValueAtTime(peak, t + a + hold);
    g.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
  };

  // A dark pad: Am – F – C – G, slowly
  Sound.prototype.pad = function (from, to) {
    var ctx = this.ctx, self = this;
    var chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 261.63, 329.63], [196, 246.94, 293.66]];
    var seg = (to - from) / chords.length;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, this.at(from));
    lp.frequency.linearRampToValueAtTime(1800, this.at(to));
    lp.connect(this.master);
    chords.forEach(function (ch, i) {
      var t = self.at(from + i * seg), dur = seg / 1000;
      ch.forEach(function (f) {
        [-8, 8].forEach(function (det) {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sawtooth';
          o.frequency.value = f / 2;
          o.detune.value = det;
          self.env(g, t, 0.9, 0.035, Math.max(0.1, dur - 1.2), 1.2);
          o.connect(g); g.connect(lp);
          o.start(t); o.stop(t + dur + 1.5);
        });
      });
    });
  };

  // Lub-dub, getting faster
  Sound.prototype.heartbeat = function (from, to, bpmA, bpmB) {
    var t = from;
    while (t < to) {
      var p = (t - from) / (to - from), bpm = bpmA + (bpmB - bpmA) * p;
      this.kick(t, 0.9);
      this.kick(t + 170, 0.55);
      t += 60000 / bpm;
    }
  };

  Sound.prototype.kick = function (ms, vol) {
    var ctx = this.ctx, t = this.at(ms);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    this.env(g, t, 0.005, vol, 0.02, 0.35);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.45);
  };

  // Noise swelling up and getting brighter
  Sound.prototype.riser = function (from, to) {
    var ctx = this.ctx, a = this.at(from), b = this.at(to);
    var src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; src.loop = true;
    bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(250, a);
    bp.frequency.exponentialRampToValueAtTime(6000, b);
    g.gain.setValueAtTime(0.0001, a);
    g.gain.exponentialRampToValueAtTime(0.32, b);
    g.gain.exponentialRampToValueAtTime(0.0001, b + 0.08);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(a); src.stop(b + 0.1);
    var o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(110, a);
    o.frequency.exponentialRampToValueAtTime(880, b);
    og.gain.setValueAtTime(0.0001, a);
    og.gain.exponentialRampToValueAtTime(0.07, b);
    og.gain.exponentialRampToValueAtTime(0.0001, b + 0.05);
    o.connect(og); og.connect(this.master);
    o.start(a); o.stop(b + 0.1);
  };

  // A snare roll that speeds up
  Sound.prototype.roll = function (from, to) {
    var t = from;
    while (t < to) {
      var p = (t - from) / (to - from);
      this.snare(t, 0.08 + p * 0.22);
      t += 110 - 85 * p;
    }
  };

  Sound.prototype.snare = function (ms, vol) {
    var ctx = this.ctx, t = this.at(ms);
    var src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    this.env(g, t, 0.002, vol, 0.01, 0.07);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5, 0.12);
  };

  // The big moment: boom, cymbal, a bright chord, then a little fanfare
  Sound.prototype.hit = function (ms) {
    var ctx = this.ctx, t = this.at(ms), self = this;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.9);
    this.env(g, t, 0.005, 1, 0.05, 1.8);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 2);

    var src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), cg = ctx.createGain();
    src.buffer = this.noise; src.loop = true;
    hp.type = 'highpass'; hp.frequency.value = 4500;
    this.env(cg, t, 0.003, 0.45, 0.05, 2.6);
    src.connect(hp); hp.connect(cg); cg.connect(this.master);
    src.start(t); src.stop(t + 3);

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(5000, t + 0.25);
    lp.connect(this.master);
    [130.81, 261.63, 329.63, 392, 523.25].forEach(function (f, i) {
      [-6, 6].forEach(function (det) {
        var x = ctx.createOscillator(), xg = ctx.createGain();
        x.type = i === 0 ? 'square' : 'sawtooth';
        x.frequency.value = f;
        x.detune.value = det;
        self.env(xg, t, 0.02, 0.05, 0.6, 2.4);
        x.connect(xg); xg.connect(lp);
        x.start(t); x.stop(t + 3.2);
      });
    });
    // Fanfare: G C E G C
    [392, 523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
      var nt = t + 0.9 + i * 0.13;
      var x = ctx.createOscillator(), xg = ctx.createGain();
      x.type = 'triangle';
      x.frequency.value = f;
      self.env(xg, nt, 0.01, 0.12, i === 4 ? 0.5 : 0.05, i === 4 ? 1.4 : 0.15);
      x.connect(xg); xg.connect(self.master);
      x.start(nt); x.stop(nt + 2.2);
    });
  };

  Sound.prototype.stop = function () {
    var ctx = this.ctx, m = this.master;
    try {
      m.gain.cancelScheduledValues(ctx.currentTime);
      m.gain.setValueAtTime(m.gain.value, ctx.currentTime);
      m.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    } catch (e) {}
    setTimeout(function () { try { ctx.close(); } catch (e) {} }, 600);
  };

  // ---------- picture ----------

  // play(slip, {sound}) → Promise, resolves when the note is back on the table, open
  function play(slip, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var home = slip.parentNode;
      var from = slip.getBoundingClientRect();
      var top = slip.querySelector('.d-slip__top');
      var timers = [], sound = null, finished = false;

      var theater = document.createElement('div');
      theater.className = 'd-theater';
      theater.innerHTML = '<div class="d-theater__light"></div><p class="d-theater__caption">Og vinderen er…</p>' +
        '<div class="d-theater__holder"></div><div class="d-theater__flash"></div>' +
        '<button type="button" class="m-mini d-theater__skip">Spring over</button>';
      document.body.appendChild(theater);
      var holder = theater.querySelector('.d-theater__holder');
      holder.style.width = from.width + 'px';
      holder.style.height = from.height + 'px';
      holder.appendChild(slip);
      var scale = Math.min(2, (window.innerWidth * 0.86) / from.width, (window.innerHeight * 0.5) / from.height);
      // Start where it lay on the table
      var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      holder.style.transform = 'translate(' + (from.left + from.width / 2 - cx) + 'px,' + (from.top + from.height / 2 - cy) + 'px) scale(1)';
      slip.classList.add('is-cinema');
      slip.style.setProperty('--blur', '24px');

      if (opts.sound) {
        try {
          sound = new Sound();
          sound.pad(0, 11200);
          sound.heartbeat(600, 8600, 62, 128);
          sound.riser(6600, 11000);
          sound.roll(8600, 11000);
          sound.hit(11000);
        } catch (e) { sound = null; }
      }

      function flap(deg, ms, ease) {
        top.style.transition = 'transform ' + ms + 'ms ' + (ease || 'cubic-bezier(.45,0,.2,1)');
        top.style.transform = 'rotateX(' + deg + 'deg)';
      }
      function at(ms, fn) { timers.push(setTimeout(fn, ms)); }

      requestAnimationFrame(function () {
        theater.classList.add('is-on');
        holder.style.transform = 'translate(0,0) scale(' + scale + ')';
      });
      at(1000, function () { theater.classList.add('is-caption'); flap(-162, 1300); });
      at(2500, function () { flap(-178, 500, 'ease-in'); });                   // a tease: it falls shut again
      at(3300, function () { slip.classList.add('is-peek'); flap(-138, 1600); });
      at(5100, function () { flap(-104, 1500); slip.style.setProperty('--blur', '18px'); });
      at(6800, function () { flap(-58, 1900); slip.style.setProperty('--blur', '12px'); theater.classList.add('is-tense'); });
      at(8900, function () { flap(0, 1700, 'cubic-bezier(.3,1.2,.4,1)'); slip.style.setProperty('--blur', '7px'); });
      at(10300, function () { slip.style.setProperty('--blur', '3px'); theater.classList.remove('is-caption'); });
      at(11000, function () {
        slip.style.setProperty('--blur', '0px');
        slip.classList.add('is-hit');
        theater.classList.add('is-hit');
        theater.classList.remove('is-tense');
      });
      at(LEN, finish);

      theater.querySelector('.d-theater__skip').addEventListener('click', function () {
        timers.forEach(clearTimeout);
        if (sound) sound.stop();
        sound = null;
        flap(0, 400);
        slip.style.setProperty('--blur', '0px');
        slip.classList.add('is-peek');
        setTimeout(finish, 450);
      });

      function finish() {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout);
        slip.classList.add('is-open');
        top.style.transition = '';
        top.style.transform = '';
        // Glide back to the table
        var to = home.getBoundingClientRect();
        holder.style.transition = 'transform 0.9s cubic-bezier(.2,.8,.2,1)';
        holder.style.transform = 'translate(' + (to.left + to.width / 2 - cx) + 'px,' + (to.top + to.height / 2 - cy) + 'px) scale(1)';
        theater.classList.remove('is-on');
        theater.classList.add('is-leaving');
        setTimeout(function () {
          home.appendChild(slip);
          slip.classList.remove('is-cinema', 'is-peek', 'is-hit');
          slip.style.removeProperty('--blur');
          theater.remove();
          if (sound) setTimeout(function () { if (sound) sound.stop(); }, 2500);
          resolve();
        }, 920);
      }
    });
  }

  // The whole score for a reveal that hits at hitMs: pad, heartbeat, riser, drumroll, hit
  function score(hitMs) {
    hitMs = hitMs || 11000;
    var snd = new Sound();
    snd.pad(0, hitMs + 200);
    snd.heartbeat(600, hitMs - 2400, 62, 128);
    snd.riser(hitMs - 4400, hitMs);
    snd.roll(hitMs - 2400, hitMs);
    snd.hit(hitMs);
    return snd;
  }

  window.DrawCinema = { play: play, length: LEN, score: score };
})();
