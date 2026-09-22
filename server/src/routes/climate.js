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

// ── Vintage climate from PRISM monthly (climate_monthly, migration 024) ───────
//
// Everything below is derived from the monthly rows so that a vintage and the
// baselines it is compared with always come from the same dataset.

const BASELINES = {
  normal: { label: '1991–2020 normal', from: 1991, to: 2020 },
  recent: { label: '2016–2025 average', from: 2016, to: 2025 },
};
// Months per season; negative months belong to the previous calendar year
// (the dormant winter leading into the vintage).
const SEASONS = {
  growing: { label: 'Growing season (Apr–Oct)', months: [4, 5, 6, 7, 8, 9, 10] },
  dormant: { label: 'Dormant (Nov–Feb)',        months: [-11, -12, 1, 2] },
  spring:  { label: 'Spring (Mar–May)',         months: [3, 4, 5] },
  summer:  { label: 'Summer (Jun–Aug)',         months: [6, 7, 8] },
  harvest: { label: 'Harvest (Sep–Oct)',        months: [9, 10] },
};
const GDD_MONTHS = [4, 5, 6, 7, 8, 9, 10];

const cToF = (c) => (c == null ? null : c * 9 / 5 + 32);
const mmToIn = (mm) => (mm == null ? null : mm / 25.4);
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const round = (v, d = 1) => (v == null || Number.isNaN(v) ? null : Number(v.toFixed(d)));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Winkler region classes as extended by Jones et al. (2010), °F growing degree days
function winklerRegion(gdd) {
  if (gdd == null) return null;
  if (gdd < 1500) return 'Too cool';
  if (gdd <= 2000) return 'Region Ia';
  if (gdd <= 2500) return 'Region Ib';
  if (gdd <= 3000) return 'Region II';
  if (gdd <= 3500) return 'Region III';
  if (gdd <= 4000) return 'Region IV';
  if (gdd <= 4900) return 'Region V';
  return 'Too hot';
}

