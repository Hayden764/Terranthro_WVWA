import express from 'express';

const router = express.Router();

// Mock data for development
const mockStates = [
  { 
    id: 1, 
    name: 'California', 
    abbreviation: 'CA', 
    tons_crushed: 3500000,
    centroid: { type: 'Point', coordinates: [-119.4179, 36.7783] }
  },
  { 
    id: 2, 
    name: 'Oregon', 
    abbreviation: 'OR', 
    tons_crushed: 85000,
    centroid: { type: 'Point', coordinates: [-120.5542, 43.8041] }
  },
  { 
    id: 3, 
    name: 'Washington', 
    abbreviation: 'WA', 
    tons_crushed: 270000,
    centroid: { type: 'Point', coordinates: [-120.7401, 47.7511] }
  },
  { 
    id: 4, 
    name: 'New York', 
    abbreviation: 'NY', 
    tons_crushed: 52000,
    centroid: { type: 'Point', coordinates: [-75.5268, 43.2994] }
  }
];

const mockAVAs = {
  1: [ // California
    { id: 15, name: 'Napa Valley', tons_crushed: 150000, centroid: { type: 'Point', coordinates: [-122.2869, 38.5025] } },
    { id: 16, name: 'Sonoma County', tons_crushed: 200000, centroid: { type: 'Point', coordinates: [-122.9074, 38.5816] } },
    { id: 17, name: 'Paso Robles', tons_crushed: 75000, centroid: { type: 'Point', coordinates: [-120.6906, 35.6269] } },
    { id: 18, name: 'Santa Barbara County', tons_crushed: 45000, centroid: { type: 'Point', coordinates: [-120.0357, 34.5794] } }
  ],
  2: [ // Oregon
    { id: 19, name: 'Willamette Valley', tons_crushed: 65000, centroid: { type: 'Point', coordinates: [-123.0231, 44.9429] } },
    { id: 20, name: 'Southern Oregon', tons_crushed: 15000, centroid: { type: 'Point', coordinates: [-123.3307, 42.4403] } }
  ],
  3: [ // Washington
    { id: 21, name: 'Columbia Valley', tons_crushed: 180000, centroid: { type: 'Point', coordinates: [-119.2728, 46.2396] } },
    { id: 22, name: 'Walla Walla Valley', tons_crushed: 25000, centroid: { type: 'Point', coordinates: [-118.3302, 46.0645] } }
  ]
};

/**
 * GET /api/production/national
 * Returns production data for all wine-producing states
 */
router.get('/national', (req, res) => {
  const year = parseInt(req.query.year) || 2023;
  
  res.json({
    year,
    states: mockStates
  });
});

/**
 * GET /api/production/state/:stateId
 * Returns production data for AVAs within a state
 */
router.get('/state/:stateId', (req, res) => {
  const stateId = parseInt(req.params.stateId);
  const year = parseInt(req.query.year) || 2023;
  
  const state = mockStates.find(s => s.id === stateId);
  if (!state) {
    return res.status(404).json({ error: 'State not found' });
  }
  
  const avas = mockAVAs[stateId] || [];
  
  res.json({
    state: {
      id: state.id,
      name: state.name,
      abbreviation: state.abbreviation
    },
    year,
    avas
  });
});

export default router;
