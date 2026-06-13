// app.js — entry point

// ─── Shader sources ───────────────────────────────────────────────────────────

const VERT_SRC = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

// Logarithmic transmission model (Beer–Lambert / Negadoctor approach).
// u_density now acts as a PER-CHANNEL GAMMA (contrast / colour balance),
// not a linear multiplier. Flat-field correction is applied before the
// transmission calc to compensate for lens vignetting / lightbox hotspots.
const FRAG_SRC = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_image;
uniform sampler2D u_flatField;
uniform float u_flatFieldStrength;
uniform vec3 u_filmBase;
uniform vec3 u_density;
uniform float u_exposure;
uniform float u_zoom;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSRGB(vec3 c)   { return pow(c, vec3(1.0 / 2.2)); }

void main() {
  // Digital crop-zoom around the frame centre (u_zoom >= 1.0; 1.0 = no zoom)
  vec2 uv = (v_texCoord - 0.5) / u_zoom + 0.5;
  vec3 neg     = toLinear(texture2D(u_image, uv).rgb);
  vec3 ffField = toLinear(texture2D(u_flatField, uv).rgb);

  // Flat-field correction: divide out the illumination profile.
  // strength 0.0 -> divisor is 1.0 (no-op); strength 1.0 -> full division.
  // NOTE: 'flat' is a reserved GLSL keyword, so this var is named ffField.
  vec3 ffDiv = ffField * u_flatFieldStrength + (1.0 - u_flatFieldStrength);
  neg = neg / max(ffDiv, vec3(0.0001));

  vec3 transmission = clamp(neg / u_filmBase, 0.0001, 1.0);
  vec3 inverted = vec3(1.0) - transmission;
  vec3 pos = pow(max(inverted, vec3(0.0)), u_density) * u_exposure;
  gl_FragColor = vec4(toSRGB(clamp(pos, 0.0, 1.0)), 1.0);
}`;

// ─── sRGB → linear conversion (CPU side, for SET BASE) ───────────────────────
// The values sampled from a 2D canvas are sRGB-encoded.
// The shader works in linear light. We must convert before uploading u_filmBase.
function srgbToLinear(c) {
  // c in [0, 1] — IEC 61966-2-1 piecewise
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ─── State ────────────────────────────────────────────────────────────────────
// Default: Ektar 100 gamma balance for the logarithmic model.
const state = {
  filmBase: [
    srgbToLinear(0.85),   // warm orange — reasonable starting point
    srgbToLinear(0.55),
    srgbToLinear(0.25),
  ],
  density:  [1.0, 0.85, 0.70], // per-channel gamma
  exposure: 1.0,
  flatFieldStrength: 0.0,
};

// ─── Film stock presets ─────────────────────────────────────────────────────────
// Each preset is an [R, G, B] per-channel GAMMA (not a density ratio).
// R is held at 1.0 as the reference channel; G and B trim colour balance.
// Sensible starting points — fine-tune with SET BASE + the sliders per roll.
const PRESETS = {
  ektar100:     [1.0, 0.85, 0.70],
  portra400:    [1.0, 0.88, 0.74],
  portra800:    [1.0, 0.90, 0.76],
  gold200:      [1.0, 0.86, 0.72],
  fuji200:      [1.0, 0.84, 0.68],
  cinestill800t:[1.0, 0.82, 0.65],
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('canvas');
const statusEl    = document.getElementById('status');
const statusDot   = document.getElementById('status-dot');
const btnSample   = document.getElementById('btn-sample');
const btnCapture  = document.getElementById('btn-capture');
const btnCalib    = document.getElementById('btn-calib');
const btnReset    = document.getElementById('btn-reset');
const slR  = document.getElementById('sl-r');
const slG  = document.getElementById('sl-g');
const slB  = document.getElementById('sl-b');
const slEv = document.getElementById('sl-ev');
const slFF = document.getElementById('sl-ff');
const slZoom = document.getElementById('sl-zoom');
const valZoom = document.getElementById('val-zoom');
const zoomRow = document.getElementById('zoom-row');
const slPreset = document.getElementById('sl-preset');
const valR  = document.getElementById('val-r');
const valG  = document.getElementById('val-g');
const valB  = document.getElementById('val-b');
const valEv = document.getElementById('val-ev');
const valFF = document.getElementById('val-ff');
const introOverlay = document.getElementById('intro-overlay');
const shutterFlash = document.getElementById('shutter-flash');
const crosshair    = document.getElementById('crosshair');

// ─── Status / film-name helpers ─────────────────────────────────────────────────
let baseSet = false;
let flashTimer = null;

function currentFilmName() {
  const opt = slPreset.options[slPreset.selectedIndex];
  return opt ? opt.text.toUpperCase() : 'CUSTOM';
}
function showFilmName() {
  statusEl.textContent = currentFilmName();
}
function flashStatus(msg) {
  statusEl.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(showFilmName, 1500);
}
function updateDot() {
  if (!statusDot) return;
  statusDot.className = baseSet ? 'dot-live' : 'dot-nobase';
}

// ─── Intro overlay ──────────────────────────────────────────────────────────────
function dismissIntro() {
  if (introOverlay) introOverlay.classList.add('hidden');
  try { sessionStorage.setItem('neg-intro-dismissed', '1'); } catch (_) {}
}

// ─── Crosshair + shutter feedback ────────────────────────────────────────────────
let crosshairTimer = null;
function showCrosshair(clientX, clientY) {
  if (!crosshair) return;
  crosshair.style.left = clientX + 'px';
  crosshair.style.top  = clientY + 'px';
  crosshair.classList.add('show');
  clearTimeout(crosshairTimer);
  crosshairTimer = setTimeout(() => crosshair.classList.remove('show'), 800);
}
function flashShutter() {
  if (!shutterFlash) return;
  shutterFlash.classList.remove('flash');
  void shutterFlash.offsetWidth; // force reflow so the animation can re-trigger
  shutterFlash.classList.add('flash');
}

// ─── SET BASE helper ──────────────────────────────────────────────────────────
// Reusable offscreen 2D canvas for reading raw camera pixels.
// willReadFrequently keeps it on the CPU — faster for repeated getImageData.
let sampleCanvas, sampleCtx;
function getSampleCtx() {
  if (!sampleCanvas) {
    sampleCanvas = document.createElement('canvas');
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  return sampleCtx;
}

// Sample an N×N region and set u_filmBase. centerX/centerY are in video-pixel
// coords; if omitted, the dead centre of the frame is used (SET BASE button).
function sampleFilmBase(video, gl, loc, centerX, centerY, N) {
  const ctx = getSampleCtx();
  const w = video.videoWidth, h = video.videoHeight;
  sampleCanvas.width  = w;
  sampleCanvas.height = h;
  ctx.drawImage(video, 0, 0);

  N = N || 11;
  const half = (N - 1) / 2;
  let cx = (centerX === undefined) ? Math.floor((w - N) / 2) : Math.round(centerX - half);
  let cy = (centerY === undefined) ? Math.floor((h - N) / 2) : Math.round(centerY - half);
  // Keep the read window fully inside the frame
  cx = Math.min(Math.max(cx, 0), Math.max(w - N, 0));
  cy = Math.min(Math.max(cy, 0), Math.max(h - N, 0));

  const data = ctx.getImageData(cx, cy, N, N).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  const n = N * N;

  // Convert sRGB 0–255 → linear 0–1 before uploading as u_filmBase
  // This is the critical step — the shader divides in linear light
  state.filmBase[0] = Math.max(srgbToLinear(r / n / 255), 0.01);
  state.filmBase[1] = Math.max(srgbToLinear(g / n / 255), 0.01);
  state.filmBase[2] = Math.max(srgbToLinear(b / n / 255), 0.01);

  gl.uniform3fv(loc.u_filmBase, state.filmBase);

  baseSet = true;
  updateDot();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function init() {
  // Restore intro-overlay dismissal for this session
  try {
    if (sessionStorage.getItem('neg-intro-dismissed') && introOverlay) {
      introOverlay.classList.add('hidden');
    }
  } catch (_) {}
  updateDot(); // start amber (no base set)

  // Hidden video element — doesn't need to be in the DOM
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;

  // WebGL setup. preserveDrawingBuffer:true is required so CAPTURE's toBlob()
  // can read the rendered frame. high-performance hints the discrete/most-capable GPU.
  const gl = canvas.getContext('webgl', {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  if (!gl) { statusEl.textContent = 'NO WEBGL'; return; }

  // Set pixel store flags once at init — not per frame
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  // Compile shaders
  const program = createProgram(gl, VERT_SRC, FRAG_SRC);
  const loc = getLocations(gl, program);
  gl.useProgram(program);

  // Full-screen quad: two triangles covering clip space (-1,-1) → (1,1)
  const positions = new Float32Array([
    -1, -1,   1, -1,   -1,  1,
    -1,  1,   1, -1,    1,  1,
  ]);
  const texCoords = new Float32Array([
     0,  0,   1,  0,    0,  1,
     0,  1,   1,  0,    1,  1,
  ]);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc.a_position);
  gl.vertexAttribPointer(loc.a_position, 2, gl.FLOAT, false, 0, 0);

  const texBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
  gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc.a_texCoord);
  gl.vertexAttribPointer(loc.a_texCoord, 2, gl.FLOAT, false, 0, 0);

  // Camera texture on texture unit 0
  gl.activeTexture(gl.TEXTURE0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(loc.u_image, 0);

  // Flat-field texture on texture unit 1 — initialised to a 1×1 white pixel
  // (neutral, so it's a no-op until the user taps CALIB).
  gl.activeTexture(gl.TEXTURE1);
  const flatTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, flatTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));
  gl.uniform1i(loc.u_flatField, 1);

  // Back to unit 0 — the render loop uploads camera frames here
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);

  // Set initial uniforms
  gl.uniform3fv(loc.u_filmBase, state.filmBase);
  gl.uniform3fv(loc.u_density,  state.density);
  gl.uniform1f(loc.u_exposure,  state.exposure);
  gl.uniform1f(loc.u_flatFieldStrength, state.flatFieldStrength);
  gl.uniform1f(loc.u_zoom, 1.0);

  // Start camera
  const stream = await startCamera(video, statusEl);
  // Once running, the top-left shows the film stock name (camera.js set LIVE)
  showFilmName();
  updateDot();

  // Zoom — lets the user fill the frame with the negative while staying far
  // enough back for the lens to focus. Prefer the camera's native zoom (best
  // quality); if the browser doesn't expose it, fall back to a shader crop-zoom
  // that works on every device. The slider is always shown.
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  const caps = (track && track.getCapabilities) ? track.getCapabilities() : {};
  if (zoomRow && slZoom) {
    if (caps.zoom && track) {
      // Native zoom (optical/sensor) — set the slider to the device's range
      const settings = track.getSettings ? track.getSettings() : {};
      slZoom.min  = caps.zoom.min;
      slZoom.max  = caps.zoom.max;
      slZoom.step = caps.zoom.step || 0.1;
      slZoom.value = settings.zoom || caps.zoom.min;
      if (valZoom) valZoom.textContent = parseFloat(slZoom.value).toFixed(1);
      slZoom.addEventListener('input', async () => {
        const z = parseFloat(slZoom.value);
        if (valZoom) valZoom.textContent = z.toFixed(1);
        try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch (_) {}
      });
    } else {
      // Fallback: digital crop-zoom in the shader (1.0–5.0)
      slZoom.min = 1; slZoom.max = 5; slZoom.step = 0.1; slZoom.value = 1;
      if (valZoom) valZoom.textContent = '1.0';
      slZoom.addEventListener('input', () => {
        const z = parseFloat(slZoom.value);
        if (valZoom) valZoom.textContent = z.toFixed(1);
        gl.uniform1f(loc.u_zoom, z);
      });
    }
    zoomRow.style.display = '';
  }

  // Size canvas backing store to video dimensions (avoids stretching)
  function sizeCanvas() {
    if (video.videoWidth && video.videoHeight) {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  }
  video.addEventListener('loadedmetadata', sizeCanvas);
  sizeCanvas();

  // ─── Sliders ──────────────────────────────────────────────────────────────
  // Read R/G/B/EV into state and push uniforms
  function syncSliders() {
    state.density[0] = parseFloat(slR.value);
    state.density[1] = parseFloat(slG.value);
    state.density[2] = parseFloat(slB.value);
    state.exposure   = parseFloat(slEv.value);
    valR.textContent  = state.density[0].toFixed(2);
    valG.textContent  = state.density[1].toFixed(2);
    valB.textContent  = state.density[2].toFixed(2);
    valEv.textContent = state.exposure.toFixed(2);
    gl.uniform3fv(loc.u_density,  state.density);
    gl.uniform1f(loc.u_exposure,  state.exposure);
  }

  // Apply a named preset to the R/G/B sliders + state
  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    slPreset.value = key;
    slR.value = p[0];
    slG.value = p[1];
    slB.value = p[2];
    syncSliders();
    showFilmName();
  }

  // Manually moving an R/G/B slider drops the preset to Custom
  [slR, slG, slB].forEach(s => s.addEventListener('input', () => {
    syncSliders();
    slPreset.value = 'custom';
    showFilmName();
  }));
  // EV is independent of the film stock — adjusting it doesn't change the preset
  slEv.addEventListener('input', syncSliders);

  // Flat-field strength slider (FF)
  function syncFF() {
    if (!slFF) return;
    state.flatFieldStrength = parseFloat(slFF.value);
    if (valFF) valFF.textContent = state.flatFieldStrength.toFixed(2);
    gl.uniform1f(loc.u_flatFieldStrength, state.flatFieldStrength);
  }
  if (slFF) slFF.addEventListener('input', syncFF);

  // Preset dropdown
  slPreset.addEventListener('change', () => {
    if (PRESETS[slPreset.value]) {
      applyPreset(slPreset.value);
    } else {
      showFilmName(); // 'custom' — leave sliders as-is
    }
  });

  // RESET — restore the current preset's R/G/B defaults + EV, leave film base
  if (btnReset) btnReset.addEventListener('click', () => {
    let key = slPreset.value;
    if (!PRESETS[key]) key = 'ektar100';
    slEv.value = 1.0;
    applyPreset(key);
  });

  // SET BASE button — sample the dead centre (11×11)
  btnSample.addEventListener('click', () => {
    if (video.readyState < 2) return;
    sampleFilmBase(video, gl, loc);          // centre, N=11
    dismissIntro();
    flashStatus('BASE SET');
  });

  // Tap-to-sample on the canvas — sample a 15×15 region at the tap point
  canvas.addEventListener('click', (e) => {
    if (video.readyState < 2 || !canvas.width) return;
    const rect = canvas.getBoundingClientRect();
    const tx = e.clientX - rect.left;
    const ty = e.clientY - rect.top;

    // Map CSS coords → backing-store (video) coords through object-fit: cover
    const cw = canvas.width, ch = canvas.height;
    const s = Math.max(rect.width / cw, rect.height / ch);
    const offX = (rect.width  - cw * s) / 2;
    const offY = (rect.height - ch * s) / 2;
    const vx = (tx - offX) / s;
    const vy = (ty - offY) / s;

    sampleFilmBase(video, gl, loc, vx, vy, 15);
    showCrosshair(e.clientX, e.clientY);
    dismissIntro();
    flashStatus('BASE SET');
  });

  // CAPTURE — save the current inverted frame as a PNG
  function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
           `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  if (btnCapture) btnCapture.addEventListener('click', () => {
    flashShutter();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `neg-${timestamp()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
    flashStatus('CAPTURED');
  });

  // CALIB — capture the current frame as a flat-field reference (unit 1).
  // Point at an EMPTY lightbox (no film) first, then tap CALIB.
  function captureFlatField() {
    const ctx = getSampleCtx();
    sampleCanvas.width  = video.videoWidth;
    sampleCanvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, flatTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sampleCanvas);
    // Restore unit 0 for camera uploads in the render loop
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }
  if (btnCalib) btnCalib.addEventListener('click', () => {
    if (video.readyState < 2) return;
    captureFlatField();
    // Apply the correction immediately so it's visible; user can dial FF back
    if (slFF) slFF.value = 1.0;
    syncFF();
    flashStatus('CALIBRATED');
  });

  // Wake lock — prevents screen sleep while using the app
  let wakeLock = null;
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
  requestWakeLock();

  // Camera teardown — release camera when leaving the page
  window.addEventListener('pagehide', () => {
    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());
  });

  // Render loop — use requestVideoFrameCallback if available (only uploads
  // a new texture when there is actually a new camera frame to show).
  // Uniforms are NOT re-sent here — they only change on UI events.
  // Per frame we only move the pixels via texSubImage2D (no realloc).
  let texAllocated = false;
  function drawScene() {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (!texAllocated) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        texAllocated = true;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    function rvfcLoop() {
      drawScene();
      video.requestVideoFrameCallback(rvfcLoop);
    }
    video.requestVideoFrameCallback(rvfcLoop);
  } else {
    // Fallback only: requestAnimationFrame
    function rafLoop() {
      drawScene();
      requestAnimationFrame(rafLoop);
    }
    rafLoop();
  }
}

// PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => {
    console.warn('SW registration failed:', err);
  });
}

init().catch(err => {
  console.error(err);
  statusEl.textContent = 'ERROR — ' + err.message;
});
