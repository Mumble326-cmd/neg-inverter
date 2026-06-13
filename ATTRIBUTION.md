# Attribution

NEG embeds film-stock data **derived from** the **spektrafilm** project.

- Project: spektrafilm — https://github.com/andreavolpato/spektrafilm
- Copyright: © 2026 Andrea Volpato
- Licence: GNU General Public License v3.0 (GPL-3.0)

## What was derived

The per-film preset values in `app.js` (`PRESETS`) were computed from
spektrafilm's published per-film profiles:

- **`filmBase`** (orange-mask colour, linear RGB) — derived from each profile's
  spectral `base_density` curve, converted to RGB-band transmission.
- **`density`** (per-channel gamma) — derived from the central slope of each
  profile's `density_curves` (the characteristic / H&D curves).

Stocks used: Kodak Ektar 100, Portra 400, Portra 800, Gold 200; Fujifilm C200;
and Kodak Vision3 500T (used as the documented proxy for CineStill 800T, whose
remjet removal changes halation, not spectral response).

## Citation

If you use spektrafilm in your work, cite the project per its CITATION.cff:
https://github.com/andreavolpato/spektrafilm

## Licence consequence

Because NEG distributes data derived from spektrafilm (a GPL-3.0 work), NEG is
itself distributed under **GPL-3.0-or-later**. See `LICENSE`.
