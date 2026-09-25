/**
 * Glossary for the explorer's "Wine Terms" section. Each term explains a word
 * the site shows somewhere (vineyard cards, climate charts, map layers), in
 * plain language for someone new to wine. `id` is stable so other parts of the
 * app can point at a term later.
 */

export const TERM_GROUPS = [
  {
    id: 'place',
    label: 'Place & vineyards',
    terms: [
      {
        id: 'terroir',
        term: 'Terroir',
        short: 'Everything about a place that shapes how its wine tastes.',
        body: 'Terroir (tair-WAHR) is the combination of soil, bedrock, slope, sun exposure and climate at a vineyard. Two vineyards a mile apart can grow the same grape and make noticeably different wine because their terroir differs. The Terroir Snapshot on each vineyard card summarizes the parts of it we can measure.',
      },
      {
        id: 'ava',
        term: 'AVA',
        short: 'American Viticultural Area — an officially recognized wine-growing region.',
        body: 'An AVA is a grape-growing region defined by the federal Tax & Trade Bureau for its distinct geography and climate. A wine labeled with an AVA must be made mostly from grapes grown inside it. AVAs can sit inside larger ones: the eleven nested AVAs on this map all sit within the Willamette Valley AVA.',
      },
      {
        id: 'estate-vineyard',
        term: 'Estate vineyard',
        short: 'A vineyard owned or controlled by the winery that makes the wine.',
        body: 'Wineries either grow their own grapes on estate vineyards or buy fruit from independent growers. The "Estate Vineyards" list on a winery page shows the vineyards we have mapped as belonging to that winery.',
      },
      {
        id: 'block',
        term: 'Block',
        short: 'A section of a vineyard farmed as one unit.',
        body: 'Vineyards are divided into blocks, usually planted with one grape variety and clone and picked together. Blocks on the same property can sit at different elevations or on different soils, which is why winemakers often keep them separate.',
      },
      {
        id: 'variety-clone',
        term: 'Variety & clone',
        short: 'The grape type (Pinot noir) and the specific vine lineage within it.',
        body: 'A variety is the kind of grape, such as Pinot noir or Chardonnay. A clone is a line of vines propagated from one parent plant, chosen for traits like cluster size or ripening time. Willamette growers often plant several Pinot noir clones (for example Pommard, Wädenswil or Dijon 777) to add complexity.',
      },
    ],
  },
  {
    id: 'terrain',
    label: 'Terrain',
    terms: [
      {
        id: 'elevation',
        term: 'Elevation',
        short: 'Height above sea level, shown in feet.',
        body: 'Higher vineyards are generally cooler, which slows ripening and helps grapes keep acidity. Sites on hillsides also sit above the cold air that pools on valley floors on spring nights, lowering frost risk.',
      },
      {
        id: 'slope',
        term: 'Slope',
        short: 'How steep the ground is, in degrees.',
        body: 'Sloped ground drains water and cold air away from the vines and can catch more direct sun. Very steep slopes are harder and costlier to farm and more prone to erosion.',
      },
      {
        id: 'aspect',
        term: 'Aspect',
        short: 'The compass direction a slope faces.',
        body: 'In the Northern Hemisphere, south- and southwest-facing slopes get the most afternoon sun and ripen grapes earliest; north-facing slopes stay cooler. In a cool region like the Willamette Valley, a warm aspect can make the difference in a cold year.',
      },
    ],
  },
  {
    id: 'ground',
    label: 'Soils & geology',
    terms: [
      {
        id: 'soil',
        term: 'Soil',
        short: 'The loose top layer the vine roots grow in.',
        body: 'Soil controls how much water and nutrients a vine can reach. Well-drained, moderately poor soils tend to make vines put their energy into fewer, more concentrated grapes. Our soil data comes from the USDA soil survey (SSURGO), which maps named soil types called soil series.',
      },
      {
        id: 'soil-series',
        term: 'Soil series',
        short: 'A named soil type, such as Jory or Willakenzie.',
        body: 'Soil scientists group soils with the same layers and origin into series named after the place they were first described. Growers talk about wines from "Jory" or "Willakenzie" the way others talk about regions, because each series behaves differently in the vineyard.',
      },
      {
        id: 'volcanic-soils',
        term: 'Volcanic soils',
        short: 'Red, iron-rich soils weathered from ancient basalt lava.',
        body: 'Much of the Dundee Hills and Eola-Amity Hills sits on basalt lava flows that are about 15 million years old. They weathered into deep red clay-loam soils like Jory, which hold water well through the dry summer.',
      },
      {
        id: 'marine-sedimentary-soils',
        term: 'Marine sedimentary soils',
        short: 'Soils formed from old sea-floor sandstone and siltstone.',
        body: 'Before the Coast Range rose, much of western Oregon was ocean floor. Soils weathered from those uplifted sediments, like Willakenzie, are common in Yamhill-Carlton and Ribbon Ridge. They drain quickly and tend to produce smaller crops.',
      },
      {
        id: 'loess',
        term: 'Loess',
        short: 'Wind-blown silt laid down over older soils.',
        body: 'During the Ice Age, wind carried fine silt into the valley and dropped it on the hills. Laurelwood soils, found on Chehalem Mountain and in Laurelwood District, are loess over basalt.',
      },
      {
        id: 'bedrock',
        term: 'Bedrock',
        short: 'The solid rock beneath the soil.',
        body: 'Bedrock is the parent material most soils weather from, and deep roots can reach into its cracks. The Bedrock map layer comes from the Oregon geologic map (OGDC-8), and a vineyard card names both the soil and the rock under it.',
      },
    ],
  },
  {
    id: 'climate',
    label: 'Climate & vintages',
    terms: [
      {
        id: 'vintage',
        term: 'Vintage',
        short: 'The year the grapes were grown and picked.',
        body: 'Weather changes from year to year, so wines from the same vineyard differ by vintage. A warm vintage gives riper, fuller wines; a cool one gives lighter, more acidic wines. The colored stripes on a vineyard card show every vintage since 1991 — click one to see that year.',
      },
      {
        id: 'growing-season',
        term: 'Growing season',
        short: 'April through October, when the vine is growing and ripening fruit.',
        body: 'The vine wakes up (bud break) in spring, flowers in early summer and ripens its grapes through late summer; harvest in the Willamette Valley usually runs from September into October. Heat totals on this site are counted over April–October.',
      },
      {
        id: 'gdd',
        term: 'GDD (growing degree days)',
        short: 'A running total of how much useful warmth a season had.',
        body: 'Vines barely grow below about 50°F. Each day, the number of degrees the average temperature was above 50°F is added to the total; a 65°F day adds 15. More GDD means a warmer season and riper grapes. We estimate GDD from monthly PRISM averages.',
      },
      {
        id: 'winkler-region',
        term: 'Winkler region',
        short: 'A heat class for wine regions, based on GDD.',
        body: 'The Winkler scale sorts places from Region I (coolest) to Region V (hottest) by growing-season GDD. Most Willamette Valley vineyards fall in Region I, the class suited to Pinot noir, Chardonnay and other cool-climate grapes. Warm years can push a site into Region II.',
      },
      {
        id: 'precipitation',
        term: 'Precipitation',
        short: 'Rain (and snow), measured in inches.',
        body: 'The Willamette Valley gets most of its rain between November and April and very little in summer. Winter rain refills the soil, which is what lets many vineyards here grow without irrigation (dry farming) through the dry months. Rain at harvest is the worry: it can swell and split ripe grapes and invite rot, so a wet September or October shapes a vintage as much as heat does.',
      },
      {
        id: 'climate-normal',
        term: 'Climate normal',
        short: 'The 30-year average used as a baseline, e.g. 1991–2020.',
        body: 'To say whether a year was warm or cool you need something to compare it with. A climate normal is the average over 30 years. The vintage charts compare each year with the 1991–2020 normal, or with the last ten years to see how recent vintages stack up.',
      },
      {
        id: 'anomaly',
        term: 'Anomaly',
        short: 'How far a year was above or below the normal.',
        body: 'An anomaly of +200 GDD means that season had 200 more growing degree days than the 30-year normal. On the vintage stripes, red means warmer than normal and blue means cooler.',
      },
      {
        id: 'provisional',
        term: 'Provisional',
        short: 'Recent data that may still be revised.',
        body: 'The newest months of climate data are early estimates that PRISM revises as more weather-station readings arrive. Provisional vintages are shown faded until the numbers are final.',
      },
      {
        id: 'prism',
        term: 'PRISM',
        short: 'The climate dataset behind our temperature and rain numbers.',
        body: 'PRISM, from Oregon State University, turns weather-station records into maps of temperature and precipitation at about 800 m resolution, accounting for how elevation and terrain change the climate. It is a standard source for U.S. climate research.',
      },
    ],
  },
];

export const TERMS_BY_ID = Object.fromEntries(
  TERM_GROUPS.flatMap(g => g.terms).map(t => [t.id, t]),
);

// Terms behind each vineyard-card section's "What's this?" link
export const TERROIR_TERM_IDS = ['terroir', 'elevation', 'aspect', 'slope', 'soil-series', 'bedrock'];
export const VINTAGE_TERM_IDS = ['vintage', 'gdd', 'winkler-region', 'precipitation', 'anomaly', 'climate-normal'];
export const AVA_TERM_IDS = ['ava', 'terroir'];
export const CLIMATE_LAYER_TERM_IDS = ['gdd', 'winkler-region', 'precipitation', 'growing-season', 'climate-normal', 'anomaly', 'prism'];
export const TOPO_LAYER_TERM_IDS = ['elevation', 'slope', 'aspect'];
export const EARTH_LAYER_TERM_IDS = ['soil', 'soil-series', 'volcanic-soils', 'marine-sedimentary-soils', 'loess', 'bedrock'];
