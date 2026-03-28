#!/usr/bin/env node

/**
 * Workday Career Site Discovery — GERMANY EDITION
 *
 * Tests 1000+ company slugs against Workday's /wday/cxs/ JSON API.
 * Tries multiple instance×site combos per slug.
 * Filters results to Germany-only jobs.
 * Outputs copy-paste config ready for workdayConfig.js
 *
 * Usage: node discoverWorkdayGermany.js
 *
 * Endpoint: POST https://{slug}.{instance}.myworkdayjobs.com/wday/cxs/{slug}/{site}/jobs
 * Body:     { appliedFacets: {}, limit: 20, offset: 0, searchText: "" }
 */

const CONCURRENCY   = 30;
const BATCH_DELAY_MS = 200;
const TIMEOUT_MS     = 9000;

// ─── Instance × site combos (ordered by frequency — stop on first hit) ────────
const FAST_COMBOS = [
  ['wd1', 'External'],       ['wd1', 'Careers'],       ['wd1', 'External_Careers'], ['wd1', 'Jobs'],
  ['wd3', 'External'],       ['wd3', 'Careers'],       ['wd3', 'External_Careers'], ['wd3', 'Jobs'],
  ['wd5', 'External'],       ['wd5', 'Careers'],       ['wd5', 'External_Careers'], ['wd5', 'Jobs'],
  ['wd12', 'External'],      ['wd12', 'Careers'],      ['wd12', 'External_Careers'],
  ['wd2', 'External'],       ['wd2', 'Careers'],
  ['wd4', 'External'],       ['wd4', 'Careers'],
  ['wd1', 'en-US'],          ['wd3', 'en-US'],          ['wd5', 'en-US'],
  ['wd1', 'ExternalCareerSite'], ['wd5', 'ExternalCareerSite'],
  ['wd1', 'job'],            ['wd5', 'job'],
];

// ─── ALREADY IN YOUR CONFIGS — skip these entirely ────────────────────────────
// Greenhouse tokens, Ashby board names, Lever site names, and workdayConfig companies
const ALREADY_INTEGRATED = new Set([
  // ── Greenhouse ──
  'airbnb','stripe','figma','airtable','gitlab','reddit','pinterest','twitch',
  'deliveryhero','getaround','wolt','personio','contentful','celonis','adjust',
  'signavio','sennder','n26','gorillas','flink','trade-republic','taxfix','raisin',
  'heyjobs','omio','scalablecapital','eyeo','jimdo','shopify','datadog','notion',
  'miro','zapier','asana','dropbox','docusign','confluent','databricks','snowflake',
  'hashicorp','cloudflare','mongodb','elastic','okta','zendesk','hubspot','intercom',
  'segment','amplitude','mixpanel','launchdarkly','pagerduty','sumo-logic','new-relic',
  'splunk','dynatrace','doctolib','sumup','flix','jetbrains','ionos','helsing',
  'isaraerospace','staffbase','moia','freenow','scout24','parloa','autoscout24',
  'trustpilot','finanzcheck','nice','grafanalabs','catawiki','navvis','clickhouse',
  'flaconi','moonfare','trivago','adyen','zscaler','anaplan','think-cell',
  'commercetools','grover','pleo','apaleo','idnow','typeform','dataiku','workato',
  'mirakl','bitpanda','tanium','smartsheet','anydesk','spryker','strato','fivetran',
  'tripadvisor','fireblocks','bitgo','beyondtrust','tekla','adahealth','qualtrics',
  'sofi','riotgames','udemy','klaviyo','cultureamp','planradar','five9','wooga',
  'braze','bloomreach','konux','jfrog','cockroachlabs','scaleai','algolia','veracode',
  'wrike','zuora','propstack','pendo',
  // ── Ashby ──
  'ashby','deel','openai','cohere','linear','ramp','mercury','lattice','supabase',
  'vercel','replit','cal','modal','sourcegraph','grammarly','scale','hugging-face',
  'weights-biases','dbt-labs','replicate','together','perplexity','cursor','anthropic',
  'mistral','stability','adept','character','inflection',
  'moss','upvest','deepl','amboss','bunch','leapsome','carwow','rohlik','billie',
  'alephalpha','docker','babbel','mollie','cosmos','rasa','airwallex','redis','uipath',
  'deliveroo','camunda','enpal','neon','langchain','kestra','voodoo','lemon-markets',
  'forto','pleo',
  // ── Lever ──
  'welocalize','veeva','crytek','sonarsource','agicap','coupa','qonto','pipedrive',
  'brevo','spotify','contentsquare','bazaarvoice','didomi','sophos',
  // ── workdayConfig (already added) ──
  'bayer','basf','henkel','infineon','beiersdorf','covestro','lanxess','evonik','sap',
  'siemenshealthineers','daimlertruck','zalando','teamviewer','amazon','cisco','oracle',
  'salesforce','adobe','vmware','ibm','paypal','nxp','qualys','astrazeneca','takeda',
  'analogdevices','kone','equinix','trendmicro','broadridge','thales','dupont',
  'sprinklr','mars','dell','unisys','intel','globalfoundries','micron',
]);