function buildVintages(rows) {
  // byYear[year][month] = { tmean, tmin, tmax, ppt } in °F / inches
  const byYear = {};
  for (const r of rows) {
    (byYear[r.year] ??= {})[r.month] = {
      tmean: cToF(r.tmean_c), tmin: cToF(r.tmin_c), tmax: cToF(r.tmax_c), ppt: mmToIn(r.ppt_mm),
    };
  }
  const get = (y, m) => (m < 0 ? byYear[y - 1]?.[-m] : byYear[y]?.[m]);

  const seasonStats = (y, months) => {
    const cells = months.map((m) => ({ v: get(y, m), days: daysIn(m < 0 ? y - 1 : y, Math.abs(m)) }));
    if (cells.some((c) => !c.v || c.v.tmean == null || c.v.ppt == null)) return null;
    const totalDays = cells.reduce((a, c) => a + c.days, 0);
    const wavg = (k) => cells.reduce((a, c) => a + c.v[k] * c.days, 0) / totalDays;
    return { tmean: wavg('tmean'), tmax: wavg('tmax'), tmin: wavg('tmin'), ppt: cells.reduce((a, c) => a + c.v.ppt, 0) };
  };
  const gdd = (y) => {
    let total = 0;
    for (const m of GDD_MONTHS) {
      const v = byYear[y]?.[m];
      if (v?.tmean == null) return null;
      total += Math.max(0, v.tmean - 50) * daysIn(y, m);
    }
    return total;
  };

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const perYear = {};
  for (const y of years) {
    perYear[y] = {
      gdd: gdd(y),
      seasons: Object.fromEntries(Object.entries(SEASONS).map(([k, s]) => [k, seasonStats(y, s.months)])),
    };
  }

  const baselines = {};
  for (const [key, b] of Object.entries(BASELINES)) {
    const ys = years.filter((y) => y >= b.from && y <= b.to);
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const vals = ys.map((y) => byYear[y]?.[i + 1]).filter(Boolean);
      return {
        month: i + 1,
        tmean: round(mean(vals.map((v) => v.tmean).filter((x) => x != null))),
        tmax:  round(mean(vals.map((v) => v.tmax).filter((x) => x != null))),
        tmin:  round(mean(vals.map((v) => v.tmin).filter((x) => x != null))),
        ppt:   round(mean(vals.map((v) => v.ppt).filter((x) => x != null)), 2),
      };
    });
    const seasons = {};
    for (const s of Object.keys(SEASONS)) {
      const vals = ys.map((y) => perYear[y].seasons[s]).filter(Boolean);
      seasons[s] = vals.length ? {
        tmean: round(mean(vals.map((v) => v.tmean))), tmax: round(mean(vals.map((v) => v.tmax))),
        tmin: round(mean(vals.map((v) => v.tmin))), ppt: round(mean(vals.map((v) => v.ppt)), 2),
      } : null;
    }
    const gdds = ys.map((y) => perYear[y].gdd).filter((x) => x != null);
    baselines[key] = {
      label: b.label, from: b.from, to: b.to, years_available: ys.length,
      monthly, seasons, gdd: round(mean(gdds), 0),
    };
  }

  const ranked = years.filter((y) => perYear[y].gdd != null).sort((a, b) => perYear[b].gdd - perYear[a].gdd);
  const now = new Date();
  const vintages = years.map((y) => {
    const p = perYear[y];
    const anomaly = {};
    for (const [bk, b] of Object.entries(baselines)) {
      anomaly[bk] = {
        gdd: p.gdd != null && b.gdd != null ? round(p.gdd - b.gdd, 0) : null,
        seasons: Object.fromEntries(Object.keys(SEASONS).map((s) => {
          const v = p.seasons[s]; const n = b.seasons[s];
          return [s, v && n ? {
            tmean: round(v.tmean - n.tmean),
            ppt_pct: n.ppt ? round(((v.ppt - n.ppt) / n.ppt) * 100, 0) : null,
          } : null];
        })),
      };
    }
    // PRISM data younger than ~6 months is provisional
    const lastMonth = Math.max(...Object.keys(byYear[y]).map(Number));
    const ageMonths = (now.getFullYear() - y) * 12 + (now.getMonth() + 1) - lastMonth;
    return {
      year: y,
      provisional: ageMonths <= 6,
      monthly: Array.from({ length: 12 }, (_, i) => {
        const v = byYear[y][i + 1];
        return v ? { month: i + 1, tmean: round(v.tmean), tmax: round(v.tmax), tmin: round(v.tmin), ppt: round(v.ppt, 2) }
                 : { month: i + 1, tmean: null, tmax: null, tmin: null, ppt: null };
      }),
      seasons: Object.fromEntries(Object.entries(p.seasons).map(([k, v]) => [k, v && {
        tmean: round(v.tmean), tmax: round(v.tmax), tmin: round(v.tmin), ppt: round(v.ppt, 2),
      }])),
      gdd: round(p.gdd, 0),
      winkler_region: winklerRegion(p.gdd),
      gdd_rank: p.gdd != null ? ranked.indexOf(y) + 1 : null,
      anomaly,
    };
  });

  return {
    units: { temp: '°F', precip: 'in', gdd: '°F·days (base 50°F)' },
    method: 'PRISM 800m monthly; GDD approximated from monthly mean temperature × days (Apr–Oct)',
    seasons: Object.fromEntries(Object.entries(SEASONS).map(([k, s]) => [k, s.label])),
    ranked_count: ranked.length,
    baselines,
    vintages,
  };
}

/**
 * GET /api/climate/:type/:key/vintages
 *   type = 'ava' (key = slug, e.g. dundee-hills, willamette-valley) | 'vineyard' (key = vineyards.id)
 * Monthly series per vintage (°F / in), season summaries, GDD + Winkler region +
 * warmth rank, and anomalies against the 1991–2020 normal and 2016–2025 average.
 */
router.get('/:type/:key/vintages', async (req, res) => {
  const { type, key } = req.params;
  if (!['ava', 'vineyard'].includes(type)) return res.status(400).json({ error: 'type must be ava or vineyard' });
  if (type === 'vineyard' && !/^\d+$/.test(key)) return res.status(400).json({ error: 'Invalid vineyard id' });
  if (type === 'ava' && !/^[a-z0-9-]+$/.test(key)) return res.status(400).json({ error: 'Invalid AVA slug' });

  try {
    const { rows } = await pool.query(
      `SELECT year, month, tmean_c, tmin_c, tmax_c, ppt_mm
       FROM climate_monthly WHERE entity_type = $1 AND entity_key = $2
       ORDER BY year, month`,
      [type, key]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No climate data', type, key });
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ type, key, ...buildVintages(rows) });
  } catch (err) {
    console.error('GET /api/climate/:type/:key/vintages error:', err);
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
