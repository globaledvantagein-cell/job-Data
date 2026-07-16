/**
 * Canonical city list for the SEO landing pages.
 *
 * This is deliberately NOT core/locationPrefilters.js GERMAN_CITIES. That list
 * is a scraper matcher: it mixes alias spellings ('munich' + 'münchen') and
 * country-level terms ('germany', 'deutschland', 'german'). Generating one page
 * per entry would produce ~30 duplicate-content pairs plus nonsense URLs like
 * /city/german — which hurts ranking rather than helping it.
 *
 * Here each city gets exactly ONE canonical slug (the English spelling, since
 * the audience searches in English). German/alternate spellings live in
 * `aliases` so they still MATCH jobs, but never get a competing URL.
 */

export const CANONICAL_CITIES = [
    { slug: 'berlin',          label: 'Berlin',              aliases: [] },
    { slug: 'munich',          label: 'Munich',              aliases: ['münchen', 'muenchen'] },
    { slug: 'hamburg',         label: 'Hamburg',             aliases: [] },
    { slug: 'frankfurt',       label: 'Frankfurt',           aliases: [] },
    { slug: 'cologne',         label: 'Cologne',             aliases: ['köln', 'koeln'] },
    { slug: 'stuttgart',       label: 'Stuttgart',           aliases: [] },
    { slug: 'dusseldorf',      label: 'Düsseldorf',          aliases: ['düsseldorf'] },
    { slug: 'dortmund',        label: 'Dortmund',            aliases: [] },
    { slug: 'essen',           label: 'Essen',               aliases: [] },
    { slug: 'leipzig',         label: 'Leipzig',             aliases: [] },
    { slug: 'dresden',         label: 'Dresden',             aliases: [] },
    { slug: 'hanover',         label: 'Hanover',             aliases: ['hannover'] },
    { slug: 'nuremberg',       label: 'Nuremberg',           aliases: ['nürnberg', 'nuernberg'] },
    { slug: 'duisburg',        label: 'Duisburg',            aliases: [] },
    { slug: 'bochum',          label: 'Bochum',              aliases: [] },
    { slug: 'wuppertal',       label: 'Wuppertal',           aliases: [] },
    { slug: 'bielefeld',       label: 'Bielefeld',           aliases: [] },
    { slug: 'bonn',            label: 'Bonn',                aliases: [] },
    { slug: 'munster',         label: 'Münster',             aliases: ['münster'] },
    { slug: 'karlsruhe',       label: 'Karlsruhe',           aliases: [] },
    { slug: 'mannheim',        label: 'Mannheim',            aliases: [] },
    { slug: 'augsburg',        label: 'Augsburg',            aliases: [] },
    { slug: 'wiesbaden',       label: 'Wiesbaden',           aliases: [] },
    { slug: 'monchengladbach', label: 'Mönchengladbach',     aliases: ['mönchengladbach'] },
    { slug: 'gelsenkirchen',   label: 'Gelsenkirchen',       aliases: [] },
    { slug: 'braunschweig',    label: 'Braunschweig',        aliases: [] },
    { slug: 'chemnitz',        label: 'Chemnitz',            aliases: [] },
    { slug: 'kiel',            label: 'Kiel',                aliases: [] },
    { slug: 'aachen',          label: 'Aachen',              aliases: [] },
    { slug: 'halle',           label: 'Halle',               aliases: [] },
    { slug: 'magdeburg',       label: 'Magdeburg',           aliases: [] },
    { slug: 'freiburg',        label: 'Freiburg',            aliases: [] },
    { slug: 'krefeld',         label: 'Krefeld',             aliases: [] },
    { slug: 'lubeck',          label: 'Lübeck',              aliases: ['lübeck'] },
    { slug: 'oberhausen',      label: 'Oberhausen',          aliases: [] },
    { slug: 'erfurt',          label: 'Erfurt',              aliases: [] },
    { slug: 'mainz',           label: 'Mainz',               aliases: [] },
    { slug: 'rostock',         label: 'Rostock',             aliases: [] },
    { slug: 'kassel',          label: 'Kassel',              aliases: [] },
    { slug: 'hagen',           label: 'Hagen',               aliases: [] },
    { slug: 'potsdam',         label: 'Potsdam',             aliases: [] },
    { slug: 'saarbrucken',     label: 'Saarbrücken',         aliases: ['saarbrücken'] },
    { slug: 'hamm',            label: 'Hamm',                aliases: [] },
    { slug: 'ludwigshafen',    label: 'Ludwigshafen',        aliases: [] },
    { slug: 'leverkusen',      label: 'Leverkusen',          aliases: [] },
    { slug: 'oldenburg',       label: 'Oldenburg',           aliases: [] },
    { slug: 'osnabruck',       label: 'Osnabrück',           aliases: ['osnabrück'] },
    { slug: 'solingen',        label: 'Solingen',            aliases: [] },
    { slug: 'heidelberg',      label: 'Heidelberg',          aliases: [] },
    { slug: 'darmstadt',       label: 'Darmstadt',           aliases: [] },
    { slug: 'regensburg',      label: 'Regensburg',          aliases: [] },
    { slug: 'ingolstadt',      label: 'Ingolstadt',          aliases: [] },
    { slug: 'wurzburg',        label: 'Würzburg',            aliases: ['würzburg'] },
    { slug: 'wolfsburg',       label: 'Wolfsburg',           aliases: [] },
    { slug: 'gottingen',       label: 'Göttingen',           aliases: ['göttingen'] },
    { slug: 'recklinghausen',  label: 'Recklinghausen',      aliases: [] },
    { slug: 'heilbronn',       label: 'Heilbronn',           aliases: [] },
    { slug: 'ulm',             label: 'Ulm',                 aliases: [] },
    { slug: 'pforzheim',       label: 'Pforzheim',           aliases: [] },
    { slug: 'offenbach',       label: 'Offenbach',           aliases: [] },
    { slug: 'bottrop',         label: 'Bottrop',             aliases: [] },
    { slug: 'trier',           label: 'Trier',               aliases: [] },
    { slug: 'jena',            label: 'Jena',                aliases: [] },
    { slug: 'cottbus',         label: 'Cottbus',             aliases: [] },
    { slug: 'siegen',          label: 'Siegen',              aliases: [] },
    { slug: 'hildesheim',      label: 'Hildesheim',          aliases: [] },
    { slug: 'salzgitter',      label: 'Salzgitter',          aliases: [] },
    { slug: 'gutersloh',       label: 'Gütersloh',           aliases: ['gütersloh'] },
    { slug: 'iserlohn',        label: 'Iserlohn',            aliases: [] },
    { slug: 'schwerin',        label: 'Schwerin',            aliases: [] },
    { slug: 'koblenz',         label: 'Koblenz',             aliases: [] },
    { slug: 'zwickau',         label: 'Zwickau',             aliases: [] },
    { slug: 'witten',          label: 'Witten',              aliases: [] },
    { slug: 'gera',            label: 'Gera',                aliases: [] },
    { slug: 'hanau',           label: 'Hanau',               aliases: [] },
    { slug: 'esslingen',       label: 'Esslingen',           aliases: [] },
    { slug: 'ludwigsburg',     label: 'Ludwigsburg',         aliases: [] },
    { slug: 'tubingen',        label: 'Tübingen',            aliases: ['tübingen'] },
    { slug: 'flensburg',       label: 'Flensburg',           aliases: [] },
    { slug: 'konstanz',        label: 'Konstanz',            aliases: [] },
    { slug: 'worms',           label: 'Worms',               aliases: [] },
    { slug: 'marburg',         label: 'Marburg',             aliases: [] },
    { slug: 'luneburg',        label: 'Lüneburg',            aliases: ['lüneburg'] },
    { slug: 'bayreuth',        label: 'Bayreuth',            aliases: [] },
    { slug: 'bamberg',         label: 'Bamberg',             aliases: [] },
    { slug: 'plauen',          label: 'Plauen',              aliases: [] },
    { slug: 'neubrandenburg',  label: 'Neubrandenburg',      aliases: [] },
    { slug: 'wilhelmshaven',   label: 'Wilhelmshaven',       aliases: [] },
    { slug: 'meppen',          label: 'Meppen',              aliases: [] },
    { slug: 'emden',           label: 'Emden',               aliases: [] },
    { slug: 'cuxhaven',        label: 'Cuxhaven',            aliases: [] },
    { slug: 'celle',           label: 'Celle',               aliases: [] },
    { slug: 'paderborn',       label: 'Paderborn',           aliases: [] },
    { slug: 'reutlingen',      label: 'Reutlingen',          aliases: [] },
];

const citiesBySlug = new Map(CANONICAL_CITIES.map(city => [city.slug, city]));

/**
 * Looks up a city by its URL slug. Case-insensitive. Returns null for unknown
 * slugs so the route can 404 instead of rendering an empty page.
 */
export function findCityBySlug(slug) {
    if (!slug) return null;
    return citiesBySlug.get(String(slug).trim().toLowerCase()) || null;
}

/**
 * True if a job's free-text Location mentions this city under any spelling.
 * The cache stores Location as raw ATS text ("Berlin, Germany", "München"),
 * so substring matching is the only option.
 */
export function matchesCity(location, city) {
    if (!location) return false;
    const haystack = String(location).toLowerCase();
    if (haystack.includes(city.slug)) return true;
    return city.aliases.some(alias => haystack.includes(alias));
}