// ─── Germany detection ────────────────────────────────────────────────────────
const GERMAN_CITIES = [
  'berlin','munich','münchen','hamburg','frankfurt','cologne','köln',
  'stuttgart','düsseldorf','dusseldorf','dortmund','essen','leipzig',
  'bremen','dresden','hanover','hannover','nuremberg','nürnberg',
  'duisburg','bochum','wuppertal','bielefeld','bonn','münster','munster',
  'karlsruhe','mannheim','augsburg','wiesbaden','mönchengladbach',
  'gelsenkirchen','braunschweig','chemnitz','kiel','aachen','halle',
  'magdeburg','freiburg','krefeld','lübeck','lubeck','oberhausen',
  'erfurt','mainz','rostock','kassel','hagen','potsdam','saarbrücken',
  'saarbrucken','hamm','ludwigshafen','leverkusen','oldenburg',
  'osnabrück','osnabruck','solingen','heidelberg','darmstadt',
  'regensburg','ingolstadt','würzburg','wurzburg','wolfsburg',
  'göttingen','gottingen','heilbronn','ulm','pforzheim','offenbach',
  'bottrop','trier','jena','siegen','hildesheim','salzgitter',
  'gütersloh','gutersloh','konstanz','bayreuth','bamberg','paderborn',
  'reutlingen','erlangen','ingolstadt','ludwigsburg','tübingen','tubingen',
];

