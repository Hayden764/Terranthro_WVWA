import express from 'express';

const router = express.Router();

// Mock layer data
const mockLayers = {
  national: [
    // Limited layers for national view
  ],
  state: [
    {
      id: 1,
      type: 'climate',
      name: 'temperature',
      display_name: 'Annual Average Temperature',
      unit: '°F',
      time_period: 'annual-2023'
    },
    {
      id: 2,
      type: 'climate',
      name: 'precipitation',
      display_name: 'Annual Precipitation',
      unit: 'inches',
      time_period: 'annual-2023'
    }
  ],
  ava: [
    {
      id: 1,
      type: 'climate',
      name: 'temperature',
      display_name: 'Temperature',
      url: 'https://storage.terranthro.com/cogs/mock/temp_2023.tif',
      unit: '°F',
      time_period: 'annual-2023',
      legend: { min: 55, max: 75, colorRamp: 'YlOrRd' }
    },
    {
      id: 2,
      type: 'climate',
      name: 'precipitation',
      display_name: 'Precipitation',
      url: 'https://storage.terranthro.com/cogs/mock/precip_2023.tif',
      unit: 'inches',
      time_period: 'annual-2023',
      legend: { min: 20, max: 60, colorRamp: 'Blues' }
    },
    {
      id: 3,
      type: 'climate',
      name: 'gdd',
      display_name: 'Growing Degree Days',
      url: 'https://storage.terranthro.com/cogs/mock/gdd_2023.tif',
      unit: '°F days',
      time_period: 'annual-2023',
      legend: { min: 1500, max: 4000, colorRamp: 'YlOrRd' }
    },
    {
      id: 4,
      type: 'soil',
      name: 'texture',
      display_name: 'Texture',
      url: 'https://storage.terranthro.com/cogs/mock/soil_texture.tif',
      unit: 'class',
      time_period: 'static'
    },
    {
      id: 5,
      type: 'soil',
      name: 'drainage',
      display_name: 'Drainage',
      url: 'https://storage.terranthro.com/cogs/mock/soil_drainage.tif',
      unit: 'class',
      time_period: 'static'
    },
    {
      id: 6,
      type: 'topography',
      name: 'elevation',
      display_name: 'Elevation',
      url: 'https://storage.terranthro.com/cogs/mock/elevation.tif',
      unit: 'feet',
      time_period: 'static',
      legend: { min: 0, max: 3000, colorRamp: 'terrain' }
    },
    {
      id: 7,
      type: 'topography',
      name: 'slope',
      display_name: 'Slope',
      url: 'https://storage.terranthro.com/cogs/mock/slope.tif',
      unit: 'degrees',
      time_period: 'static'
    },
    {
      id: 8,
      type: 'topography',
      name: 'aspect',
      display_name: 'Aspect',
      url: 'https://storage.terranthro.com/cogs/mock/aspect.tif',
      unit: 'degrees',
      time_period: 'static'
    }
  ]
};

/**
 * GET /api/layers/national
 * Returns available layers for national view
 */
router.get('/national', (req, res) => {
  res.json({
    layers: mockLayers.national
  });
});

/**
 * GET /api/layers/state/:stateId
 * Returns available layers for state view
 */
router.get('/state/:stateId', (req, res) => {
  const stateId = parseInt(req.params.stateId);
  const category = req.query.category;
  
  let layers = mockLayers.state;
  
  if (category) {
    layers = layers.filter(layer => layer.type === category);
  }
  
  res.json({
    state_id: stateId,
    layers
  });
});

/**
 * GET /api/layers/:avaId
 * Returns available data layers for an AVA
 */
router.get('/:avaId', (req, res) => {
  const avaId = parseInt(req.params.avaId);
  const category = req.query.category;
  
  let layers = mockLayers.ava;
  
  if (category) {
    layers = layers.filter(layer => layer.type === category);
  }
  
  res.json({
    ava_id: avaId,
    layers
  });
});

export default router;
