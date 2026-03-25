/**
 * avaCameraConfig.js
 *
 * Per-AVA camera overrides applied when flying to a sub-AVA from the InfoPanel.
 * The map always uses fitBounds() on the real GeoJSON bounding box to ensure
 * the entire AVA is visible — these values only control the cinematic tilt (pitch)
 * and compass rotation (bearing) of the 3D view.
 *
 * pitch   — 0 = top-down, 60 = low angle. 35–50 is a good cinematic range.
 * bearing — compass heading in degrees. 0 = north-up. Rotate to face terrain.
 */

/**
 * Camera position for the full Willamette Valley overview —
 * used when deselecting a sub-AVA to fly back to the valley.
 * Dial this in with the Camera Inspector the same way as sub-AVAs.
 */
export const WV_CAMERA = {
  lng:     -123.06662,
  lat:      44.49445,
  zoom:      7.61,
  pitch:    35,
  bearing:   0,
};

export const AVA_CAMERA = {
  'chehalem-mountains':      { lng: -122.95951, lat: 45.34493, zoom: 10.50, pitch: 41, bearing: 0  },
  'dundee-hills':            { lng: -123.06127, lat: 45.26309, zoom: 12.13, pitch: 41, bearing:  0  },
  'eola-amity-hills':        { lng: -123.14329, lat: 45.01045, zoom: 10.66, pitch: 40, bearing:  0  },
  'laurelwood-district':     { lng: -122.95868, lat: 45.36815, zoom: 11.05, pitch: 43.5, bearing:  0  },
  'lower-long-tom':          { lng: -123.34780, lat: 44.20113, zoom: 11.28, pitch: 41, bearing:  0  },
  'mcminnville':             { lng: -123.35863, lat: 45.14000, zoom: 11.14, pitch: 41, bearing: 0  },
  'mount-pisgah-polk-county':{ lng: -123.29523, lat: 44.87387, zoom: 12.64, pitch: 41, bearing:  0  },
  'ribbon-ridge':            { lng: -123.07560, lat: 45.34847, zoom: 12.78, pitch: 41, bearing: 0  },
  'tualatin-hills':          { lng: -123.16005, lat: 45.54413, zoom: 9.94, pitch: 41, bearing:  0  },
  'van-duzer-corridor':      { lng: -123.27907, lat: 44.99373, zoom: 10.94, pitch: 35.5, bearing: 0 },
  'yamhill-carlton':         { lng: -123.21034, lat: 45.30000, zoom: 10.82, pitch: 39, bearing:  0  },
};

