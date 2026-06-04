const VALID_CATEGORIES = new Set(['winery', 'hotel', 'restaurant', 'tasting', 'other']);

// Curated non-winery records from the WVWA listing feed. These are the entries
// that should not appear in winery-only surfaces even if the source feed or DB
// currently defaults them to "winery".
const CATEGORY_OVERRIDES = new Map([
  [67, 'hotel'],
  [174, 'restaurant'],
  [226, 'hotel'],
  [278, 'restaurant'],
  [379, 'hotel'],
  [387, 'hotel'],
  [390, 'hotel'],
  [403, 'hotel'],
  [407, 'other'],
  [450, 'restaurant'],
  [456, 'restaurant'],
  [470, 'tasting'],
  [558, 'tasting'],
  [902, 'hotel'],
  [1368, 'hotel'],
  [2080, 'hotel'],
  [2135, 'restaurant'],
  [2328, 'restaurant'],
  [2441, 'hotel'],
  [2559, 'hotel'],
  [2620, 'restaurant'],
  [2820, 'hotel'],
  [3141, 'hotel'],
  [4545, 'restaurant'],
  [4853, 'restaurant'],
  [5006, 'other'],
  [5380, 'hotel'],
  [5529, 'tasting'],
  [5753, 'hotel'],
  [5807, 'hotel'],
  [5900, 'restaurant'],
  [6102, 'other'],
  [6104, 'hotel'],
]);

const STRONG_WINERY_RE = /\b(winery|vineyard|vineyards|cellar|cellars|pinot|chardonnay|sparkling|winegrow(?:er|ing)|winemaker|viticulture|estate(?:\s+wine|\s+grown)?|tasting\s+room)\b/gi;
const TASTING_TITLE_RE = /\b(wine\s+bar|winemakers\s+studio|tasting\s+room|tasting\s+house)\b/i;
const RESTAURANT_TITLE_RE = /\b(restaurant|cafe|café|brewery|bistro)\b/i;
const HOTEL_TITLE_RE = /\b(hotel|inn|b&b|bed\s*&\s*breakfast|bed and breakfast|lodge|lodging|resort|spa|flats|lofts|retreat|marriott|holiday inn|getaways|house)\b/i;
const RESTAURANT_DESC_RE = /\b(restaurant|chef|menu|dining|breakfast|brunch|lunch|dinner|pizza|wood-fired|wood fired|brewery|cocktails)\b/i;
const HOTEL_DESC_RE = /\b(hotel|inn|suite|suites|guest ?room|guestroom|accommodation|lodging|vacation rental|vacation home|concierge|resort|spa|overnight|bed and breakfast|farmstay|farm stay)\b/i;

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function winerySignalCount(title, description) {
  const text = `${toText(title)} ${toText(description)}`;
  return text.match(STRONG_WINERY_RE)?.length ?? 0;
}

export function normalizeListingCategory(category) {
  const normalized = toText(category).toLowerCase();
  return VALID_CATEGORIES.has(normalized) ? normalized : null;
}

export function classifyListingCategory({ recid, title, description, category }) {
  if (CATEGORY_OVERRIDES.has(recid)) {
    return CATEGORY_OVERRIDES.get(recid);
  }

  const normalizedCategory = normalizeListingCategory(category);
  if (normalizedCategory && normalizedCategory !== 'winery') {
    return normalizedCategory;
  }

  const safeTitle = toText(title);
  const safeDescription = toText(description);
  const text = `${safeTitle} ${safeDescription}`;
  const signals = winerySignalCount(safeTitle, safeDescription);

  if (TASTING_TITLE_RE.test(safeTitle) && signals < 2) {
    return 'tasting';
  }

  if (RESTAURANT_TITLE_RE.test(safeTitle)) {
    return 'restaurant';
  }

  if (HOTEL_TITLE_RE.test(safeTitle) && signals < 3) {
    return 'hotel';
  }

  if (RESTAURANT_DESC_RE.test(text) && signals === 0) {
    return 'restaurant';
  }

  if (HOTEL_DESC_RE.test(text) && signals === 0) {
    return 'hotel';
  }

  if (signals > 0) {
    return 'winery';
  }

  return normalizedCategory || 'winery';
}