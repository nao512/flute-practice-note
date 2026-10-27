/* v8 practice tools. No access to the practice log or its localStorage keys. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tunerTab = $('tunerTab'), metroTab = $('metroTab');
  let micStream = null, tunerContext = null, analyser = null, tunerFrame = 0;
  let metronomeContext = null, timer = null, nextBeatAt = 0, beatIndex = 0;
  let tapTimes = [], recentPitches = [];

  function showTab(name) {
    const tuner = name === 'tuner';
    $('tunerPanel').hidden = !tuner;
    $('metroPanel').hidden = tuner;
    tunerTab.setAttribute('aria-selected', String(tuner));
    metroTab.setAttribute('aria-selected', String(!tuner));
    if (!tuner) stopTuner();
    if (tuner) stopMetronome();
  }
  tunerTab.addEventListener('click', () => showTab('tuner'));
  metroTab.addEventListener('click', () => showTab('metro'));

  function detectPitch(samples, sampleRate) {
    // YIN cumulative mean normalized difference; works without any external library.
    const length = Math.min(2048, samples.length);
    let energy = 0;
    for (let i = 0; i < length; i++) energy += samples[i] * samples[i];
    if (Math.sqrt(energy / length) < 0.012) return null;
    const minTau = Math.max(2, Math.floor(sampleRate / 2200));
    const maxTau = Math.min(Math.floor(sampleRate / 75), Math.floor(length / 2));
    const differences = new Float64Array(maxTau + 1);
    for (let tau = minTau; tau <= maxTau; tau++) {
      let diff = 0;
      for (let i = 0; i < length - maxTau; i++) {
        const d = samples[i] - samples[i + tau];
        diff += d * d;
      }
      differences[tau] = diff;
    }
    let cumulative = 0, candidate = -1, minimum = 1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      cumulative += differences[tau];
      const normalized = cumulative ? differences[tau] * (tau - minTau + 1) / cumulative : 1;
      if (normalized < minimum) minimum = normalized;
      if (normalized < 0.14) {
        let bestTau = tau, bestValue = normalized;
        for (let j = tau + 1; j <= Math.min(tau + 6, maxTau); j++) {
          const value = differences[j] * (j - minTau + 1) / cumulative;
          if (value < bestValue) { bestValue = value; bestTau = j; }
          else break;
        }
        candidate = bestTau;
        break;
      }
    }
    if (candidate < 0 || minimum > 0.2) return null;
    const a = differences[candidate - 1], b = differences[candidate], c = differences[candidate + 1];
    const denominator = a - 2 * b + c;
    const adjustment = denominator && Number.isFinite(denominator) ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * denominator))) : 0;
    return sampleRate / (candidate + adjustment);
  }
  function updatePitch(frequency) {
    if (!frequency) {
      $('tunerFrequency').textContent = '音を待っています…';
      $('tunerNote').textContent = '--';
      $('tunerCents').textContent = '-- ¢';
      $('tunerNeedle').style.left = '50%';
      recentPitches = [];
      return;
    }
    recentPitches.push(frequency);
    if (recentPitches.length > 5) recentPitches.shift();
    const sorted = [...recentPitches].sort((a,b) => a-b);
    frequency = sorted[Math.floor(sorted.length / 2)];
    const reference = Number($('tunerReference').value);
    const midi = Math.round(69 + 12 * Math.log2(frequency / reference));
    const noteNames = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
    const octave = Math.floor(midi / 12) - 1;
    const cents = 1200 * Math.log2(frequency / (reference * Math.pow(2, (midi-69)/12)));
    $('tunerNote').textContent = noteNames[((midi % 12) + 12) % 12] + octave;
    $('tunerFrequency').textContent = frequency.toFixed(1) + ' Hz';
    $('tunerCents').textContent = (cents > 0 ? '+' : '') + Math.round(cents) + ' ¢';
    $('tunerNeedle').style.left = (50 + Math.max(-50, Math.min(50, cents))) + '%';
    $('tunerStatus').textContent = Math.abs(cents) < 7 ? '✅ 音程が合っています' : cents < 0 ? '♭ 少し低い音です' : '♯ 少し高い音です';
  }
  function readTuner() {
    if (!analyser) return;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    updatePitch(detectPitch(samples, tunerContext.sampleRate));
    tunerFrame = window.setTimeout(readTuner, 120);
  }
  async function stopTuner() {
    clearTimeout(tunerFrame);
    const stream = micStream, context = tunerContext;
    micStream = null; analyser = null; tunerContext = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (context) await context.close().catch(() => {});
    $('tunerToggle').textContent = '🎤 チューナーを開始';
    $('tunerStatus').textContent = '停止中（マイクは使用していません）';
    $('tunerFrequency').textContent = 'マイクを開始してください';
  }
  $('tunerToggle').addEventListener('click', async () => {
    if (micStream) { await stopTuner(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      $('tunerStatus').textContent = 'このブラウザではマイクを使えません。HTTPSで開き、Chromeなどでお試しください。';
      return;
    }
    $('tunerToggle').disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if ($('tunerPanel').hidden) { stream.getTracks().forEach(t => t.stop()); return; }
      micStream = stream;
      tunerContext = new AudioContext();
      analyser = tunerContext.createAnalyser();
      analyser.fftSize = 4096;
      tunerContext.createMediaStreamSource(stream).connect(analyser);
      $('tunerToggle').textContent = '■ チューナーを停止';
      $('tunerStatus').textContent = '測定中。楽器で音を鳴らしてください。';
      readTuner();
    } catch (error) {
      $('tunerStatus').textContent = 'マイクを開始できませんでした。ブラウザのマイク許可を確認してください。';
      await stopTuner();
      $('tunerStatus').textContent = 'マイクを開始できませんでした。マイクの許可とHTTPS接続をご確認ください。';
    } finally { $('tunerToggle').disabled = false; }
  });

  function bpm() { return Math.max(40, Math.min(240, Math.round(Number($('metroBpm').value) || 120))); }
  function setBpm(value) {
    const tempo = Math.max(40, Math.min(240, Math.round(Number(value) || 120)));
    $('metroBpm').value = tempo;
    $('metroTempoSlider').value = tempo;
    $('metroBpmDisplay').textContent = tempo;
  }
  function drawLights(active = -1) {
    const beats = Number($('metroMeter').value);
    $('metroLights').innerHTML = Array.from({length:beats}, (_,i) => `<span class="beat-light${i===active?' active':''}${i===0?' first':''}" aria-hidden="true"></span>`).join('');
  }
  function scheduleClick(when, beat, beats) {
    if (!metronomeContext) return;
    const oscillator = metronomeContext.createOscillator();
    const gain = metronomeContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = beat === 0 ? 1200 : 850;
    const volume = beat === 0 ? 0.24 : 0.15;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.065);
    oscillator.connect(gain).connect(metronomeContext.destination);
    oscillator.start(when);
    oscillator.stop(when + 0.07);
    const delay = Math.max(0, (when - metronomeContext.currentTime) * 1000);
    setTimeout(() => { if (metronomeContext) drawLights(beat % beats); }, delay);
  }
  function scheduler() {
    if (!metronomeContext) return;
    const beats = Number($('metroMeter').value);
    while (nextBeatAt < metronomeContext.currentTime + 0.12) {
      scheduleClick(nextBeatAt, beatIndex % beats, beats);
      nextBeatAt += 60 / bpm();
      beatIndex++;
    }
  }
  async function stopMetronome() {
    clearInterval(timer); timer = null;
    const context = metronomeContext; metronomeContext = null;
    if (context) await context.close().catch(() => {});
    $('metroToggle').textContent = '▶ 開始';
    $('metroStatus').textContent = '停止中';
    drawLights();
  }
  $('metroToggle').addEventListener('click', async () => {
    if (metronomeContext) { await stopMetronome(); return; }
    if (!window.AudioContext) { $('metroStatus').textContent = 'このブラウザは音声再生に対応していません。'; return; }
    try {
      metronomeContext = new AudioContext();
      await metronomeContext.resume();
      beatIndex = 0;
      nextBeatAt = metronomeContext.currentTime + 0.05;
      $('metroToggle').textContent = '■ 停止';
      $('metroStatus').textContent = '再生中';
      scheduler();
      timer = setInterval(scheduler, 25);
    } catch { await stopMetronome(); $('metroStatus').textContent = '音を再生できませんでした。'; }
  });
  $('metroBpm').addEventListener('change', e => setBpm(e.target.value));
  $('metroTempoSlider').addEventListener('input', e => setBpm(e.target.value));
  $('metroMeter').addEventListener('change', () => { beatIndex = 0; drawLights(); });
  $('tapTempo').addEventListener('click', () => {
    const now = performance.now();
    if (tapTimes.length && now - tapTimes.at(-1) > 2200) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length > 5) tapTimes.shift();
    if (tapTimes.length < 2) return;
    const intervals = tapTimes.slice(1).map((time,i) => time-tapTimes[i]);
    setBpm(60000 / (intervals.reduce((a,b)=>a+b,0) / intervals.length));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopTuner(); stopMetronome(); }
  });
  window.addEventListener('pagehide', () => { stopTuner(); stopMetronome(); });
  drawLights();
})();
