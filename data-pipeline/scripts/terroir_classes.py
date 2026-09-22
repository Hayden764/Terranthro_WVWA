"""
Grower-facing terroir classes shared by the geology / soils compute scripts and
the soils+geology map tile build. Keep the class names in sync with
src/config/earthLayersConfig.js (legend colours).
"""

from typing import Optional


def _lower(v) -> str:
    """Lower-cased string, '' for None / NaN / non-strings."""
    return v.lower() if isinstance(v, str) else ""


def geology_class(rock_type: Optional[str], formation: Optional[str],
                  lithology: Optional[str]) -> Optional[str]:
    """Collapse DOGAMI OGDC thematic fields into the vocabulary growers use
    (Jory = Volcanic, Willakenzie = Marine sedimentary, Missoula Flood, Loess...)."""
    rt, fm, li = _lower(rock_type), _lower(formation), _lower(lithology)

    if rt == "sediments":
        if "missoula" in fm or "willamette silt" in fm:
            return "Missoula Flood"
        if "loess" in fm or "eolian" in fm:
            return "Loess"
        if "landslide" in fm or "colluvial" in fm or "debris flow" in fm:
            return "Landslide & colluvium"
        if "glacial" in fm:
            return "Glacial"
        if "laterite" in fm:
            return "Volcanic"  # lateritic residuum weathered in place from basalt
        return "Alluvial"
    if rt in ("volcanic rocks", "invasive extrusive rocks", "vent and pyroclastic rocks",
              "marine volcanic rocks"):
        return "Volcanic"
    if rt == "volcaniclastic rocks":
        return "Volcaniclastic"
    if rt == "marine sedimentary rocks":
        return "Marine sedimentary"
    if rt == "terrestrial sedimentary rocks":
        return "Sedimentary"
    if rt in ("intrusive rocks", "batholith rocks"):
        if "ultramafic" in li:
            return "Ultramafic"  # Klamath serpentinite / peridotite
        if rt == "batholith rocks" or "felsic" in li or "syenite" in li:
            return "Granitic"
        # Coast Range diabase sills, andesite/diorite intrusions read as volcanic to growers
        return "Volcanic"
    if rt in ("metamorphic rocks", "melange rocks"):
        return "Metamorphic"
    return None


_VOLCANIC = ("basalt", "andesite", "igneous", "volcanic", "diabase", "rhyolite", "dacite",
             "ash", "pumice", "cinders", "scoria", "tuff", "lava", "obsidian")
_SEDIMENTARY = ("sandstone", "siltstone", "mudstone", "shale", "sedimentary", "claystone",
                "conglomerate")
_GRANITIC = ("granit", "granodiorite", "diorite", "quartz monzonite")
_ULTRAMAFIC = ("serpentin", "peridotite", "ultramafic", "gabbro")
_METAMORPHIC = ("schist", "metamorphic", "metasedimentary", "metavolcanic", "greenstone",
                "slate", "phyllite", "gneiss", "argillite")


def soil_class(parent_material: Optional[str]) -> Optional[str]:
    """Class from a SSURGO parent-material description, judged on the uppermost
    material (text before ' over '): 'silty loess over residuum from basalt' is Loess
    (Laurelwood); 'colluvium derived from basalt over clayey residuum' is Volcanic (Jory)."""
    pm = _lower(parent_material)
    if not pm:
        return None
    top = pm.split(" over ")[0]

    if "loess" in top or "eolian" in top:
        return "Loess"
    if "glaciolacustrine" in top or "lacustrine" in top:
        return "Missoula Flood"  # Willamette Silt; glaciolacustrine elsewhere reads the same
    if "alluvium" in top or "outwash" in top or "fluvial" in top or "marine deposits" in top:
        return "Alluvial"

    def has(words, s):
        return any(w in s for w in words)

    # Rock origin: prefer the upper material, fall back to the whole description
    for s in (top, pm):
        if "tuffaceous" in s:
            return "Volcaniclastic"
        v, sd = has(_VOLCANIC, s), has(_SEDIMENTARY, s)
        if v and sd:
            return "Mixed volcanic & sedimentary"
        if v:
            return "Volcanic"
        if sd:
            return "Sedimentary"  # marine vs terrestrial comes from the bedrock pairing
        if has(_ULTRAMAFIC, s):
            return "Ultramafic"
        if has(_GRANITIC, s):
            return "Granitic"
        if has(_METAMORPHIC, s):
            return "Metamorphic"
    if "organic" in pm or "herbaceous" in pm:
        return "Organic"
    return None


def soil_classes(series, parent_materials) -> list:
    """soil_class() per map unit, falling back to the most common class for the same
    soil series across the whole dataset when the unit's own parent-material text is
    too vague to classify (older surveys: 'colluvium', 'silty material over ...')."""
    import collections
    classes = [soil_class(pm) for pm in parent_materials]
    votes = collections.defaultdict(collections.Counter)
    for sr, cl in zip(series, classes):
        if isinstance(sr, str) and cl:
            votes[sr][cl] += 1
    return [cl or (votes[sr].most_common(1)[0][0] if isinstance(sr, str) and votes[sr] else None)
            for sr, cl in zip(series, classes)]
