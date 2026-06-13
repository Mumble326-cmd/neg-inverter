# NEG — Live Film Negative Inverter

Real-time colour film negative inverter PWA. WebGL shader, no framework, no build step.

## File structure

```
index.html              main HTML
style.css               UI styling
app.js                  entry point, render loop, state, SET BASE
camera.js               getUserMedia + AWB/exposure lock
gl/program.js           shader compile/link helpers
manifest.webmanifest    PWA metadata
sw.js                   service worker (offline + installability)
icon-192.png            )
icon-512.png            ) you create these — plain black squares are fine for testing
icon-512-maskable.png   )
```

## Deploy to GitHub Pages

1. Create a new public repo on github.com called `neg-inverter`
2. Push this folder to main branch
3. Repo → Settings → Pages → Branch: main → Save

Access at: `https://YOURUSERNAME.github.io/neg-inverter/`

## Usage

1. Open on Pixel in Chrome, grant camera permission
2. Point at unexposed film leader on a lightbox
3. Tap SET BASE
4. Dial R/G/B sliders for colour balance, EV for brightness

## Film stock presets

Per-stock presets (orange-mask base + per-channel gamma) are **derived from the
spektrafilm project's** spectral and characteristic-curve data. See
`ATTRIBUTION.md`. SET BASE + the sliders still let you calibrate per roll.

## Licence

NEG is licensed under **GPL-3.0-or-later** because it embeds data derived from
spektrafilm (GPL-3.0). See `LICENSE` and `ATTRIBUTION.md`.

## On every deploy

Bump the cache version in sw.js (neg-v1 → neg-v2 etc.)
so users get the updated files immediately.
