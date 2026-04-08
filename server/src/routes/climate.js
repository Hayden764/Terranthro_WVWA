import express from 'express';
import { pool } from '../db/pool.js';

const router = express.Router();

/**
 * GET /api/climate/:slug/stats?year=2025
 * Returns growing-season aggregate stats for an AVA.
 * Data lives in ava_climate_stats (month IS NULL = full season).
 */
router.get('/:slug/stats', async (req, res) => {
  const { slug } = req.params;
  const year = parseInt(req.query.year) || 2025;

  try {
    const { rows } = await pool.query(
      `SELECT cs.variable, cs.mean, cs.min, cs.max, cs.std_dev,
              cs.p10, cs.p90, cs.unit, cs.data_source, cs.computed_at
       FROM ava_climate_stats cs
       JOIN avas a ON a.id = cs.ava_id
       WHERE a.slug = $1
         AND cs.year  = $2
         AND cs.month IS NULL
       ORDER BY cs.variable`,
      [slug, year]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'No climate stats found',
        slug,
        year,
      });
    }

    // Reshape into { variable: stats } map for easy frontend consumption
    const stats = {};
    for (const row of rows) {
      stats[row.variable] = {
        mean:        parseFloat(row.mean),
        min:         parseFloat(row.min),
        max:         parseFloat(row.max),
        std_dev:     parseFloat(row.std_dev),
        p10:         parseFloat(row.p10),
        p90:         parseFloat(row.p90),
        unit:        row.unit,
        data_source: row.data_source,
        computed_at: row.computed_at,
      };
    }

    res.json({ slug, year, stats });
  } catch (err) {
    console.error('Climate stats query failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Legacy mock time-series (keep for now, can remove later) ──────────────────
const generateMockTimeSeries = (variable, startDate, endDate) => {
  const data = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    const month = d.getMonth();
    let value;
    switch (variable) {
      case 'temperature':
        value = 60 + 15 * Math.sin((month - 3) * Math.PI / 6) + (Math.random() - 0.5) * 5;
        break;
      case 'precipitation':
        value = 2 + 3 * Math.cos((month - 6) * Math.PI / 6) + Math.random() * 2;
        break;
      case 'gdd':
        value = Math.max(0, (60 + 15 * Math.sin((month - 3) * Math.PI / 6) - 50) * 30);
        break;
      default:
        value = Math.random() * 100;
    }
    data.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      value: Math.round(value * 10) / 10,
      min: Math.round((value - 5 - Math.random() * 3) * 10) / 10,
      max: Math.round((value + 5 + Math.random() * 3) * 10) / 10
    });
  }
  return data;
};

router.get('/:avaId/timeseries', (req, res) => {
  const avaId = parseInt(req.params.avaId);
  const variable = req.query.variable || 'temperature';
  const start = req.query.start || '2020-01';
  const end = req.query.end || '2023-12';
  const units = { temperature: '°F', precipitation: 'inches', gdd: '°F days' };
  const data = generateMockTimeSeries(variable, start, end);
  res.json({ ava_id: avaId, variable, unit: units[variable] || 'units', data });
});

export default router;
