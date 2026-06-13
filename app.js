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

const FRAG_SRC = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_image;
uniform vec3 u_filmBase;
uniform vec3 u_density;
uniform float u_exposure;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSRGB(vec3 c)   { return pow(c, vec3(1.0 / 2.2)); }

void main() {
  vec3 neg = toLinear(texture2D(u_image, v_texCoord).rgb);
  neg = max(neg, vec3(0.001));
  vec3 normalised = neg / u_filmBase;
  vec3 pos = (u_density / normalised) * u_exposure;
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
// Default density balance: Ektar 100 (Aaron Buchler / abpy, ACEScg linear)
const state = {
  filmBase: [
    srgbToLinear(0.85),   // warm orange — reasonable starting point
    srgbToLinear(0.55),
    srgbToLinear(0.25),
  ],
  density:  [1.0, 0.807, 0.579],
  exposure: 1.0,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const canvas    = document.getElementById('canvas');
const statusEl  = document.getElementById('status');
const btnSample = document.getElementById('btn-sample');
const slR  = document.getElementById('sl-r');
const slG  = document.getElementById('sl-g');
const slB  = document.getElementById('sl-b');
const slEv = document.getElementById('sl-ev');
const valR  = document.getElementById('val-r');
const valG  = document.getElementById('val-g');
const valB  = document.getElementById('val-b');
const valEv = document.getElementById('val-ev');

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

function sampleFilmBase(video, gl, loc) {
  const ctx = getSampleCtx();
  sampleCanvas.width  = video.videoWidth;
  sampleCanvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  // Average an 11×11 region at the centre — more stable than a single pixel
  const N = 11;
  const cx = Math.floor((sampleCanvas.width  - N) / 2);
  const cy = Math.floor((sampleCanvas.height - N) / 2);
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
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function init() {
  // Hidden video element — doesn't need to be in the DOM
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;

  // WebGL setup
  const gl = canvas.getContext('webgl', {
    premultipliedAlpha: false,
    preserveDrawingBuffer: false, // set true if you add a "save frame" button
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

  // Camera texture
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(loc.u_image, 0);

  // Set initial uniforms
  gl.uniform3fv(loc.u_filmBase, state.filmBase);
  gl.uniform3fv(loc.u_density,  state.density);
  gl.uniform1f(loc.u_exposure,  state.exposure);

  // Start camera
  await startCamera(video, statusEl);

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

  // Sliders
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
  [slR, slG, slB, slEv].forEach(s => s.addEventListener('input', syncSliders));

  // SET BASE button
  btnSample.addEventListener('click', () => {
    if (video.readyState < 2) return;
    sampleFilmBase(video, gl, loc);
    statusEl.textContent = 'BASE SET';
    setTimeout(() => statusEl.textContent = 'LIVE', 1500);
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
  // a new texture when there is actually a new camera frame to show)
  function drawScene() {
    // Guard: only upload if the video has decoded at least one frame
    if (video.readyState >= 2 && video.videoWidth > 0) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.uniform3fv(loc.u_filmBase, state.filmBase);
      gl.uniform3fv(loc.u_density,  state.density);
      gl.uniform1f(loc.u_exposure,  state.exposure);
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
    // Fallback: requestAnimationFrame (uploads every display frame regardless)
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
