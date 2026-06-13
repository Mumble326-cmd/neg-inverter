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

## Default density values (Ektar 100)

R = 1.0, G = 0.807, B = 0.579
Source: Aaron Buchler, abpy/color-neg-resources (ACEScg linear)
For other stocks, use SET BASE + sliders to calibrate.

## On every deploy

Bump the cache version in sw.js (neg-v1 → neg-v2 etc.)
so users get the updated files immediately.
