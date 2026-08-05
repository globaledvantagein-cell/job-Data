// Candidate company names for German-job discovery (Source B).
//
// Plain names, NOT slugs — discover-german-companies.js expands each into slug
// variants ("Delivery Hero" → deliveryhero, delivery-hero, …).
//
// PROVENANCE MATTERS. Every name here comes from a real, checkable source:
// a stock index, or a published list of companies scraped from the web (see
// WEB_HARVESTED). An earlier revision of this file contained a block of names
// written from memory; roughly half of them did not resolve to any real ATS
// board and they dragged the hit rate down, so that block was removed. Do not
// add speculative names — an invented slug costs a request and can never hit.

// ── DAX 40 ──────────────────────────────────────────────────────────────────
export const DAX40 = [
    'Adidas', 'Airbus', 'Allianz', 'BASF', 'Bayer', 'Beiersdorf', 'BMW',
    'Brenntag', 'Commerzbank', 'Continental', 'Covestro', 'Daimler Truck',
    'Deutsche Bank', 'Deutsche Boerse', 'Deutsche Post', 'Deutsche Telekom',
    'DHL Group', 'E.ON', 'Fresenius', 'Fresenius Medical Care', 'Hannover Rueck',
    'Heidelberg Materials', 'Henkel', 'Infineon', 'Mercedes-Benz', 'Merck',
    'MTU Aero Engines', 'Munich Re', 'Porsche', 'Puma', 'Qiagen', 'Rheinmetall',
    'RWE', 'SAP', 'Sartorius', 'Siemens', 'Siemens Energy', 'Siemens Healthineers',
    'Symrise', 'Volkswagen', 'Vonovia', 'Zalando',
];

// ── MDAX / TecDAX ───────────────────────────────────────────────────────────
export const MDAX_TECDAX = [
    'Aixtron', 'Aroundtown', 'Auto1', 'Bechtle', 'Bilfinger', 'Carl Zeiss Meditec',
    'CompuGroup Medical', 'CTS Eventim', 'Delivery Hero', 'Deutsche Lufthansa',
    'Draegerwerk', 'Duerr', 'Elmos Semiconductor', 'Evonik', 'Evotec', 'Fraport',
    'Freenet', 'Fuchs', 'GEA Group', 'Gerresheimer', 'Hella', 'HelloFresh',
    'Hensoldt', 'Hochtief', 'Hugo Boss', 'Jenoptik', 'Jungheinrich', 'K+S',
    'Kion Group', 'Knorr-Bremse', 'Krones', 'Lanxess', 'LEG Immobilien', 'Nagarro',
    'Nemetschek', 'Nordex', 'Norma Group', 'Pfeiffer Vacuum', 'ProSiebenSat1',
    'Rational', 'Redcare Pharmacy', 'Salzgitter', 'Scout24', 'SGL Carbon',
    'Siltronic', 'Software AG', 'Stabilus', 'Stroeer', 'Suess Microtec',
    'TAG Immobilien', 'Talanx', 'Teamviewer', 'Thyssenkrupp', 'Traton', 'Uniper',
    'United Internet', 'Varta', 'Verbio', 'Wacker Chemie', 'Wacker Neuson',
];

// ── Large German employers / industrials ────────────────────────────────────
export const GERMAN_EMPLOYERS = [
    'Aldi', 'Audi', 'Bosch', 'Bertelsmann', 'Claas', 'Datev', 'Deutsche Bahn',
    'DM Drogerie Markt', 'Douglas', 'Edeka', 'EnBW', 'Festo', 'Fielmann',
    'Fraunhofer', 'Grohe', 'Hapag-Lloyd', 'Heraeus', 'Hilti', 'Hornbach',
    'Kaufland', 'Kaercher', 'Kuehne Nagel', 'Kuka', 'Liebherr', 'Lidl', 'Mahle',
    'MAN', 'Media Markt', 'Miele', 'Obi', 'Otto Group', 'Phoenix Contact', 'Rewe',
    'Rohde Schwarz', 'Sick', 'Schaeffler', 'Stihl', 'Trumpf', 'TUI', 'Vaillant',
    'Viessmann', 'Voith', 'Weidmueller', 'Wuerth', 'ZF Friedrichshafen',
];