function hasGermany(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (t.includes('germany') || t.includes('deutschland')) return true;
  if (GERMAN_CITIES.some(c => t.includes(c))) return true;
  return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY SLUGS — 1000+ entries, zero overlap with ALREADY_INTEGRATED
// Grouped by sector for easy maintenance
// ─────────────────────────────────────────────────────────────────────────────
const companySlugs = [

  // ══════════════════════════════════════════════════════════════════════════
  //  A — GERMAN HQ COMPANIES (large + Mittelstand)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Chemicals / Materials ─────────────────────────────────────────────────
  'wacker','wacker-chemie','evonik-industries','saltigo','currenta',
  'altana','altana-ag','merck','merck-group','emd','emdsigma',
  'brenntag','brenntag-ag','clariant','clariant-ag',
  'h-c-starck','hcstarck','schlenk','schlenk-metallic',
  'fuchs','fuchs-petrolub','fuchs-oil',

  // ── Engineering / Machinery ───────────────────────────────────────────────
  'kuka','duerr','duerr-ag','voith','voith-group',
  'gea','gea-group','krones','krones-ag',
  'heidelberger','manz','aixtron','suss-microtec',
  'trumpf','festo','sick','beckhoff','wago',
  'phoenix-contact','lapp','murrelektronik','turck','harting',
  'weidmuller','rittal','eaton','eaton-de','atlas-copco','atlas-copco-de',
  'smc','smc-de','parker','parker-hannifin',
  'hella','hella-de','knorr-bremse','brose','webasto',
  'continental','continental-ag','zf','zf-group','schaeffler',
  'mahle','mahle-group','brose-group',
  'reinz','victor-reinz','dana','dana-de',
  'grob','chiron','dmg-mori','rational','rational-ag','brita',

  // ── Automotive OEM / EV ───────────────────────────────────────────────────
  'bmw','bmwgroup','porsche','porsche-ag',
  'audi','audi-ag','mercedes','mercedes-benz','mercedesbenz',
  'volkswagen','volkswagen-ag',
  'man','man-truck','man-truckbus','daimler',
  'traton','traton-group','moia-mobility',
  'cariad','cariad-se','etas','etas-de',
  'porsche-digital','porscheconsulting','mhp','mhp-consulting',
  'e-go','sono-motors','sono','sono-group',
  'electric-brands','electricbrands',

  // ── Electronics / Semiconductor ───────────────────────────────────────────
  'siemens','siemens-ag','siemens-energy','siemens-mobility',
  'siemens-healthineers','osram','ams-osram','osram-gmbh',
  'carl-zeiss','zeiss','zeiss-group',
  'rohde-schwarz','rohdeschwarz',
  'bosch','bosch-group','bosch-rexroth',

  // ── Telecom / Media / IT ──────────────────────────────────────────────────
  'deutsche-telekom','telekom','t-systems','t-systems-de',
  'united-internet','1und1','drillisch','freenet',
  'otto-group','otto','otto-tech',
  'axel-springer','axelspringer','springer-nature','springernature',
  'bertelsmann','bertelsmann-ag','rtlgroup','rtl',
  'prosiebensat1','prosiebensat1media',
  'xing','new-work','newwork','kununu',
  'bechtle','cancom','computacenter','ntt-data-de',
  'adesso','msg-group','msg','gft','gft-technologies',
  'valantic','exxeta','maibornwolff','maibornwolff-de',
  'blue-yonder','blueyonder','sap-fioneer',
  'software-ag','softwareag','nemetschek','nemetschek-group',
  'datev','datev-eg','addison','haufe','haufe-group',
  'lexware','buhl','sevdesk','weclapp','xentral',
  'scopevisio','weclapp-de','actindo',
  'd-velop','dvelop','docuware','windream',
  'matrix42','baramundi',

  // ── Banking / Finance ─────────────────────────────────────────────────────
  'commerzbank','commerzbank-ag','deutsche-bank','deutschebank',
  'dz-bank','dzbank','lbbw','helaba','bayernlb','nord-lb','nordlb',
  'kfw','kfw-group','deka','dekabank','union-investment',
  'dws','dws-group','allianz','allianz-se','allianz-technology',
  'munich-re','munichre','ergo','ergo-group','ergo-digital',
  'hannover-re','hannoverrre','talanx','hdi-group','signal-iduna',
  'gothaer','debeka','huk-coburg','lvm','devk','vhv',
  'provinzial','sparkassen-versicherung','sv-versicherung',
  'barmenia','concordia','volkswohl-bund','cosmosdirekt',
  'axa-de','generali-de','zurich-de','swiss-life-de',
  'clark-insurance','wefox','getsafe','friday-insurance',
  'element-insurance',

  // ── Pharma / MedTech / Life Sciences ──────────────────────────────────────
  'boehringer','boehringeringelheim',
  'fresenius','fresenius-kabi','fresenius-medical-care',
  'stryker-de','bbraun','b-braun','b-braun-melsungen',
  'ottobock','ottobock-se','draeger','draeger-werk',
  'eppendorf','eppendorf-ag','sartorius','sartorius-ag',
  'biotronik','biotronik-de','qiagen','qiagen-de',
  'evotec','evotec-ag','curevac','curevac-ag','biontech','biontech-ag',
  'immatics','miltenyi','miltenyi-biotec',
  'siemens-healthineers-de','ge-healthcare-de','philips-de',
  'biotest','biotest-ag','allergopharma',
  'nordmark','nordmark-pharma','bionorica','stada','stada-arzneimittel',
  'roche-de','novartis-de',

  // ── Energy / Utilities / CleanTech ────────────────────────────────────────
  'eon','rwe','enbw','vattenfall-de','uniper','wintershall',
  'eon-se','rwe-group','enbw-group',
  'enphase-de','vestas-de','nordex','nordex-ag','enercon',
  'sunfire','1komma5grad','1komma5','enpal-solar',
  'thermondo','zolar','memodo','dz4',
  'gridx','envelio','octopus-energy-de',
  'siemens-gamesa','siemens-energy-renewables',
  'varta','varta-ag','akasol','akasol-ag',
  'instagrid','intilion','tesvolt',

  // ── Logistics / Transport ─────────────────────────────────────────────────
  'deutsche-bahn','db','db-systel','db-netz','db-cargo',
  'dhl','deutsche-post','dp-dhl','dpd','gls',
  'hellmann','rhenus','dachser','schenker','db-schenker',
  'kuehne-nagel','kuehnenagel','fiege','fiege-group',
  'hermes-de','hermes-germany','six-group',
  'fraport','fraport-ag','lufthansa','lufthansa-group',
  'eurowings','condor','tui','tui-group',
  'sixt','sixt-se','freenow-de','miles-mobility',
  'flixmobility','flixbus-de',
  'transdev-de','abellio',

  // ── Retail / Consumer / Food ──────────────────────────────────────────────
  'schwarz-group','lidl','kaufland','aldi','aldi-sued','aldi-nord',
  'rewe','rewe-digital','rewe-group','metro','metro-ag',
  'adidas','puma','hugo-boss','hugoboss','birkenstock',
  'douglas','dm-drogerie','rossmann','ceconomy',
  'mediamarkt','saturn-de',
  'about-you','aboutyou','otto-fashion',
  'home24','westwing','westwing-de','mytheresa',
  'outfittery','aboutyou-group',
  'lieferando','takeaway-de',
  'rewe-tech','kaufland-ecommerce',

  // ── PropTech / ConTech ────────────────────────────────────────────────────
  'vonovia','deutsche-wohnen','leg-immobilien',
  'immobilienscout24','immowelt','meinestadt','mcmakler',
  'homeday','maklaro','scoperty',
  'bilfinger','bilfinger-se','hochtief','strabag','goldbeck',
  'peri','peri-group','implenia','max-boegl',

  // ── Defense / Security ────────────────────────────────────────────────────
  'rheinmetall','rheinmetall-ag','hensoldt','diehl',
  'secunet','genua','myra-security','dracoon',
  'bundeswehr-it','bwi','dataport','dataport-de',
  'rohde-schwarz-cybersecurity',

  // ── German Digital Health ─────────────────────────────────────────────────
  'ada-health','clue-app','kaia-health','teleclinic',
  'kry-de','ottonova','alley-health','vivy-health',
  'caresyntax','brainlab-de','intraoperative',
  'amboss-medical','thieme','elsevier-health-de',
  'medbelle','numa','limehome',

  // ── German AI / DeepTech ──────────────────────────────────────────────────
  'aleph-alpha','alephalpha-de','merantix','merantix-ai',
  'twenty-first-de','quantco','quantco-de',
  'deepset','deepset-ai','kern-ai',
  'mostly-ai','statice','aircloak',
  'appliedai','appliedai-institute',
  'twaice','twaice-de','compredict',
  'understand-ai','fernride',

  // ══════════════════════════════════════════════════════════════════════════
  //  B — INTERNATIONAL: BIG TECH WITH GERMANY OFFICES
  // ══════════════════════════════════════════════════════════════════════════

  // ── US Big Tech ───────────────────────────────────────────────────────────
  'google','alphabet','googledeepmind',
  'meta','facebook',
  'apple',
  'microsoft',
  'netflix',
  'nvidia','nvidiacareers',
  'twitter','x-corp',
  'uber','lyft',
  'airbnb-tech',
  'palantir',
  'servicenow',
  'twilio',
  'atlassian',

  // ── US Enterprise Software ────────────────────────────────────────────────
  'workday','workday-de',
  'sap-ariba','sap-concur','sap-fieldglass',
  'oracle-de',
  'salesforce-de',
  'adobe-de',
  'vmware-de',
  'redhat','redhat-de',
  'suse','canonical',
  'citrix','citrix-de','parallels',
  'opentext','opentext-de',
  'micro-focus','microfocus',
  'verint','verint-de',
  'nice-systems','genesys','genesys-de',
  'talkdesk','ringcentral','ringcentral-de',
  'mitel','mitel-de',

  // ── US SaaS / DevTools ────────────────────────────────────────────────────
  'monday','mondaydotcom',
  'clickup','coda',
  'freshworks',
  'surveymonkey',
  'hotjar','fullstory','heap',
  'iterable','sendgrid','mailgun',
  'zenloop','medallia','medallia-de',
  'posthog',
  'linear-app',
  'retool',
  'loom','loomcareers',
  'notion-de','coda-de',
  'basecamp','basecamp-de',
  'github-de','gitlab-de',
  'circleci','harness',
  'jfrog-de','sonatype',
  'sentry','sentry-de',
  'grafana-de','logzio','coralogix',
  'pulumi','env0','spacelift',

  // ── US Cloud / Infra ──────────────────────────────────────────────────────
  'digitalocean','rackspace-de',
  'fastly','akamai',
  'fly-io','render','railway',
  'supabase-de','planetscale-de',
  'upstash',
  'cockroachdb','timescale','questdb','clickhouse-de',
  'pinecone','weaviate','qdrant',
  'confluent-de','rabbitmq','solace-de',
  'elastic-de','opensearch',

  // ── US Security / Cyber ───────────────────────────────────────────────────
  'sentinelone','cyberark','sailpoint',
  'rapid7','tenable',
  'proofpoint','mimecast','recordedfuture',
  'checkpoint','checkpointsw',
  'crowdstrike','paloaltonetworks','fortinet',
  'f5','f5-de',

  // ── US Fintech ────────────────────────────────────────────────────────────
  'stripe-de',
  'klarna','klarna-de','wise','wise-de',
  'revolut','checkout-com',
  'plaid','marqeta','affirm',
  'brex','ramp-com',
  'coinbase','kraken','binance-de',
  'ripple','circle-internet','fireblocks-de',
  'billdotcom','tipalti','tipalti-de',
  'solaris-bank','mambu-de',
  'thought-machine','10x-banking',
  'finastra','finastra-de','temenos','temenos-de',
  'worldpay-de',

  // ── US HR / Recruiting ────────────────────────────────────────────────────
  'workday-hr','successfactors',
  'cornerstone','cornerstoneondemand',
  'smartrecruiters','beamery',
  'eightfold','eightfold-ai','phenom','phenompeople',
  'jobvite','teamtailor','breezyhr',
  'peakon','betterworks',

  // ── US E-commerce / Marketplace ───────────────────────────────────────────
  'shopify-de','bigcommerce','magento-de',
  'spryker-de','commercetools-de',
  'contentful-de','storyblok',
  'algolia-de','constructor-io','bloomreach-de',
  'emarsys','dotdigital','ometria',
  'yotpo','shippo','easypost','parcellab','sendcloud',
  'aftership','seven-senders',
  'ebay','ebay-de','wayfair-de',
  'tripadvisor-de',

  // ══════════════════════════════════════════════════════════════════════════
  //  C — EUROPEAN TECH WITH GERMANY PRESENCE
  // ══════════════════════════════════════════════════════════════════════════

  // ── European Scale-ups ────────────────────────────────────────────────────
  'n26-tech','traderepublic-de',
  'getir-de','gorillas-tech','flink-de',
  'tier-mobility','tiermobility',
  'door2door','door2door-de',
  'getyourguide-tech','hometogo-de',
  'hellofresh-tech',
  'delivery-hero-tech',
  'sennder-tech',
  'auto1-tech','heycar-de',
  'flixmobility-tech',
  'omio-de','rome2rio',
  'check24-tech','verivox-de',
  'immobilienscout-tech','autoscout-tech',
  'idealo-de','ladenzeile-de',
  'stepstone-de','jobbörse-de',
  'xing-tech',

  // ── Nordic / Benelux with DE offices ──────────────────────────────────────
  'spotify-de','king','kahoot','mentimeter',
  'tobii','voi','einride',
  'northvolt','h2greensteel',
  'ikea-de','hmgroup-de',
  'randstad','wolterskluwer','dsv',
  'asml','stmicro','stmicroelectronics',
  'signify','tomtom','here-technologies',
  'ing-de','rabobank-de','nordea-de',
  'nets','nexi-de',
  'ubs-de','swisscom-de',
  'roche-careers','novartis-careers',
  'abb-de','schneider-electric','schneiderelectric',
  'holcim',

  // ── French Tech with DE offices ───────────────────────────────────────────
  'ovhcloud','scaleway',
  'alan-insurance','deezer','blablacar',
  'ubisoft-de','gameloft-de',
  'capgemini','capgeminicareer',
  'atos','atos-de',
  'airbus','airbus-de',
  'safran','dassault','dassaultsystemes',
  'michelin-de','totalenergies-de',
  'bnpparibas-de','axa-careers','sanofi-de',
  'sanofi','sanoficareers',
  'loreal-de','danone-de',

  // ── UK Tech with DE offices ───────────────────────────────────────────────
  'improbable','darktrace','graphcore',
  'sophos-de',
  'baesystems','rolls-royce','rollsroyce-de',
  'vodafone-de',
  'hsbc-de','barclays-de',
  'astrazeneca-de',
  'pearson-de','relx','elsevier',
  'experian','experian-de',

  // ── Swiss / Austrian ──────────────────────────────────────────────────────
  'roche','novartis',
  'ubs','credit-suisse','creditsuisse',
  'temenos','avaloq','temenos-banking',
  'swisscom',

  // ══════════════════════════════════════════════════════════════════════════
  //  D — US FORTUNE 500 WITH GERMANY ENGINEERING / MANUFACTURING
  // ══════════════════════════════════════════════════════════════════════════

  // ── Semiconductor / Hardware ──────────────────────────────────────────────
  'amd','amdcareers',
  'qualcomm','qualcomm-de',
  'broadcom','broadcom-de',
  'texas-instruments','ti-de',
  'arm','arm-de',
  'cadence',
  'synopsys',
  'keysight','teradyne','kla',
  'appliedmaterials','lamresearch',
  'western-digital','westerndigital-de',
  'seagate','seagate-de','netapp-de',
  'juniper','junipernetworks',
  'arista','aristanetworks',
  'marvell','marvelltech',
  'microchip','microchiptechnology',

  // ── Enterprise / Cloud ────────────────────────────────────────────────────
  'hpe','hpecareers',
  'ibm-de',
  'dell-de',
  'lenovo','lenovo-de',
  'nttdata','ntt-de',
  'fujitsu','fujitsu-de',
  'unisys-de',
  'cgi','cgicareers',
  'dxctechnology','dxc-de',

  // ── Consulting ────────────────────────────────────────────────────────────
  'mckinsey',
  'bcg','bostonconsulting',
  'bain','bainandcompany',
  'deloitte','deloitteglobal',
  'ey','eyglobal',
  'pwc','pwcglobal',
  'kpmg','kpmgglobal',
  'accenture',
  'cognizant','cognizant-de',
  'oliverwyman',
  'rolandberger','roland-berger',
  'simonkucher','simon-kucher',
  'bearingpoint','bearing-point',
  'horvath','horvath-de',
  'epam','epam-de','thoughtworks','thoughtworks-de',

  // ── Healthcare / Pharma / MedTech ─────────────────────────────────────────
  'pfizer-de','johnsoncareers','jnj-de',
  'abbvie-de','amgen-de',
  'merck-de','msd-de',
  'lilly-de','bms-de',
  'gilead-de','regeneron-de',
  'medtronic-de','stryker-de',
  'becton-de','bd-de',
  'bostonscientific-de','edwardslifesciences-de',
  'zimmerbiomet-de','intuitive-de',
  'illumina-de','danaher-de',
  'thermofisher-de','thermofisherscientific-de',
  'perkinelmer-de','revvity',
  'agilent-de','waters-de',
  'iqvia','iqvia-de','certara','certara-de',

  // ── Aerospace / Defense ───────────────────────────────────────────────────
  'leidos','leidos-de','saic',
  'lockheedmartin','northropgrumman',
  'raytheon','rtx','generaldynamics',
  'l3harris','textron',
  'jacobs','jacobscareers','aecom','aecom-de',
  'fluor','kbr',

  // ── Industrial / Manufacturing ────────────────────────────────────────────
  'honeywell',
  'emerson',
  'ge','gecareers','gevernova',
  'caterpillar','cat',
  'deere','johndeere',
  'rockwellautomation','rockwell',
  'johnsoncontrols','jci',
  'carrier','carrierglobal',
  'otis','otisworldwide',
  '3m','3mcareers',
  'ecolab','ecolab-de',
  'linde-de','airliquide','air-liquide',
  'saint-gobain','saint-gobain-de',
  'ppg','ppg-de',
  'corning','corning-de',
  'eastman','eastman-de',
  'dow','dow-de',
  'mettler-toledo','mettler',
  'sartorius-stedim','sartorius-careers',
  'bruker','bruker-de',
  'hamilton-de',
  'endress-hauser','endress-hauser-de',

  // ── Automotive Suppliers ──────────────────────────────────────────────────
  'aptiv','aptiv-de',
  'lear','lear-de',
  'magna','magna-de',
  'denso','denso-de',
  'borgwarner','borgwarner-de',

  // ── Energy ────────────────────────────────────────────────────────────────
  'shell','shell-de',
  'bp-de','totalenergies',
  'exxonmobil-de',
  'schlumberger','slb','halliburton-de',
  'bakerhughes-de',
  'nextera-de',
  'enphase-de',

  // ── Finance / Banking ──────────────────────────────────────────────────────
  'goldmansachs','gs-de',
  'morganstanley-de',
  'jpmorgan','jpmc-de',
  'citigroup','citi-de',
  'blackrock-de','vanguard-de','statestreet-de',
  'fidelity-de','invesco-de','amundi',
  'visa-de','mastercard-de',
  'zurichinsurance','generali-group',
  'swissre','munichre-group',
  'fiserv-de','fis-de','worldpay',

  // ── Retail / Consumer ─────────────────────────────────────────────────────
  'amazon-de',
  'nike-de','adidas-group',
  'loreal','loreal-careers',
  'proctergamble','pg-de',
  'colgate-de','reckitt-de',
  'nestle-de','danone',
  'diageo-de','heineken-de',
  'unilever-de',
  'ferrero','ferrero-de',

  // ── Logistics ─────────────────────────────────────────────────────────────
  'ups-de','fedex-de',
  'maersk','maerskcareer',
  'xpo','xpo-de',
  'ceva-logistics','ceva-de',

  // ── Real Estate / Infrastructure ──────────────────────────────────────────
  'cbre','cbre-de',
  'jll','jll-de',
  'cushmanwakefield-de','colliers-de',
  'brookfield-de','prologis-de',
  'digitalrealty-de','ironmountain-de',

  // ── Telecom ───────────────────────────────────────────────────────────────
  'ericsson','ericsson-de',
  'nokia','nokia-de',
  'telefonica-de','o2-de',
  'orange-de','bt-de',
  'ntt-communications',

  // ── Media / Streaming ────────────────────────────────────────────────────
  'disney-de','wbd-de','paramountglobal',
  'sky-de','sky-deutschland',
  'dazn','dazn-de',

  // ── Gaming / Entertainment ────────────────────────────────────────────────
  'ea-de','electronicarts-de',
  'activisionblizzard-de',
  'ubisoft-careers',
  'roblox-de','unity-de',
  'take2-de','taketwo-de',
  'supercell-de',

  // ── Education / Publishing ────────────────────────────────────────────────
  'coursera-de','udemy-de','pluralsight-de',
  'duolingo-de',
  'pearson-careers','mcgrawhill-de',
  'wiley-de','elsevier-de',
  'relx-de','springer',
  'gartner-de','idc-de',

  // ══════════════════════════════════════════════════════════════════════════
  //  E — MORE GERMAN / EUROPEAN STARTUPS & SCALE-UPS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Berlin / Hamburg / Munich Startups ────────────────────────────────────
  'pitch-de','babbel-tech','blinkist-tech','ecosia-de',
  'komoot','smava','auxmoney','billie-de',
  'penta-bank','vivid-money','getmoss',
  'spendesk','celonis-ai','signavio-process',
  'flaconi-de','home24-de','westwing-tech',
  'flix-tech',
  'soundcloud-de',
  'wooga-de','innogames','goodgame',
  'bigpoint','crytek-de',
  'onefootball-de','clue-app-de',
  'doctolib-de','teleclinic-de',
  'aleph-alpha-de',
  'staffbase-de','usercentrics-de',
  'appsflyer-de','braze-de',
  'deposit-solutions','weltsparen',
  'liqid-de','ginmon','finanzguru','kontist',
  'banxware','mondu-de','exporo','creditshelf',
  'grover-de','rebuy','backmarket-de',
  'catawiki-de','vinted-de','momox',
  'inkitt','medbelle-de','numa-de','limehome-de',
  'apaleo-de','gastrofix','comtravo',
  'zeitgold','candis','circula','yokoy','payhawk-de',
  'kenjo','factorial-de','hibob-de','leapsome-de',
  'small-improvements','workpath','perdoo',
  'gtmhub','quantive','coachhub','sharpist','masterplan-de',
  'speexx','chatterbug','lingoda-de',
  'lovoo','kaia-health-de','mindable','selfapy',
  'neuroflash',
  'wonder-platform','hopin','hubilo',
  'locoia','tray-io',
  'cross-engage','xtremepush',
  'zenjob','zenjob-de','coyo','coyo-de',
  'freeletics','egym-de',
  'magazino','roboception',
  'atoss','softgarden','roadsurfer',
  'gini-de','sensape',
  'proxima-solutions','thinxnet',
  'mobility-house','has-to-be','chargepilot',
  'sonnen-de','one-komma-five',
  'konux-de','riskmethods',
  'celonis-ems','minit','lana-labs',
  'process-gold','aris-de',
  'abbyy-de','kofax-de',
  'automation-hero','workfusion',
  'parlamind','cognigy','cognigy-de',
  'rasa-de','botfriends','e-bot7',
  'parloa-de','solvemate',
  'novomind','bsi-software',
  'emarsys-de','qualtrics-de',
  'medallia-mopinion',
  'dynamic-yield','kameleoon','ab-tasty',
  'gainsight-de','totango-de','planhat',
  'churnzero',

  // ── Dutch / Nordic / Swiss scale-ups ──────────────────────────────────────
  'messagebird',
  'tink','trustly','bambora',
  'unity-de','kahoot-de',
  'voi-technology','einride-de',
  'polestar-de',
  'nxp-careers',
  'signify-de',
  'tomtom-de',

  // ══════════════════════════════════════════════════════════════════════════
  //  F — ADDITIONAL US / GLOBAL (frequently expand to Germany)
  // ══════════════════════════════════════════════════════════════════════════
  'ansys','ansys-de','ptc','ptc-de',
  'siemens-plm','siemens-sw',
  'dassault-de','msc-software',
  'altair','altair-de','hexagon-de','hexagon-ab',
  'leica-geosystems','trimble-de',
  'garmin-de','tomtom-careers',
  'esri','esri-de',
  'bentley','bentley-systems',
  'autodesk-de',
  'procore-de',
  'servicenow-de',
  'salesforce-tableau','tableau-de',
  'mulesoft','mulesoft-de',
  'boomi','boomi-de','jitterbit',
  'tibco','tibco-de','informatica-de',
  'opentext-de','micro-focus-de',
  'ibm-sterling','ibm-maximo',
  'sap-analytics-cloud','sap-datasphere',
  'celonis-process',
  'uipath-de',
  'automation-anywhere-de','blue-prism-de',
  'nice-de','genesys-cloud',
  'five9-de',
  'vonage-de',
  'avaya','avaya-de',
  'cisco-de',
  'palo-alto-de','checkpoint-de',
  'fortinet-de','sophos-de','tanium-de',
  'beyondtrust-de','cyberark-de',
  'varonis-de','sailpoint-de',
  'okta-de',
  'ping-identity','pingidentity',
  'one-identity',
  'sailpoint',
  'saviynt',
  'delinea','thycotic',
  'beyond-security',
  'securonix','exabeam',
  'logrhythm','sumo-logic-de',
  'devo','humio',
  'lacework','orca-security',
  'wiz','snyk-de',
  'checkmarx','mend','whitesource',
  'veracode-de',
  'sonarqube',
  'jfrog-de',
  'aqua-security','twistlock',
  'prisma-cloud',
  'hashicorp-de',
  'terraform','vagrant',
  'chef-de','puppet-de','ansible-de',
  'redhat-ansible',
  'rancher-de','suse-de',
  'canonical-de',
  'nutanix','nutanix-de',
  'pure-storage','purestorage-de',
  'netapp','netapp-de',
  'veeam','veeam-de',
  'cohesity','cohesity-de',
  'rubrik','rubrik-de',
  'commvault','commvault-de',
  'veritas','veritas-de',

];

// ─────────────────────────────────────────────────────────────────────────────
// Workday API tester
// ─────────────────────────────────────────────────────────────────────────────

async function tryEndpoint(slug, instance, site) {
  const url = `https://${slug}.${instance}.myworkdayjobs.com/wday/cxs/${slug}/${site}/jobs`;
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
        'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
    });
    clearTimeout(tid);
    if (!res.ok) return null;

    const data = await res.json();
    if (typeof data.total === 'undefined') return null;

    const jobs        = data.jobPostings || [];
    const germanyJobs = jobs.filter(j => hasGermany(j.locationsText));

    // Check location facets for a better count than first-page sample
    let facetGermany = 0;
    if (data.facets) {
      const locGroup = data.facets.find(f => f.facetParameter === 'locationMainGroup');
      if (locGroup?.values?.[0]?.values) {
        for (const loc of locGroup.values[0].values) {
          if (hasGermany(loc.descriptor)) facetGermany += loc.count || 0;
        }
      }
    }

    return {
      slug, instance, site,
      total:       data.total || 0,
      germany:     Math.max(germanyJobs.length, facetGermany),
      germanyJobs,
      url:  `https://${slug}.${instance}.myworkdayjobs.com/${site}`,
      api:  url,
    };
  } catch {
    clearTimeout(tid);
    return null;
  }
}

