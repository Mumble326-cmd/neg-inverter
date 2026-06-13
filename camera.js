// camera.js — start camera, attempt to lock AWB/exposure/focus

async function startCamera(videoEl, statusEl) {
  statusEl.textContent = 'REQUESTING CAMERA';

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { exact: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      }
    });
  } catch (err) {
    statusEl.textContent = 'CAMERA ERROR';
    throw new Error('getUserMedia failed: ' + err.message);
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

  if (caps.whiteBalanceMode?.includes('manual') && caps.colorTemperature) {
    const k = Math.min(Math.max(5500, caps.colorTemperature.min), caps.colorTemperature.max);
    advanced.push({ whiteBalanceMode: 'manual', colorTemperature: k });
  }

  if (caps.exposureMode?.includes('manual') && caps.exposureTime) {
    // exposureTime is in 100-microsecond units. Start at a mid-range value.
    const mid = Math.round((caps.exposureTime.min + caps.exposureTime.max) / 2);
    advanced.push({ exposureMode: 'manual', exposureTime: mid });
  }

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
