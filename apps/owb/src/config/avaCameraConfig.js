/**
 * avaCameraConfig.js
 *
 * REGION_CAMERA is the statewide overview, framed on REGION_BOUNDS. Unlike the
 * WVWA explorer there are no hand-tuned per-AVA cameras: with no AVA_CAMERA
 * entry the map fits the AVA's real boundary (WVWAMap's fallback), which works
 * for any AVA the database adds later.
 */
import { REGION_BOUNDS } from './regionConfig';

const [w, s, e, n] = REGION_BOUNDS;

export const REGION_CAMERA = {
  lng:     (w + e) / 2,
  // Nudged south of the box centre: the frame's south edge (Southern Oregon AVAs)
  // otherwise sits under the bottom of the viewport.
  lat:     (s + n) / 2 - 0.3,
  zoom:      5.9,
  pitch:    20,
  bearing:   0,
};

export const AVA_CAMERA = {};