async function testWorkday(slug) {
  // Skip any slug that somehow slipped through
  if (ALREADY_INTEGRATED.has(slug.toLowerCase())) return null;

  for (const [instance, site] of FAST_COMBOS) {
    const r = await tryEndpoint(slug, instance, site);
    if (r !== null) return r;  // Stop on first working combo
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const uniqueSlugs = [...new Set(companySlugs)].filter(s => !ALREADY_INTEGRATED.has(s.toLowerCase()));
  const startTime   = Date.now();

  console.log(`\n🇩🇪 WORKDAY GERMANY DISCOVERY — Testing ${uniqueSlugs.length} slugs`);
  console.log(`   Excluded: ${companySlugs.length - uniqueSlugs.length} already-integrated`);
  console.log(`   Combos per slug: ${FAST_COMBOS.length} | Concurrency: ${CONCURRENCY}\n`);

  const allFound    = [];   // every Workday board discovered
  const withGermany = [];   // boards that have Germany jobs
  let tested = 0;

  for (let i = 0; i < uniqueSlugs.length; i += CONCURRENCY) {
    const batch   = uniqueSlugs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(testWorkday));

    for (const r of results) {
      if (!r) continue;
      allFound.push(r);
      if (r.germany > 0) {
        withGermany.push(r);
        console.log(`  ✅ ${r.slug} (${r.instance}/${r.site}): ${r.germany} 🇩🇪 / ${r.total} total`);
      }
    }

    tested = Math.min(i + CONCURRENCY, uniqueSlugs.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(
      `\r  [${tested}/${uniqueSlugs.length}] ${elapsed}s | Workday boards: ${allFound.length} | 🇩🇪 Germany: ${withGermany.length}   `
    );

    if (i + CONCURRENCY < uniqueSlugs.length) await sleep(BATCH_DELAY_MS);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── RESULTS ──────────────────────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(80)}`);
  console.log(`📊 WORKDAY GERMANY DISCOVERY (${totalTime}s)`);
  console.log(`   ${uniqueSlugs.length} slugs tested | ${allFound.length} Workday boards found | ${withGermany.length} with Germany jobs`);
  console.log(`${'═'.repeat(80)}`);

  if (withGermany.length > 0) {
    const sorted = [...withGermany].sort((a, b) => b.germany - a.germany);

    console.log(`\n🇩🇪 BOARDS WITH GERMANY JOBS (${sorted.length}) — sorted by count:`);
    console.log(`${'─'.repeat(80)}`);
    for (const r of sorted) {
      const pad = ' '.repeat(Math.max(1, 32 - r.slug.length));
      console.log(`  ${r.slug}${pad}${r.instance}/${r.site.padEnd(22)} 🇩🇪 ${String(r.germany).padStart(4)} / ${r.total} total`);
    }

    // ── Copy-paste config ─────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📋 COPY-PASTE → workdayConfig.js companyBoards:`);
    console.log(`${'═'.repeat(80)}\n`);
    console.log(`const companyBoards = [`);
    for (const r of sorted) {
      const cPad = ' '.repeat(Math.max(1, 28 - r.slug.length));
      const sPad = ' '.repeat(Math.max(1, 24 - r.site.length));
      console.log(`  { company: '${r.slug}',${cPad}instance: '${r.instance}', site: '${r.site}',${sPad}name: '${r.slug}' },  // ${r.germany} DE / ${r.total} total`);
    }
    console.log(`];\n`);

    // ── Sample jobs ───────────────────────────────────────────────────────
    console.log(`${'═'.repeat(80)}`);
    console.log(`🔍 SAMPLE GERMANY JOBS (top 25, up to 3 per company):`);
    console.log(`${'═'.repeat(80)}`);
    for (const r of sorted.slice(0, 25)) {
      console.log(`\n  📌 ${r.slug} (${r.instance}/${r.site}) — ${r.germany} Germany jobs:`);
      for (const j of r.germanyJobs.slice(0, 3)) {
        console.log(`     • ${j.title}`);
        console.log(`       ${j.locationsText || ''} | ${j.postedOn || ''}`);
      }
    }
  }

  if (allFound.length > 0) {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📋 ALL WORKDAY BOARDS FOUND (including zero Germany) — ${allFound.length} total:`);
    console.log(`${'─'.repeat(80)}`);
    const sortedAll = [...allFound].sort((a, b) => b.total - a.total);
    for (const r of sortedAll) {
      const flag = r.germany > 0 ? `🇩🇪 ${String(r.germany).padStart(4)}` : `   none`;
      const pad  = ' '.repeat(Math.max(1, 32 - r.slug.length));
      console.log(`  ${r.slug}${pad}${r.instance}/${r.site.padEnd(22)} ${flag} / ${r.total} total`);
    }
  }

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 FINAL SUMMARY`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`  Slugs tested:        ${uniqueSlugs.length}`);
  console.log(`  Workday boards found: ${allFound.length}`);
  console.log(`  With Germany jobs:    ${withGermany.length}`);
  console.log(`  Total Germany jobs:   ${withGermany.reduce((s, r) => s + r.germany, 0)}`);
  console.log(`  Time:                ${totalTime}s`);
  console.log(`${'═'.repeat(80)}\n`);
}

main();