// ── Global tech with known Berlin / Munich / Hamburg offices ────────────────
export const GLOBAL_TECH = [
    'Adobe', 'Airbnb', 'Amazon', 'Anthropic', 'Apple', 'Atlassian', 'Canva',
    'Cisco', 'Cloudflare', 'Coinbase', 'Confluent', 'Contentful', 'Databricks',
    'Datadog', 'Discord', 'DoorDash', 'Dropbox', 'Dynatrace', 'eBay', 'Elastic',
    'Etsy', 'Figma', 'Flexport', 'Gitlab', 'Github', 'Google', 'Grammarly',
    'HashiCorp', 'HubSpot', 'IBM', 'Intel', 'Intercom', 'Klaviyo', 'LinkedIn',
    'Lyft', 'Meta', 'Microsoft', 'MongoDB', 'Mozilla', 'Netflix', 'Nvidia',
    'Okta', 'OpenAI', 'Oracle', 'Palantir', 'Pinterest', 'Qualtrics', 'Reddit',
    'Rippling', 'Rubrik', 'Salesforce', 'Samsara', 'ServiceNow', 'Shopify',
    'Snowflake', 'Splunk', 'Spotify', 'Stripe', 'Twilio', 'Uber', 'Unity',
    'Wayfair', 'Workato', 'Workday', 'Zendesk', 'Zoom', 'Zscaler',
    'Adyen', 'Bolt', 'Booking', 'Deliveroo', 'Doctolib', 'Klarna', 'Miro',
    'Mollie', 'Monzo', 'Personio', 'Pipedrive', 'Qonto', 'Revolut', 'Vinted',
    'Wise', 'Wolt',
];

// ── Consulting / services with German offices ───────────────────────────────
export const CONSULTING = [
    'Accenture', 'Bain', 'BCG', 'Capgemini', 'Cognizant', 'Deloitte', 'EY',
    'Infosys', 'KPMG', 'McKinsey', 'Oliver Wyman', 'PwC', 'Roland Berger',
    'Simon Kucher', 'Sopra Steria', 'Zuehlke',
];

