#!/usr/bin/env node
/**
 * Rewrites topographyConfig.js with the full AVA registry and correct public R2 URL.
 * Run from data-pipeline/: node scripts/update-topo-config.js
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.resolve(__dirname, '../../client/src/components/maps/shared/topographyConfig.js');

const content = `/**
 * Topography Data Configuration
 * AVA availability registry, Titiler tile URLs, and legend configs
 * for slope, aspect, and elevation COG layers.
 *
 * COG source: data-pipeline/data/topography/{state}/{ava_folder}/
 * Served via Cloudflare R2 from /topography-data/
 */

import { TITILER_URL } from './climateConfig';

// R2 public URL for Cloudflare-hosted topography COGs
export const TOPO_COG_DOCKER_URL = 'https://pub-9686f7c1467c4989896000832d9500b0.r2.dev';

// ── Layer type definitions ─────────────────────────────────────────────
export const TOPO_LAYER_TYPES = {
  elevation: {
    id: 'elevation',
    label: 'Elevation',
    unit: 'm',
    colormap: 'terrain',
    description: 'Height above sea level',
    available: true,
    legend: {
      colors: ['#0B6623', '#90EE90', '#F5F5DC', '#D2B48C', '#8B4513', '#FFFFFF'],
      labels: ['0m', '200m', '500m', '1000m', '2000m', '3000m+']
    }
  },
  slope: {
    id: 'slope',
    label: 'Slope',
    unit: '°',
    colormap: 'rdylgn_r',
    description: 'Steepness of terrain',
    available: true,
    legend: {
      colors: ['#1A9850', '#91CF60', '#D9EF8B', '#FEE08B', '#FC8D59', '#D73027'],
      labels: ['0°', '5°', '10°', '20°', '35°', '45°+']
    }
  },
  aspect: {
    id: 'aspect',
    label: 'Aspect',
    unit: '°',
    colormap: 'hsv',
    description: 'Direction slope faces (0°=N, 90°=E, 180°=S, 270°=W)',
    available: true,
    legend: {
      colors: ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'],
      labels: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
    }
  }
};

