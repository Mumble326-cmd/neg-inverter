// camera.js — start camera, attempt to lock AWB/exposure/focus

async function startCamera(videoEl, statusEl) {
  statusEl.textContent = 'REQUESTING CAMERA';

  // Ask for the back camera at 720p / 30fps. facingMode is 'ideal' not 'exact'
  // so it degrades gracefully (front camera) instead of throwing if the exact
  // environment camera can't be matched — avoids a hard CAMERA ERROR / black screen.
  const baseVideo = {
    facingMode: { ideal: 'environment' },
    width:  { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: baseVideo });
  } catch (err) {
    // Last-resort fallback: any camera at all, so we never dead-end on a black screen
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } catch (err2) {
      statusEl.textContent = 'CAMERA ERROR';
      throw new Error('getUserMedia failed: ' + err2.message);
    }
  }

  videoEl.srcObject = stream;
  videoEl.playsInline = true;
  videoEl.muted = true;
  videoEl.autoplay = true;
  await videoEl.play();

  // Wait for the stream to actually start before calling getCapabilities()
  // Chrome requires the stream to be live before capabilities are available
  await new Promise(resolve => {
    if (videoEl.readyState >= 2) return resolve();
    videoEl.addEventListener('loadeddata', resolve, { once: true });
  });

  const track = stream.getVideoTracks()[0];
  const caps  = track.getCapabilities ? track.getCapabilities() : {};
  const advanced = [];

  // Lock white balance — colour stability is what matters for consistent
  // inversion, and a fixed WB doesn't cost any frame rate.
  if (caps.whiteBalanceMode?.includes('manual') && caps.colorTemperature) {
    const k = Math.min(Math.max(5500, caps.colorTemperature.min), caps.colorTemperature.max);
    advanced.push({ whiteBalanceMode: 'manual', colorTemperature: k });
  }

  // NOTE: deliberately NOT locking exposureTime to the midpoint of its range.
  // That midpoint is often a long exposure (tens of ms) which caps the sensor
  // frame rate and was the main cause of the stuttery viewfinder. We leave
  // exposure in continuous/auto so the camera holds ~30fps; brightness is
  // handled by the EV slider in the shader instead.
  if (caps.focusMode?.includes('continuous')) {
    advanced.push({ focusMode: 'continuous' });
  }

  if (advanced.length > 0) {
    try {
      await track.applyConstraints({ advanced });
      const settings = track.getSettings();
      const wbLocked = settings.whiteBalanceMode === 'manual';
      statusEl.textContent = wbLocked ? 'AWB LOCKED' : 'LIVE';
    } catch (err) {
      console.warn('Could not apply camera constraints:', err);
      statusEl.textContent = 'LIVE';
    }
  } else {
    statusEl.textContent = 'LIVE';
  }

  return stream;
}