// ── Web-harvested (2026-08-04) ──────────────────────────────────────────────
// Scraped from published company lists:
//   theberlinlife.com/companies-in-berlin  (Berlin employers)
//   growthlist.co/germany-startups         (funded German startups)
//   failory.com/startups/germany-unicorns  (German unicorns)
//   builtin.com/articles/tech-companies-in-germany
//   berlinstartupjobs.com, arbeitnow.com/jobs/startup (live employer lists)
export const WEB_HARVESTED = [
    '1Komma5', '34i', '7Mind', '7Learnings', 'About You', 'Accountable', 'Acemate',
    'Adjust', 'Ageras', 'Agile Robots', 'Airwallex', 'Alcemy', 'Almedia', 'Alpas AI',
    'Amboss', 'Andercore', 'Arbio', 'ARC Intelligence', 'ARX Robotics', 'Assetbird',
    'AssistMe', 'Atlantic Labs', 'Atmosfair', 'Audible', 'Autodoc', 'AutoScout24',
    'Babbel', 'Banxware', 'Baobab Insurance', 'BearingPoint', 'Beam', 'Bees and Bears',
    'Berlin Brands Group', 'Berlin Hyp', 'Bettermile', 'Blacklane', 'Blinkist',
    'Bookingkit', 'Bounti', 'Braineffect', 'Buena', 'BuildingMinds', 'Bunch',
    'C1 Green Chemicals', 'Caeli Wind', 'Caidera', 'Caresyntax', 'Cargo One',
    'Caronsale', 'Celonis', 'CEF AI', 'Choco', 'Chrono24', 'Circula', 'Circus Group',
    'Climatiq', 'Cloover', 'Clue', 'CMBlu Energy', 'Commercetools', 'CoCrafter',
    'Contorion', 'CONXAI', 'Correctiv', 'CoTrainer', 'Crealytics', 'Datatroniq',
    'Deepl', 'Deeploi', 'Deepset', 'Delivery Hero', 'Deltia', 'Denkwerk', 'Dept',
    'Deutsche Welle', 'DiaMonTech', 'Digital Charging Solutions', 'Diligent',
    'Distribusion Technologies', 'DltHub', 'Docmorris', 'Doinstruct', 'Dryad Networks',
    'Dunia Innovations', 'Ecosia', 'Ecoworks', 'Edgeless Systems', 'Egym',
    'Elearnio', 'Elopage', 'Enclaive', 'Encentive', 'Endel', 'Enpal', 'Enter',
    'Entrix', 'Envio Tech', 'Eleqtron', 'Eterno', 'Event Inc', 'Every Health',
    'Eye Security', 'FactoryPal', 'Femlives', 'Femna Health', 'Finanzfluss',
    'Finanztip', 'Finmid', 'Finn', 'Finoa', 'Flaconi', 'Flank', 'Flightright',
    'Flink', 'Flix', 'Flixbus', 'FLIZpay', 'Focused Energy', 'Foodforecast',
    'Forgent AI', 'Formo', 'Forto', 'Forward Earth', 'Founders Bay',
    'Freaks 4U Gaming', 'Freenow', 'Freshflow', 'Friendsurance', 'Funke', 'Fuxam',
    'GameDuell', 'Gematik', 'GeneralMind', 'GetYourGuide', 'Gocomo', 'Good Carbon',
    'GreenPocket', 'Grover', 'Heartbeat Medical', 'HelloBetter', 'HelloFresh',
    'Hellomateo', 'Helsing', 'HERE', 'Heyjobs', 'HiBob', 'Highsnobiety', 'Holy',
    'HomeToGo', 'Hopper Mobility', 'Hubject', 'Humanoo', 'Hypoport', 'Idealo',
    'Ideals', 'Infarm', 'Innok Robotics', 'InnoWerft', 'Isar Aerospace', 'JetBrains',
    'Join', 'Juna Ai', 'Jungwild', 'Jupus', 'JustWatch', 'Kaiko Systems', 'Kayak',
    'Kertos', 'Kewazo', 'Kiron', 'Kittl', 'Klim', 'Knime', 'Knowunity', 'KoRo',
    'Kupando', 'Lanch', 'Langdock', 'Langfuse', 'Lassie', 'Latana', 'Lemon Markets',
    'Lendis', 'Lendorse', 'Level Nine', 'LI.FI', 'Lingoda', 'LiveEO', 'Logistikbude',
    'Lucanet', 'Lumoview', 'Matsmart Motatos', 'MBition', 'McMakler', 'Mbiomics',
    'Menlo79', 'Mentimeter', 'Merantix', 'Mercanis', 'Metiundo', 'Mgm Technology Partners',
    'Midas', 'Midge Medical', 'MindDoc', 'Mindspace', 'Mister Spex', 'ML6',
    'Mobile.de', 'Moia', 'Moonfare', 'Moss', 'Motor Ai', 'Mrge', 'N26', 'N8n',
    'Nala Earth', 'NaroIQ', 'Native Instruments', 'Nature Robots', 'Nebenan',
    'Needle AI', 'Nelly', 'Nenna AI', 'Neugelb Studios', 'NexDash', 'Noah Labs',
    'Nortal', 'Nosto', 'Noxtua', 'NuCom Group', 'Numa', 'Odoo', 'OllyGarden',
    'Omio', 'OneFootball', 'Orange Quarter', 'Oska Health', 'Ostrom', 'Ovom Care',
    'Pace Club', 'Pacifico Biolab', 'Pandata', 'Parloa', 'Passionfroot', 'Patronus',
    'Payrails', 'Peec AI', 'Peeriot', 'Pennylane', 'Piano', 'Plancraft', 'PlanD',
    'Planet', 'PlayPlay', 'Pleo', 'Pliant', 'Pplwise', 'PPRO', 'PraxiPal',
    'Project Eaden', 'Purpose Green', 'Qdrant', 'Qontigo', 'QuoIntelligence',
    'Quantica', 'Quantum Systems', 'Raisin', 'Ratepay', 'Raydiax', 'Razor Group',
    'Recap', 'Reflex Aerospace', 'Reliant AI', 'Reonic', 'ResearchGate', 'Resourcly',
    'Roadsurfer', 'Roclub', 'Saiz', 'Sauce Labs', 'Scalable Capital', 'Scavenger AI',
    'Sdui', 'Secfix', 'Sellerx', 'Sennder', 'Sereact', 'Seven Senders', 'Shyftplan',
    'Silvernova', 'Sirius Music', 'Smartclip', 'Smava', 'Smoobu', 'Solar Materials',
    'Solaris', 'Solda AI', 'SolarX', 'Sonova Group', 'SoundCloud', 'SpAItial',
    'Spark e-Fuels', 'Spread AI', 'Sprylab', 'Stackgini', 'Staffbase', 'Stark',
    'Sumup', 'Sunday Naturals', 'Sunhat', 'Sunotec Group', 'Superchat', 'Superscale',
    'Synera', 'Synthflow AI', 'Tagueri', 'Tandem', 'Targomo', 'Taxfix', 'Taxforce',
    'Taxmaro', 'Teamviewer', 'Telli', 'Terra One', 'Theion', 'Thermondo', 'Thryve',
    'Tibber', 'Tier Mobility', 'TimeSec', 'Too Good to Go', 'ToolTime', 'Torg',
    'Tourlane', 'Tower Dev', 'Trade Republic', 'Trawa', 'Tytan Technologies',
    'UniverCell', 'Up42', 'Upvest', 'Urban Sports Club', 'Vara', 'Varm', 'Vay',
    'Vgreens', 'VisioLab', 'Vivira', 'Vizzlo', 'VoiceLine', 'Voiio', 'Voize',
    'Volocopter', 'Vrey', 'Wakeline', 'Watergenics', 'Wefox', 'WeRoad', 'WeSort AI',
    'Wire', 'Wonderful AI', 'Wooga', 'Workist', 'Wunderflats', 'Xentral', 'XO Life',
    'Yepoda', 'Yoffix', 'Ygo', 'Zenjob', 'Zentio',
];

/** Everything, flattened and de-duplicated (case-insensitive). */
export function allCandidateNames() {
    const groups = [
        DAX40, MDAX_TECDAX, GERMAN_EMPLOYERS, GLOBAL_TECH, CONSULTING, WEB_HARVESTED,
    ];
    const seen = new Map();
    for (const group of groups) {
        for (const name of group) {
            const key = name.trim().toLowerCase();
            if (key && !seen.has(key)) seen.set(key, name.trim());
        }
    }
    return [...seen.values()];
}