// ── AVA name mapping ───────────────────────────────────────────────────
// Maps URL slug (from route params) → folder name in topography data
// Only AVAs with actual data files (aspect.tif, elevation.tif, slope.tif) are listed
export const AVA_TOPO_REGISTRY = {
  // ── Arkansas AVAs ──────────────────────────────────────────────────
  'altus':                      { state: 'AR', folder: 'altus' },

  // ── California AVAs ────────────────────────────────────────────────
  'adelaida-district':                          { state: 'CA', folder: 'adelaida_district' },
  'alexander-valley':                           { state: 'CA', folder: 'alexander_valley' },
  'alisos-canyon':                              { state: 'CA', folder: 'alisos_canyon' },
  'alta-mesa':                                  { state: 'CA', folder: 'alta_mesa' },
  'anderson-valley':                            { state: 'CA', folder: 'anderson_valley' },
  'antelope-valley-of-the-california-high-desert': { state: 'CA', folder: 'antelope_valley_of_the_california_high_desert' },
  'arroyo-grande-valley':                       { state: 'CA', folder: 'arroyo_grande_valley' },
  'arroyo-seco':                                { state: 'CA', folder: 'arroyo_seco' },
  'atlas-peak':                                 { state: 'CA', folder: 'atlas_peak' },
  'ballard-canyon':                             { state: 'CA', folder: 'ballard_canyon' },
  'ben-lomond-mountain':                        { state: 'CA', folder: 'ben_lomond_mountain' },
  'benmore-valley':                             { state: 'CA', folder: 'benmore_valley' },
  'bennett-valley':                             { state: 'CA', folder: 'bennett_valley' },
  'big-valley-district-lake-county':            { state: 'CA', folder: 'big_valley_district_lake_county' },
  'borden-ranch':                               { state: 'CA', folder: 'borden_ranch' },
  'california-shenandoah-valley':               { state: 'CA', folder: 'california_shenandoah_valley' },
  'calistoga':                                  { state: 'CA', folder: 'calistoga' },
  'capay-valley':                               { state: 'CA', folder: 'capay_valley' },
  'carmel-valley':                              { state: 'CA', folder: 'carmel_valley' },
  'chalone':                                    { state: 'CA', folder: 'chalone' },
  'chalk-hill':                                 { state: 'CA', folder: 'chalk_hill' },
  'chiles-valley':                              { state: 'CA', folder: 'chiles_valley' },
  'cienega-valley':                             { state: 'CA', folder: 'cienega_valley' },
  'clarksburg':                                 { state: 'CA', folder: 'clarksburg' },
  'clear-lake':                                 { state: 'CA', folder: 'clear_lake' },
  'clements-hills':                             { state: 'CA', folder: 'clements_hills' },
  'cole-ranch':                                 { state: 'CA', folder: 'cole_ranch' },
  'comptche':                                   { state: 'CA', folder: 'comptche' },
  'contra-costa':                               { state: 'CA', folder: 'contra_costa' },
  'coombsville':                                { state: 'CA', folder: 'coombsville' },
  'cosumnes-river':                             { state: 'CA', folder: 'cosumnes_river' },
  'covelo':                                     { state: 'CA', folder: 'covelo' },
  'creston-district':                           { state: 'CA', folder: 'creston_district' },
  'crystal-springs-of-napa-valley':             { state: 'CA', folder: 'crystal_springs_of_napa_valley' },
  'cucamonga-valley':                           { state: 'CA', folder: 'cucamonga_valley' },
  'diamond-mountain-district':                  { state: 'CA', folder: 'diamond_mountain_district' },
  'diablo-grande':                              { state: 'CA', folder: 'diablo_grande' },
  'dos-rios':                                   { state: 'CA', folder: 'dos_rios' },
  'dry-creek-valley':                           { state: 'CA', folder: 'dry_creek_valley' },
  'dunnigan-hills':                             { state: 'CA', folder: 'dunnigan_hills' },
  'eagle-peak-mendocino-county':                { state: 'CA', folder: 'eagle_peak_mendocino_county' },
  'edna-valley':                                { state: 'CA', folder: 'edna_valley' },
  'el-dorado':                                  { state: 'CA', folder: 'el_dorado' },
  'el-pomar-district':                          { state: 'CA', folder: 'el_pomar_district' },
  'fair-play':                                  { state: 'CA', folder: 'fair_play' },
  'fiddletown':                                 { state: 'CA', folder: 'fiddletown' },
  'fort-ross-seaview':                          { state: 'CA', folder: 'fort_ross_seaview' },
  'fountaingrove-district':                     { state: 'CA', folder: 'fountaingrove_district' },
  'gabilan-mountains':                          { state: 'CA', folder: 'gabilan_mountains' },
  'green-valley-of-russian-river-valley':       { state: 'CA', folder: 'green_valley_of_russian_river_valley' },
  'guenoc-valley':                              { state: 'CA', folder: 'guenoc_valley' },
  'hames-valley':                               { state: 'CA', folder: 'hames_valley' },
  'happy-canyon-of-santa-barbara':              { state: 'CA', folder: 'happy_canyon_of_santa_barbara' },
  'high-valley':                                { state: 'CA', folder: 'high_valley' },
  'high-valley-080105':                         { state: 'CA', folder: 'high_valley_080105' },
  'howell-mountain':                            { state: 'CA', folder: 'howell_mountain' },
  'inwood-valley':                              { state: 'CA', folder: 'inwood_valley' },
  'jahant':                                     { state: 'CA', folder: 'jahant' },
  'kelsey-bench-lake-county':                   { state: 'CA', folder: 'kelsey_bench_lake_county' },
  'knights-valley':                             { state: 'CA', folder: 'knights_valley' },
  'lamorinda':                                  { state: 'CA', folder: 'lamorinda' },
  'leona-valley':                               { state: 'CA', folder: 'leona_valley' },
  'lime-kiln-valley':                           { state: 'CA', folder: 'lime_kiln_valley' },
  'livermore-valley':                           { state: 'CA', folder: 'livermore_valley' },
  'long-valley-lake-county':                    { state: 'CA', folder: 'long_valley_lake_county' },
  'los-carneros':                               { state: 'CA', folder: 'los_carneros' },
  'los-olivos-district':                        { state: 'CA', folder: 'los_olivos_district' },
  'madera':                                     { state: 'CA', folder: 'madera' },
  'madera-19850107-a':                          { state: 'CA', folder: 'madera_19850107_a' },
  'madera-19850107-b':                          { state: 'CA', folder: 'madera_19850107_b' },
  'malibu-coast':                               { state: 'CA', folder: 'malibu_coast' },
  'malibu-newton-canyon':                       { state: 'CA', folder: 'malibu_newton_canyon' },
  'manton-valley':                              { state: 'CA', folder: 'manton_valley' },
  'mcdowell-valley':                            { state: 'CA', folder: 'mcdowell_valley' },
  'mendocino':                                  { state: 'CA', folder: 'mendocino' },
  'mendocino-ridge':                            { state: 'CA', folder: 'mendocino_ridge' },
  'merritt-island':                             { state: 'CA', folder: 'merritt_island' },
  'mokelumne-river':                            { state: 'CA', folder: 'mokelumne_river' },
  'moon-mountain-district-sonoma-county':       { state: 'CA', folder: 'moon_mountain_district_sonoma_county' },
  'mt--harlan':                                 { state: 'CA', folder: 'mt__harlan' },
  'mt--veeder':                                 { state: 'CA', folder: 'mt__veeder' },
  'napa-valley':                                { state: 'CA', folder: 'napa_valley' },
  'north-yuba':                                 { state: 'CA', folder: 'north_yuba' },
  'northern-sonoma':                            { state: 'CA', folder: 'northern_sonoma' },
  'oak-knoll-district-of-napa-valley':          { state: 'CA', folder: 'oak_knoll_district_of_napa_valley' },
  'oakville':                                   { state: 'CA', folder: 'oakville' },
  'pacheco-pass':                               { state: 'CA', folder: 'pacheco_pass' },
  'paicines':                                   { state: 'CA', folder: 'paicines' },
  'palos-verdes-peninsula':                     { state: 'CA', folder: 'palos_verdes_peninsula' },
  'paso-robles-estrella-district':              { state: 'CA', folder: 'paso_robles_estrella_district' },
  'paso-robles-geneseo-district':               { state: 'CA', folder: 'paso_robles_geneseo_district' },
  'paso-robles-highlands-district':             { state: 'CA', folder: 'paso_robles_highlands_district' },
  'paso-robles-willow-creek-district':          { state: 'CA', folder: 'paso_robles_willow_creek_district' },
  'paulsell-valley':                            { state: 'CA', folder: 'paulsell_valley' },
  'petaluma-gap':                               { state: 'CA', folder: 'petaluma_gap' },
  'pine-mountain-cloverdale-peak':              { state: 'CA', folder: 'pine_mountain_cloverdale_peak' },
  'potter-valley':                              { state: 'CA', folder: 'potter_valley' },
  'ramona-valley':                              { state: 'CA', folder: 'ramona_valley' },
  'red-hills-lake-county':                      { state: 'CA', folder: 'red_hills_lake_county' },
  'redwood-valley':                             { state: 'CA', folder: 'redwood_valley' },
  'river-junction':                             { state: 'CA', folder: 'river_junction' },
  'rockpile':                                   { state: 'CA', folder: 'rockpile' },
  'russian-river-valley':                       { state: 'CA', folder: 'russian_river_valley' },
  'saddle-rock-malibu':                         { state: 'CA', folder: 'saddle_rock_malibu' },
  'salado-creek':                               { state: 'CA', folder: 'salado_creek' },
  'san-antonio-valley':                         { state: 'CA', folder: 'san_antonio_valley' },
  'san-benito':                                 { state: 'CA', folder: 'san_benito' },
  'san-juan-creek':                             { state: 'CA', folder: 'san_juan_creek' },
  'san-lucas':                                  { state: 'CA', folder: 'san_lucas' },
  'san-luis-rey':                               { state: 'CA', folder: 'san_luis_rey' },
  'san-miguel-district':                        { state: 'CA', folder: 'san_miguel_district' },
  'san-pasqual-valley':                         { state: 'CA', folder: 'san_pasqual_valley' },
  'san-ysidro-district':                        { state: 'CA', folder: 'san_ysidro_district' },
  'santa-clara-valley':                         { state: 'CA', folder: 'santa_clara_valley' },
  'santa-lucia-highlands':                      { state: 'CA', folder: 'santa_lucia_highlands' },
  'santa-maria-valley':                         { state: 'CA', folder: 'santa_maria_valley' },
  'santa-margarita-ranch':                      { state: 'CA', folder: 'santa_margarita_ranch' },
  'santa-ynez-valley':                          { state: 'CA', folder: 'santa_ynez_valley' },
  'seiad-valley':                               { state: 'CA', folder: 'seiad_valley' },
  'sierra-pelona-valley':                       { state: 'CA', folder: 'sierra_pelona_valley' },
  'sloughhouse':                                { state: 'CA', folder: 'sloughhouse' },
  'solano-county-green-valley':                 { state: 'CA', folder: 'solano_county_green_valley' },
  'sonoma-coast':                               { state: 'CA', folder: 'sonoma_coast' },
  'sonoma-mountain':                            { state: 'CA', folder: 'sonoma_mountain' },
  'sonoma-valley':                              { state: 'CA', folder: 'sonoma_valley' },
  'spring-mountain-district':                   { state: 'CA', folder: 'spring_mountain_district' },
  'squaw-valley-miramonte':                     { state: 'CA', folder: 'squaw_valley_miramonte' },
  'st--helena':                                 { state: 'CA', folder: 'st__helena' },
  'sta--rita-hills':                            { state: 'CA', folder: 'sta__rita_hills' },
  'stags-leap-district':                        { state: 'CA', folder: 'stags_leap_district' },
  'suisun-valley':                              { state: 'CA', folder: 'suisun_valley' },
  'tehachapi-mountains':                        { state: 'CA', folder: 'tehachapi_mountains' },
  'temecula-valley':                            { state: 'CA', folder: 'temecula_valley' },
  'templeton-gap-district':                     { state: 'CA', folder: 'templeton_gap_district' },
  'tracy-hills':                                { state: 'CA', folder: 'tracy_hills' },
  'trinity-lakes':                              { state: 'CA', folder: 'trinity_lakes' },
  'upper-lake-valley':                          { state: 'CA', folder: 'upper_lake_valley' },
  'west-sonoma-coast':                          { state: 'CA', folder: 'west_sonoma_coast' },
  'wild-horse-valley':                          { state: 'CA', folder: 'wild_horse_valley' },
  'willow-creek':                               { state: 'CA', folder: 'willow_creek' },
  'winters-highlands':                          { state: 'CA', folder: 'winters_highlands' },
  'york-mountain':                              { state: 'CA', folder: 'york_mountain' },
  'yorkville-highlands':                        { state: 'CA', folder: 'yorkville_highlands' },
  'yountville':                                 { state: 'CA', folder: 'yountville' },
  'yucaipa-valley':                             { state: 'CA', folder: 'yucaipa_valley' },

  // ── Idaho AVAs ─────────────────────────────────────────────────────
  // 'snake-river-valley': missing local .tif files — omitted until generated

  // ── New York AVAs ──────────────────────────────────────────────────
  'cayuga-lake':                    { state: 'NY', folder: 'cayuga_lake' },
  'niagara-escarpment':             { state: 'NY', folder: 'niagara_escarpment' },
  'north-fork-of-long-island':      { state: 'NY', folder: 'north_fork_of_long_island' },
  'the-hamptons-long-island':       { state: 'NY', folder: 'the_hamptons_long_island' },

  // ── Oregon AVAs ────────────────────────────────────────────────────
  'applegate-valley':               { state: 'OR', folder: 'applegate_valley' },
  'chehalem-mountains':             { state: 'OR', folder: 'chehalem_mountains' },
  'columbia-gorge':                 { state: 'OR', folder: 'columbia_gorge' },
  'dundee-hills':                   { state: 'OR', folder: 'dundee_hills' },
  'elkton-oregon':                  { state: 'OR', folder: 'elkton_oregon' },
  'eola-amity-hills':               { state: 'OR', folder: 'eola_amity_hills' },
  'laurelwood-district':            { state: 'OR', folder: 'laurelwood_district' },
  'lower-long-tom':                 { state: 'OR', folder: 'lower_long_tom' },
  'mcminnville':                    { state: 'OR', folder: 'mcminnville' },
  'mount-pisgah--polk-county--oregon': { state: 'OR', folder: 'mount_pisgah__polk_county__oregon' },
  'red-hill-douglas-county--oregon':   { state: 'OR', folder: 'red_hill_douglas_county__oregon' },
  'ribbon-ridge':                   { state: 'OR', folder: 'ribbon_ridge' },
  'the-rocks-district-of-milton-freewater': { state: 'OR', folder: 'the_rocks_district_of_milton_freewater' },
  'tualatin-hills':                 { state: 'OR', folder: 'tualatin_hills' },
  'van-duzer-corridor':             { state: 'OR', folder: 'van_duzer_corridor' },
  'walla-walla-valley':             { state: 'OR', folder: 'walla_walla_valley' },
  'yamhill-carlton':                { state: 'OR', folder: 'yamhill_carlton' },
};

/**
 * Check if an AVA has topography data available
 * @param {string} avaSlug - URL slug for the AVA (e.g. "dundee-hills")
 * @returns {boolean}
 */
export const hasTopographyData = (avaSlug) => {
  return avaSlug in AVA_TOPO_REGISTRY;
};

/**
 * Get the COG file URL for a given AVA and layer type
 * @param {string} avaSlug - URL slug (e.g. "dundee-hills")
 * @param {string} layerType - 'elevation' | 'slope' | 'aspect'
 * @returns {string|null} URL to the COG file, or null if not available
 */
export const getTopoCogUrl = (avaSlug, layerType) => {
  const entry = AVA_TOPO_REGISTRY[avaSlug];
  if (!entry) return null;
  return \`\${TOPO_COG_DOCKER_URL}/topography-data/\${entry.state}/\${entry.folder}/\${layerType}.tif\`;
};

/**
 * Get Titiler tile URL template for a topography layer
 * @param {string}      avaSlug   - URL slug
 * @param {string}      layerType - 'elevation' | 'slope' | 'aspect'
 * @param {string|null} rescale   - Optional "min,max" rescale string for dynamic range
 * @returns {string|null} Tile URL with {z}/{x}/{y} placeholders
 */
export const getTopoTileUrl = (avaSlug, layerType, rescale = null) => {
  const cogUrl = getTopoCogUrl(avaSlug, layerType);
  if (!cogUrl) return null;

  const config = TOPO_LAYER_TYPES[layerType];
  const encodedCogUrl = encodeURIComponent(cogUrl);

  const rescaleParam = rescale ? \`&rescale=\${rescale}\` : '';
  return \`\${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=\${encodedCogUrl}\${rescaleParam}&colormap_name=\${config.colormap}\`;
};

/**
 * Get Titiler statistics URL for a topography COG
 * Used to fetch min/max for dynamic scale bar
 * @param {string} avaSlug   - URL slug
 * @param {string} layerType - 'elevation' | 'slope' | 'aspect'
 * @returns {string|null}
 */
export const getTopoStatsUrl = (avaSlug, layerType) => {
  const cogUrl = getTopoCogUrl(avaSlug, layerType);
  if (!cogUrl) return null;
  const encodedCogUrl = encodeURIComponent(cogUrl);
  // Use percentile_2/98 over the full raster (no bbox) for true AVA-wide range
  return \`\${TITILER_URL}/cog/statistics?url=\${encodedCogUrl}&max_size=512&resampling=bilinear\`;
};

/**
 * Get Titiler info/metadata URL for a topography COG
 */
export const getTopoInfoUrl = (avaSlug, layerType) => {
  const cogUrl = getTopoCogUrl(avaSlug, layerType);
  if (!cogUrl) return null;
  const encodedCogUrl = encodeURIComponent(cogUrl);
  return \`\${TITILER_URL}/cog/info?url=\${encodedCogUrl}\`;
};

// MapLibre source/layer ID helpers
export const getTopoSourceId = (layerType) => \`topo-\${layerType}\`;
export const getTopoLayerId  = (layerType) => \`topo-\${layerType}-layer\`;

// Default opacity
export const TOPO_LAYER_OPACITY = 0.65;
`;

fs.writeFileSync(TARGET, content, 'utf8');

const written = fs.readFileSync(TARGET, 'utf8');
const caCount = (written.match(/state: 'CA'/g) || []).length;
const orCount = (written.match(/state: 'OR'/g) || []).length;
const nyCount = (written.match(/state: 'NY'/g) || []).length;
const arCount = (written.match(/state: 'AR'/g) || []).length;
const hasUrl  = written.includes('pub-9686f7c1467c4989896000832d9500b0');

console.log(`✅ Written to: ${TARGET}`);
console.log(`   CA entries : ${caCount}`);
console.log(`   OR entries : ${orCount}`);
console.log(`   NY entries : ${nyCount}`);
console.log(`   AR entries : ${arCount}`);
console.log(`   Correct URL: ${hasUrl}`);
