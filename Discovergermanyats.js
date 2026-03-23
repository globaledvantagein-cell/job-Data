#!/usr/bin/env node

/**
 * Germany ATS Career Site Discovery
 * Tests 2000+ company slugs against Greenhouse, Ashby, and Lever public APIs.
 * Filters for Germany-based jobs. Outputs config ready to paste into your codebase.
 *
 * EXCLUDES all companies already in your configs:
 *   - greenhouseConfig.js (56 tokens)
 *   - ashbyConfig.js (45 board names)
 *   - leverConfig.js (1 site name)
 *
 * Usage: node discoverGermanyATS.js
 */

const CONCURRENCY = 5;
const BATCH_DELAY_MS = 1200;
const TIMEOUT_MS = 12000;

// Already in your configs — skip these
const EXISTING_SLUGS = new Set([
  'airbnb','stripe','figma','airtable','gitlab','reddit','pinterest',
  'twitch','deliveryhero','getaround','wolt','personio','contentful',
  'celonis','adjust','signavio','sennder','n26','gorillas','flink',
  'trade-republic','taxfix','raisin','heyjobs','omio','scalablecapital',
  'eyeo','jimdo','shopify','datadog','notion','miro','zapier','asana',
  'dropbox','docusign','confluent','databricks','snowflake','hashicorp',
  'cloudflare','mongodb','elastic','okta','zendesk','hubspot','intercom',
  'segment','amplitude','mixpanel','launchdarkly','pagerduty',
  'sumo-logic','new-relic','splunk','dynatrace',
  'ashby','deel','openai','cohere','linear','ramp','mercury',
  'lattice','supabase','vercel','replit','cal','modal','sourcegraph',
  'grammarly','scale','hugging-face','weights-biases','dbt-labs',
  'replicate','together','perplexity','cursor','anthropic','mistral',
  'stability','adept','character','inflection',
  'getyourguide','auto1','zalando','hellofresh','rocket-internet',
  'welocalize',
]);
function isExisting(slug) { return EXISTING_SLUGS.has(slug.toLowerCase()); }

// Germany detection
const GERMAN_CITIES = [
  'berlin','munich','münchen','hamburg','frankfurt','cologne','köln',
  'stuttgart','düsseldorf','dusseldorf','dortmund','essen','leipzig','bremen',
  'dresden','hanover','hannover','nuremberg','nürnberg','duisburg',
  'bochum','wuppertal','bielefeld','bonn','münster','munster',
  'karlsruhe','mannheim','augsburg','wiesbaden','mönchengladbach',
  'gelsenkirchen','braunschweig','chemnitz','kiel','aachen',
  'halle','magdeburg','freiburg','krefeld','lübeck','lubeck',
  'oberhausen','erfurt','mainz','rostock','kassel','hagen',
  'potsdam','saarbrücken','saarbrucken','hamm','ludwigshafen',
  'leverkusen','oldenburg','osnabrück','osnabruck','solingen',
  'heidelberg','darmstadt','regensburg','ingolstadt','würzburg',
  'wurzburg','wolfsburg','göttingen','gottingen','recklinghausen',
  'heilbronn','ulm','pforzheim','offenbach','bottrop','trier',
  'jena','cottbus','siegen','hildesheim','salzgitter','gütersloh',
  'gutersloh','iserlohn','schwerin','koblenz','zwickau','witten',
  'gera','hanau','esslingen','ludwigsburg','tubingen','tübingen',
  'flensburg','konstanz','worms','marburg','lüneburg','luneburg',
  'bayreuth','bamberg','paderborn','reutlingen','celle',
];
function hasGermany(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (t.includes('germany') || t.includes('deutschland')) return true;
  if (/\bde\b/.test(t)) return true;
  return GERMAN_CITIES.some(c => t.includes(c));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// 2000+ NEW COMPANY SLUGS (not in your existing configs)
// ─────────────────────────────────────────────────────────────────────────────
const companySlugs = [

  // ══════════════════════════════════════════════════════════════════════════
  //  1 — GERMAN-BORN TECH STARTUPS (Berlin)
  // ══════════════════════════════════════════════════════════════════════════
  'soundcloud','wooga','ada-health','adahealth',
  'infarm','tier-mobility','tiermobility','tier',
  'forto','solarisbank','solaris','mambu','raisin-ds',
  'pitch','babbel','blinkist','ecosia','komoot',
  'smava','auxmoney','billie','moonfare','finleap',
  'penta','vivid-money','vividmoney','agicap','moss','getmoss',
  'spendesk','commercetools','spryker','about-you','aboutyou',
  'flaconi','home24','westwing','trivago','hometogo',
  'flix','flixbus','flixmobility','door2door',
  'ionos','united-internet','strato','check24',
  'scout24','immobilienscout24','autoscout24','verivox',
  'idealo','ladenzeile','stylight','searchmetrics',
  'onefootball','clue','kry','doctolib','amboss','ottonova',
  'aleph-alpha','alephalpha','deepl','linguee','lengoo',
  'staffbase','contentbird','usercentrics','didomi',
  'appsflyer','braze','emarsys','bloomreach','optimizely',
  'fivetran','airbyte','hightouch','lightdash','preset',
  'metabase','thoughtspot','deposit-solutions','weltsparen',
  'liqid','ginmon','finanzguru','kontist','banxware','mondu',
  'exporo','companisto','creditshelf','sumup',
  'grover','rebuy','backmarket','refurbed','catawiki','vinted','momox',
  'inkitt','memorado','medbelle','numa','limehome','apaleo',
  'gastrofix','comtravo','navan','travelperk',
  'zeitgold','candis','circula','pleo','yokoy','payhawk',
  'kenjo','factorial','hibob','leapsome','peakon',
  'small-improvements','15five','betterworks','workpath','perdoo',
  'gtmhub','quantive','bunch','coachhub','sharpist','masterplan',
  'speexx','busuu','preply','italki','lingoda','chatterbug',
  'getir','cajoo','rohlik','knuspr','picnic','oda','bringmeister',
  'tonies','lovoo','mytheresa','outfittery',
  'kaia-health','mindable','selfapy',
  'neuroflash','writesonic','copy-ai',
  'wonder','hopin','airmeet','whova','hubilo',
  'locoia','make','tray-io','workato',
  'brevo','sendinblue','mailjet','rapidmail',
  'cross-engage','xtremepush',

  // ── Berlin Fintech ────────────────────────────────────────────────────────
  'wefox','clark','getsafe','friendsurance','heycar',
  'miles-mobility','share-now','sharenow',
  'nuri','bitwala','upvest','fundingcircle',
  'zinsbaustein','bergfuerst','elinvar','fincite',
  'investify','quirion','oskar','visualvest','whitebox',
  'lemon-markets','traderepublic','bitpanda','bsdex',
  'nextmarkets','naga',


  // ══════════════════════════════════════════════════════════════════════════
  //  2 — GERMAN TECH (Munich)
  // ══════════════════════════════════════════════════════════════════════════
  'siemens','siemens-energy','siemens-healthineers','brainlab',
  'prosiebensat1','prosiebensat1media','lilium',
  'isar-aerospace','isaraerospace','konux','tado','holidu',
  'egym','magazino','navvis','roboception','riskmethods',
  'atoss','softgarden','roadsurfer','freeletics',
  'idnow','authada','webid','veriff',
  'gini','sensape','twaice','proxima-solutions',
  'volocopter','wingcopter','quantum-systems','appliedai',
  'cariad','compredict','thinxnet','mobility-house',
  'has-to-be','chargepilot','sonnen','1komma5grad','1komma5',
  'enpal','thermondo','zolar','memodo','dz4',


  // ══════════════════════════════════════════════════════════════════════════
  //  3 — GERMAN TECH (Hamburg / Cologne / Others)
  // ══════════════════════════════════════════════════════════════════════════
  'otto','ottogroup','xing','new-work','newwork','kununu',
  'facelift','goodjobs','berenberg','warburg',
  'hapag-lloyd','hapagloyd','kuehne-nagel','kuehnenagel',
  'teamviewer','sap','sapcareers','sap-se',
  'concur','ariba','qualtrics',
  'bosch','boschjobs','boschrexroth',
  'continental','continental-ag',
  'daimler','mercedesbenz','mercedes','mercedes-benz',
  'bmw','bmwgroup','porsche','audi','porsche-digital',
  'volkswagen','vw','cariad','moia',
  'zf','zf-group','schaeffler','mahle','brose',
  'webasto','hella','knorr-bremse','knorrbremse',
  'infineon','infineontechnologies','carl-zeiss','zeiss',
  'trumpf','festo','sick','beckhoff','wago',
  'phoenix-contact','lapp','murrelektronik','turck',
  'endress-hauser','harting','weidmuller','rittal',
  'kuka','pilz','duerr','voith','gea',
  'heidelberger','manz','aixtron','suss-microtec',
  'henkel','beiersdorf','basf','bayer','bayercareers',
  'evonik','covestro','lanxess','wacker-chemie',
  'fresenius','fresenius-kabi','fresenius-medical-care',
  'merck-group','merckgroup',
  'thyssenkrupp','salzgitter-ag',
  'deutsche-bahn','deutschebahn',
  'deutsche-telekom','deutschetelekom','telekom','t-systems',
  'commerzbank','deutsche-bank','deutschebank',
  'allianz','munich-re','munichre','ergo',
  'hannover-re','talanx','hdi-group','signal-iduna',
  'gothaer','debeka','huk-coburg','lvm',
  'generali-de','axa-de','zurich-de',
  'dz-bank','dzbank','kfw','lbbw','helaba','bayernlb',

  // ── German Mittelstand (hidden champions) ─────────────────────────────────
  'wuerth','hilti','fischer','stihl','karcher',
  'miele','liebherr','claas','fendt','krones',
  'grob','chiron','dmg-mori','rational','brita',
  'ottobock','draeger','eppendorf','sartorius','biotronik',
  'b-braun','bbraun','hartmann','freudenberg','stabilus',
  'norma-group','normagroup','bechtle','cancom','computacenter',
  'sap-fioneer','sapfioneer','adesso','msg-group','allgeier',
  'gft','valantic','exxeta','ntt-data-de',
  'reply','sopra-steria','soprasteria',
  'bearing-point','bearingpoint','horvath',
  'simon-kucher','simonkucher','roland-berger','rolandberger',
  'porsche-consulting','porscheconsulting','mhp',


  // ══════════════════════════════════════════════════════════════════════════
  //  4 — BIG TECH WITH GERMANY ENGINEERING HUBS
  // ══════════════════════════════════════════════════════════════════════════
  'google','googlecareers','alphabet',
  'meta','metacareers','facebook',
  'apple','applecareers',
  'amazon','amazoncareers','aws',
  'microsoft','microsoftcareers',
  'netflix','netflixcareers',
  'spotify','spotifyjobs',
  'tiktok','bytedance','bytedancecareers',
  'snap','snapchat','snapinc',
  'uber','ubercareers',
  'lyft','salesforce','salesforcecareers',
  'oracle','oraclecareers',
  'ibm','ibmcareers',
  'dell','dellcareers',
  'hpe','hpecareers',
  'cisco','ciscocareers',
  'intel','intelcareers',
  'nvidia','nvidiacareers',
  'amd','amdcareers',
  'qualcomm','broadcom','broadcomcareers',
  'texas-instruments','ti',
  'arm','armcareers',
  'cadence','cadencecareers',
  'synopsys','synopsyscareers',
  'palantir','palantircareers',
  'servicenow','snowflakecomputing',
  'twilio','twiliocareers',
  'atlassian','atlassiancareers',
  'canva','canvacareers',
  'github','jetbrains',
  'snyk','snykcareers',
  'adyen','adyencareers',
  'klarna','klarnacom',
  'wise','wisecareers',
  'revolut','revolutcareers',
  'paypal','paypalcareers',
  'booking','bookingcareers','bookingcom',
  'tripadvisor','wayfair','wayfaircareers',

  // ── US Tech with known DE offices ─────────────────────────────────────────
  'discord','discordapp','slack',
  'retool','airplane',
  'planetscale','neon',
  'netlify','deno',
  'docker','dockercareers','rancher',
  'circleci','travisci',
  'jfrog','jfrogcareers','sonatype',
  'harness','split-io','flagsmith','configcat',
  'grafana','grafanalabs',
  'logzio','coralogix','chronosphere',
  'sentry','sentryio','rollbar','bugsnag',
  'pulumi','env0','spacelift','scalr',
  'cockroachdb','cockroachlabs','timescale','questdb',
  'clickhouse','duckdb','motherduck',
  'pinecone','weaviate','milvus','qdrant','chroma',
  'langchain','llamaindex',
  'wandb','neptune-ai','comet-ml',
  'roboflow','labelbox','v7labs',
  'scaleai','snorkelai','anyscale',
  'prefect','dagster','astronomer','mage-ai','kestra','windmill',
  'rudderstack','posthog','plausible','matomo','countly',
  'brex','ramp-com','airwallex','nium','rapyd','sofi','upstart',
  'chime','robinhood','coinbase','kraken','binance',
  'ripple','circle','fireblocks','chainalysis',
  'checkout','checkoutdotcom','mollie',


  // ══════════════════════════════════════════════════════════════════════════
  //  5 — EUROPEAN TECH (Germany presence)
  // ══════════════════════════════════════════════════════════════════════════
  'uipath','uipathcareers','endava','criteo',
  'dataiku','contentsquare','mirakl','algolia',
  'meilisearch','typesense',
  'storyblok','hygraph','sanity','strapi',
  'webflow','webflowcareers','framer','squarespace',
  'wix','wixcareers',
  'messagebird','sinch','plivo','vonage','infobip','bandwidth',
  'contentstack','philips','philipscareers',
  'ericsson','ericssoncareer','nokia','nokiacareers',
  'dhl','dhlcareers','deutsche-post','dp-dhl',
  'monzo','monzocareers','starling','starlingbank',
  'bunq','qonto',
  'transferwise','remitly','currencycloud',
  'coinbasecareers','krakencareers',
  'ripplecareers','circlecareers',
  'elliptic','bitpanda','bitgo',

  // ── Nordic / Benelux / Swiss ──────────────────────────────────────────────
  'king','kingcareers','supercell',
  'tink','anyfin','lunar','trustly','bambora','nets','nexi',
  'unity','unitycareers','kahoot','mentimeter',
  'tobii','peltarion','voi','einride','polestar',
  'northvolt','h2greensteel',
  'ikea','ikeacareers','hm','hmgroup',
  'randstad','randstadcareers','wolterskluwer',
  'dsv','dsvcareers','asml','asmlcareers',
  'nxp','nxpcareers','stmicro','stmicroelectronics',
  'signify','tomtom','here','heretechnologies',
  'achmea','aegon','nn-group','ing','ingcareers','rabobank',
  'abn-amro','abnamro','logitech','temenos','avaloq',
  'ubs','ubscareers','credit-suisse','creditsuisse',
  'swisscom','nestle','nestlecareers',
  'roche','rochecareers','novartis','novartiscareers',
  'abb','abbcareers','schneider-electric','schneiderelectric',
  'holcim','holcimcareers',

  // ── French Tech ───────────────────────────────────────────────────────────
  'ovhcloud','ovh','scaleway',
  'alan','deezer','dailymotion','blablacar','voodoo',
  'ubisoft','ubicareers','gameloft',
  'capgemini-careers','atos-careers',
  'thales','thalescareers','airbus','airbuscareers',
  'safran','dassault','dassaultsystemes',
  'michelin','michelincareers','totalenergies',
  'bnpparibas','societegenerale','axa','axacareers',
  'lvmh','hermes','kering','loreal','lorealcareers',
  'danone','pernod-ricard',
  'sanofi','sanofigenzyme',

  // ── UK Tech ───────────────────────────────────────────────────────────────
  'deliveroo','just-eat','improbable','darktrace','graphcore',
  'imagination-technologies','sophos','sophoscareers',
  'bae','baesystems','rolls-royce','rollsroyce',
  'vodafone','vodafonecareers','bt','btcareers',
  'hsbc','hsbccareers','barclays','standard-chartered',
  'unilever','reckitt','diageo','gsk','gskcareers',
  'astrazeneca','astrazenecacareers',
  'pearson','pearsoncareers','relx','relxgroup','elsevier',
  'informa','informacareers','springer-nature','springernature',
  'experian','experiancareers',


  // ══════════════════════════════════════════════════════════════════════════
  //  6 — CONSULTING / PROFESSIONAL SERVICES
  // ══════════════════════════════════════════════════════════════════════════
  'mckinsey','mckinseycareers','bcg','bostonconsulting',
  'bain','bainandcompany',
  'deloitte','deloitteus','deloitteglobal',
  'ey','eyglobal','eycareers',
  'pwc','pwcglobal','pwccareers',
  'kpmg','kpmgglobal','kpmgcareers',
  'accenture','accenturecareers',
  'capgemini','capgeminicareer',
  'cognizant','cognizantcareers',
  'dxctechnology','dxc','atos','atoscareers',
  'nttdata','ntt','fujitsu',
  'genpact','concentrix','teleperformance',
  'oliver-wyman','oliverwyman',
  'strategy-and','strategyand',
  'thoughtworks','thoughtworkscareers',
  'epam','epamlabs','globant','globantcareers',
  'luxoft',


  // ══════════════════════════════════════════════════════════════════════════
  //  7 — BANKING / FINANCE / INSURANCE (Germany)
  // ══════════════════════════════════════════════════════════════════════════
  'goldmansachs','gs','morganstanley','jpmorgan','jpmc',
  'citigroup','citi','ubs-careers',
  'blackrock','vanguard','statestreet',
  'fidelity','fidelitycareers','invesco','amundi','dws','dws-group',
  'union-investment','visa','visacareers',
  'mastercard','mastercardcareers',
  'zurich','zurichinsurance','generali',
  'swiss-re','swissre',
  'fiserv','fis','fisglobal','globalpayments','worldpay',


  // ══════════════════════════════════════════════════════════════════════════
  //  8 — HEALTHCARE / PHARMA / BIOTECH
  // ══════════════════════════════════════════════════════════════════════════
  'boehringer','boehringeringelheim',
  'pfizer','pfizercareers',
  'johnson-johnson','jnj','jnjcareers',
  'abbvie','abbviecareers','amgen','amgencareers',
  'stryker','strykercareers','medtronic','medtroniccareers',
  'biotest','miltenyi','miltenyi-biotec',
  'evotec','curevac','biontech',
  'immatics','tubulis','atheneum',
  'certara','veeva','veevasystems',
  'iqvia','iqviacareers',
  'ottobock','draeger','eppendorf',
  'qiagen','eurofins','illumina','thermo-fisher',
  'danaher','agilent','waters','bruker','hamilton',


  // ══════════════════════════════════════════════════════════════════════════
  //  9 — AUTOMOTIVE / MANUFACTURING / INDUSTRIAL
  // ══════════════════════════════════════════════════════════════════════════
  'man','man-truck','daimler-truck','daimlertruck','traton',
  'fanuc','yaskawa','mitsubishi-electric',
  'keyence','omron','sew-eurodrive',
  'honeywell','honeywellcareers',
  'emerson','emersoncareers',
  'ge','gecareers','gevernova',
  'caterpillar','cat','deere','johndeere',
  'rockwell','rockwellautomation',
  'linde','ecolab','dupont','dow',
  '3m','3mcareers','saint-gobain','knauf',
  'heidelbergcement','heidelberg-materials',
  'air-liquide',


  // ══════════════════════════════════════════════════════════════════════════
  //  10 — LOGISTICS / MOBILITY / ENERGY
  // ══════════════════════════════════════════════════════════════════════════
  'dpd','gls','hermes','db-schenker','schenker',
  'hellmann','rhenus','dachser',
  'maersk','maerskcareer',
  'eon','rwe','enbw','vattenfall','uniper','wintershall',
  'vestas','vestascareers','nordex','enercon',
  'sunfire','h2-green-steel','thyssenkrupp-nucera',
  'sixt','free-now','freenow','mytaxi',
  'bolt-eu','lime',


  // ══════════════════════════════════════════════════════════════════════════
  //  11 — RETAIL / ECOMMERCE / CONSUMER
  // ══════════════════════════════════════════════════════════════════════════
  'lidl','schwarz-group','schwarzgroup','kaufland',
  'aldi','aldi-sued','aldi-nord',
  'rewe','rewe-digital','metro','metroag',
  'adidas','adidascareers','puma','pumacareers',
  'hugo-boss','hugoboss','birkenstock',
  'douglas','dm-drogerie','rossmann',
  'mediamarkt','saturn','ceconomy',
  'thomann','teufel','lieferando','just-eat-de',
  'takeaway','deliveroo-de','wolt-de','foodpanda',


  // ══════════════════════════════════════════════════════════════════════════
  //  12 — AI / DEEPTECH / CYBERSECURITY / DEFENSE / SPACE
  // ══════════════════════════════════════════════════════════════════════════
  'helsing','helsing-ai',
  'isar-aerospace-careers','volocopter-careers',
  'lilium-careers','wingcopter-careers',
  'twentybn','merantix',
  'twaice-careers','1komma5-careers',
  'envelio','gridx','octopus-energy','octopusenergy',
  'sentinelone','cyberark','sailpoint',
  'crowdstrike','zscaler','paloaltonetworks','paloalto',
  'fortinet','fortinetcareers',
  'checkpoint','checkpointsw',
  'proofpoint','mimecast','tanium',
  'rapid7','qualys','tenable','beyondtrust',
  'rohde-schwarz','rohdeschwarz','secunet',
  'genua','dracoon','myra-security','myrasecurity',
  'f5','rheinmetall','hensoldt','diehl',


  // ══════════════════════════════════════════════════════════════════════════
  //  13 — MEDIA / GAMING / EDUCATION
  // ══════════════════════════════════════════════════════════════════════════
  'axel-springer','axelspringer','springer-nature-de',
  'bertelsmann','rtl-group','rtlgroup',
  'prosiebensat1-careers','zeit-online','spiegel','handelsblatt',
  'wooga-careers','innogames','goodgame','bigpoint','crytek',
  'ea','electronicarts','riot','riotgames',
  'epic','epicgames','unity-careers',
  'coursera','udemy','pluralsight',
  'duolingo','duolingocareers','babbel-careers',
  'blinkist-careers','studysmarter','brainly','sofatutor',
  'cornelsen','klett','westermann',
  'springer','wiley','elsevier-careers',
  'pearson-careers','mcgrawhill',


  // ══════════════════════════════════════════════════════════════════════════
  //  14 — TELECOM / REAL ESTATE / TRAVEL
  // ══════════════════════════════════════════════════════════════════════════
  'telefonica-de','o2-de','freenet','1und1','drillisch','congstar',
  'cbre','cbrecareers','jll','jllcareers',
  'cushmanwakefield','colliers','brookfield',
  'wework','procore','autodesk','autodeskcareers',
  'vonovia','deutsche-wohnen','leg-immobilien',
  'tui','lufthansa','eurowings','swiss-air','austrian',
  'fraport','condor','trivago-careers','hometogo-careers',
  'getyourguide-careers','musement','tiqets','klook',


  // ══════════════════════════════════════════════════════════════════════════
  //  15 — MORE INTERNATIONAL (known to hire in Germany)
  // ══════════════════════════════════════════════════════════════════════════
  'vmware','vmwarecareers','redhat','redhatcareers',
  'suse','susecareers','canonical','canonicalcareers',
  'sonarsource','veracode','checkmarx','mend','whitesource',
  'stackoverflow','stackoverflowcareers','hashnode',
  'ferrero','ferrerocareers','mars','marsinc',
  'mondelez','kraft-heinz','kraftheinz',
  'colgate','colgatepalmolive','procter-gamble','pg',
  'heineken','heinekencareers','diageo-de',
  'pirelli','bridgestone','goodyear','goodyearcareers',
  'michelin-de','continental-tires',
  'mtu','mtu-aeroengines','rheinmetall-careers',
  'saab','saabcareers','dassault-de',
  'imec','osram','ams-osram',
  'garmin','trimble','trimblecareers',
  'hexagon','leica','leica-geosystems',
  'bosch-rexroth','siemens-ag',
  'nord-drivesystems','sew-de',
  'wuerth-careers','hilti-careers','fischer-careers',
  'stihl-careers','karcher-careers','miele-careers',
  'liebherr-careers','claas-careers',
  'sartorius-careers','ottobock-careers','draeger-careers',
  'qiagen-careers','eurofins-careers',
  'bechtle-careers','cancom-careers','computacenter-careers',
  'adesso-careers','msg-careers','gft-careers',
  'valantic-careers','exxeta-careers',

  // ── More SaaS / DevTools ──────────────────────────────────────────────────
  'linear-careers','height-app','clickup','monday','mondaydotcom',
  'smartsheet','wrike','pipedrive','freshworks','freshworkscareers',
  'teamwork','basecamp','loom','loomcareers',
  'coda','typeform','typeformcareers','surveymonkey',
  'hotjar','hotjarcareers','fullstory','heap',
  'braze-careers','iterable','klaviyo',
  'sendgrid','mailchimp','mailgun',
  'twilio-segment','customer-io',
  'zuora','veeva-careers','coupa','anaplan','workday','workiva',

  // ── More Cloud / Infra ────────────────────────────────────────────────────
  'digitalocean','rackspace','linode','akamai',
  'fastly','cloudflare-careers','vercel-careers',
  'fly-io','render','railway',
  'supabase-careers','planetscale-careers','neon-careers',
  'upstash','redis','memcached',
  'confluent-careers','rabbitmq','solace',
  'elastic-careers','opensearch','opensearchproject',
  'grafana-careers','prometheus','victoriametrics',

  // ── More Fintech ──────────────────────────────────────────────────────────
  'plaid','plaidcareers','marqeta','marqetacareers',
  'affirm','affirmcareers','afterpay','zip-co',
  'sofi-careers','upstart-careers','lending-club',
  'n26-careers','revolut-careers','monzo-careers',
  'wise-careers','transferwise-careers',
  'adyen-careers','stripe-careers',
  'checkout-careers','mollie-careers',
  'sumup-careers','zettle','izettle',
  'billdotcom','bill','tipalti',
  'rapyd-careers','airwallex-careers','nium-careers',
  'deposit-solutions-careers','raisin-careers',
  'solaris-careers','mambu-careers',
  'thought-machine','10x-banking','temenos-careers',
  'finastra','finastra-careers','misys',
  'fis-careers','fiserv-careers','worldpay-careers',

  // ── More E-commerce / Marketplace ─────────────────────────────────────────
  'shopify-careers','bigcommerce','magento','adobe-commerce',
  'spryker-careers','commercetools-careers',
  'contentful-careers','storyblok-careers',
  'algolia-careers','constructor-io','bloomreach-careers',
  'emarsys-careers','ometria','dotdigital',
  'zenloop','medallia','qualtrics-careers',
  'trustpilot','trustpilot-careers','bazaarvoice',
  'yotpo','reviews-io','stamped',
  'shippo','easypost','parcellab',
  'sendcloud','seven-senders','sevensenders',
  'parcel-perform','aftership',

  // ── More HR / Recruiting Tech ─────────────────────────────────────────────
  'personio-careers','factorial-careers','hibob-careers',
  'kenjo-careers','leapsome-careers','culture-amp','cultureamp',
  'lattice-careers','15five-careers','betterworks-careers',
  'workday-careers','sap-successfactors','successfactors',
  'cornerstone','cornerstoneondemand','talentsoft',
  'smartrecruiters','greenhouse-careers','lever-careers',
  'ashby-careers','gem-careers','beamery',
  'eightfold','eightfold-ai','phenom','phenompeople',
  'hirebridge','iceims','jobvite',
  'recruitee','teamtailor','breezy-hr','breezyhr',
  'join-com','join','softgarden-careers',
  'persio','rexx-systems','umantis',
  'haufe-group','haufe','sage','sage-careers',
  'datev','datev-careers','lexware','lexoffice',
  'sevdesk','debitoor','fastbill','billomat',
  'paychex','paychexcareers','adp','adpcareers',
  'workday-de','sap-hr',

  // ══════════════════════════════════════════════════════════════════════════
  //  16 — ADDITIONAL GERMAN COMPANIES (Mittelstand / Scale-ups)
  // ══════════════════════════════════════════════════════════════════════════
  'triverna','konux-careers','riskmethods-careers',
  'celonis-careers','signavio-careers','sap-signavio',
  'hybris-careers','sap-hybris','sap-concur',
  'erpfy','scopevisio','weclapp','xentral','actindo',
  'pimcore','akeneo','salsify','syndigo',
  'minubo','econda','webtrekk','etracker',
  'intelliad','adtriba','exactag','appsflyer-de',
  'adjust-careers','singular','branch','kochava',
  'flixmobility-careers','tier-careers','share-now-careers',
  'miles-careers','sixt-careers','freenow-careers',
  'celonis-munich','personio-munich','sennder-berlin',
  'n26-berlin','trade-republic-berlin',
  'agora','agora-digital','fincompare','finanzcheck',
  'verivox-careers','check24-careers','scout24-careers',
  'immowelt','meinestadt','stepstone','stepstone-de',
  'indeed-de','glassdoor-de','xing-careers','linkedin-de',
  'kununu-careers','lovoo-careers','parship','elitepartner',
  'scout24-group','friendscout24','autoscout24-careers',
  'mobile-de','car-one','wirkaufendeinauto','autohero',
  'carvago','carwow','heycar-careers',

  // ── More German Enterprise Software ───────────────────────────────────────
  'software-ag','softwareag','ifs','ifs-careers',
  'nemetschek','nemetschek-group','allplan','vectorworks',
  'graphisoft','bluebeam','maxon','redshift',
  'think-cell','thinkcell','celonis-data','informatica-de',
  'exasol','crate-io','cratedb','cockroach-de',
  'sap-analytics','sap-datasphere','sap-btp',
  'servicenow-de','salesforce-de','oracle-de',
  'micro-focus','microfocus','opentext','opentext-de',
  'symantec-de','broadcom-de','vmware-de',
  'citrix','citrix-de','parallels',
  'teamviewer-careers','anydesk','remote-desktop',
  'matrix42','baramundi','empirum',
  'docuware','d-velop','dvelop','windream',
  'datev-group','agenda-software','addison',
  'lexbizz','haufe-lexware','buhl',

  // ── German Digital Health ─────────────────────────────────────────────────
  'ada-health-careers','clue-careers','kaia-health-careers',
  'teleclinic','kry-de','doctolib-de',
  'ottonova-careers','alley','vivy',
  'caresyntax','brainlab-de','intraoperative',
  'amboss-careers','via-medici','thieme',
  'elsevier-health','springer-medizin',
  'siemens-healthineers-de','ge-healthcare','ge-healthcare-de',
  'philips-health-de','medtronic-de',
  'stryker-de','smith-nephew','smithnephew',
  'zimmer-biomet','zimmerbiomet','aesculap',

  // ── German PropTech / ConTech ─────────────────────────────────────────────
  'scout24-immobilien','immo-scout','mcmakler',
  'homeday','maklaro','scoperty','propstack',
  'planradar','123erfasst','capmo','bluebeam-de',
  'procore-de','autodesk-de','bentley','bentley-systems',
  'nemetschek-de','graphisoft-de','archicad',
  'tekla','trimble-de','hexagon-de',

  // ── More German Mobility / Transport ──────────────────────────────────────
  'deutsche-bahn-careers','db-systel','db-netz',
  'db-cargo','db-fernverkehr','db-regio',
  'transdev','transdev-de','abellio',
  'flixbus-tech','flixmobility-tech',
  'continental-automotive-de','zf-tech','schaeffler-tech',
  'bosch-mobility','denso-de','aptiv-de',
  'lear-de','magna-de','continental-engineering',
  'cariad-tech','etas-de','argo-ai-de',
  'fernride-de','einride-de','ottobock-mobility',

  // ══════════════════════════════════════════════════════════════════════════
  //  17 — MORE US COMPANIES WITH GERMANY OFFICES
  // ══════════════════════════════════════════════════════════════════════════
  'workday-careers','anaplan-careers','coupa-careers',
  'zuora-careers','veeva-de','veevacareers',
  'servicenow-careers-de','snowflake-de','databricks-de',
  'confluent-de','hashicorp-de','elastic-de',
  'mongodb-de','okta-de','zendesk-de',
  'hubspot-de','intercom-de','twilio-de',
  'pagerduty-de','splunk-de','dynatrace-de',
  'new-relic-de','sumo-logic-de',
  'datadog-de','launchdarkly-de','amplitude-de',
  'mixpanel-de','segment-de','braze-de',
  'customer-io-de','iterable-de','klaviyo-de',
  'mailchimp-de','sendgrid-de',
  'docusign-de','dropbox-de','box','box-de',
  'zoom','zoomvideo','zoom-de',
  'slack-de','teams','webex','goto',
  'monday-de','asana-de','clickup-de',
  'wrike-de','smartsheet-de',
  'figma-de','miro-de','canva-de',
  'notion-de','coda-de','airtable-de',
  'github-de','gitlab-de','bitbucket-de',
  'jira','confluence','trello',
  'circleci-de','jenkins','bamboo',
  'docker-de','kubernetes','rancher-de',
  'terraform-de','ansible','puppet','chef',

  // ── More US Enterprise (Fortune 500 with DE offices) ──────────────────────
  'procter-gamble-de','unilever-de','nestle-de-careers',
  'johnson-controls','johnsoncontrols','jci-de',
  'carrier','carrierglobal','carrier-de',
  'otis','otisworldwide','otis-de',
  'united-technologies','raytheon','rtx','rtx-de',
  'lockheedmartin','lockheed-de',
  'northropgrumman','northrop-de',
  'general-dynamics','generaldynamics','gdels',
  'l3harris','l3harris-de',
  'leidos','leidos-de','saic','saic-de',
  'caci','caci-de','parsons','parsons-de',
  'jacobs','jacobscareers','jacobs-de',
  'aecom','aecom-de','fluor','fluor-de',
  'kbr','kbr-de','serco','serco-de',
  'abbott','abbottglobal','abbott-de',
  'baxter','baxter-de','becton','bd','bd-de',
  'edwards','edwardslifesciences','edwards-de',
  'bostonscientific','boston-scientific-de',
  'intuitive','intuitivesurgical','intuitive-de',
  'hologic','hologic-de',
  'zimmer-de','zimmer-biomet-de',
  'thermofisher','thermofishercareers','thermo-fisher-de',
  'danaher-de','agilent-de','waters-de',
  'perkinelmer','revvity','revvity-de',
  'bruker-de','mettler-toledo','mettler-de',

  // ══════════════════════════════════════════════════════════════════════════
  //  18 — MORE EUROPEAN (various sectors, DE presence)
  // ══════════════════════════════════════════════════════════════════════════
  'sap-ariba','sap-fieldglass','sap-litmos',
  'celonis-process','uipath-de','automation-anywhere',
  'blue-prism','blueprism','nice','nice-systems',
  'genesys','genesys-de','five9','five9-de',
  'talkdesk','talkdesk-de','vonage-de',
  'ringcentral','ringcentral-de','8x8',
  'mitel','mitel-de','unify','atos-unify',
  'siemens-comm','siemens-enterprise',
  'ntt-communications','ntt-de',
  'orange','orange-de','telefonica','o2',
  'vodafone-ziggo','liberty-global','liberty-de',
  'sky','sky-de','sky-deutschland',
  'disney','disneycareers','disney-de',
  'nbcuniversal','nbcuni-de','warner','wbd','wbd-de',
  'paramount','paramount-de','sony-pictures','sony-de',
  'bertelsmann-careers','rtl-careers',
  'springer-careers','axel-springer-careers',
  'ringier','tamedia','nzz',
  'schibsted','schibsted-de','adevinta','adevinta-de',
  'ebay','ebay-de','ebay-kleinanzeigen','kleinanzeigen',
  'willhaben','marktplaats','leboncoin',
  'scout24-classifieds','autoscout-careers',

  // ── More Insurance / Reinsurance ──────────────────────────────────────────
  'swiss-life','swiss-life-de','axa-de-careers',
  'allianz-technology','allianz-tech',
  'munich-re-tech','munichre-digital',
  'ergo-digital','ergo-technology',
  'signal-iduna-careers','gothaer-careers',
  'huk-coburg-careers','debeka-careers',
  'wuerttembergische-careers','alte-leipziger-careers',
  'nuernberger-careers','continentale','continentale-de',
  'barmenia','barmenia-de','concordia','concordia-de',
  'interrisk','nv-de','stuttgarter','stuttgarter-de',
  'volkswohl-bund','volkswohl','vhv','vhv-de',
  'provinzial','provinzial-de','sparkassen-versicherung',
  'sv-versicherung','wgv','mecklenburgische',
  'lvm-careers','devk','devk-careers',
  'cosmos','cosmos-direkt','cosmosdirekt',
  'check24-versicherung','clark-careers',
  'wefox-careers','getsafe-careers','friendsurance-careers',
  'ottonova-de','friday','friday-de','element','element-de',

  // ── German Public Sector IT / Research ────────────────────────────────────
  'fraunhofer','fraunhofer-de','max-planck','mpg',
  'helmholtz','helmholtz-de','leibniz','leibniz-de',
  'dlr','dlr-careers','esa','esa-careers',
  'bwi','bwi-de','bundeswehr-it',
  'dataport','dataport-de','it-nrw','it-bw',
  'mgm-technology','msg-systems','msg-de',
  'init','init-de','hhla','hhla-de',
  'fraport-careers','flughafen-frankfurt',
  'berliner-wasserbetriebe','bwb','stadtwerke',
  'enbw-digital','rwe-digital','eon-digital',
  'siemens-digital-industries','siemens-xcelerator',

  // ── More Niche German Tech ────────────────────────────────────────────────
  'celonis-ai','sap-business-ai','merantix-ai',
  'twenty-first','42-technologies','42tech',
  'quantco','quantco-de','ai-squad',
  'deepset','deepset-ai','haystack',
  'kern-ai','kern','labelstud','labelstudio',
  'lightly','lightly-ai','v7','v7-de',
  'understand-ai','scale-de','surge-ai',
  'mostly-ai','mostly','synthetic-data',
  'statice','aircloak','privitar',
  'camunda','camunda-de','zeebe',
  'signavio-process','celonis-ems',
  'minit','lana-labs','lanalabs',
  'process-gold','aris','software-ag-aris',
  'abbyy','abbyy-de','kofax','kofax-de',
  'uipath-de-careers','automation-hero',
  'workfusion','workfusion-de',
  'parlamind','cognigy','cognigy-de',
  'rasa','rasa-de','botfriends','e-bot7',
  'parloa','parloa-de','solvemate',
  'hundertmark','novomind','bsi-software',
  'sap-cx','emarsys-sap-de','qualtrics-de',
  'medallia-de','forsta','confirmit',
  'zenloop-de','usabilla','mopinion',
  'hotjar-de','contentsquare-de',
  'dynamic-yield-de','monetate','evergage',
  'kameleoon','ab-tasty','optimizely-de',
  'amplitude-de-careers','heap-de','pendo','pendo-de',
  'gainsight','gainsight-de','totango',
  'planhat','planhat-de','custify',
  'churnzero','churnzero-de','vitally',

  // ── Final batch: more DE-hiring companies ─────────────────────────────────
  'delivery-hero-tech','about-you-tech','otto-tech','rewe-group',
  'siemens-advanta','siemens-mobility','siemens-smart-infra',
  'eon-se','rwe-supply','vattenfall-de',
  'telekom-de','telekom-it','t-mobile-de',
  'commerzbank-tech','dz-bank-it','sparkasse',
  'allianz-se','allianz-direct','ergo-group',
  'munich-re-group','hannover-rueck','talanx-group',
  'deka','deka-bank','dekabank',
  'union-invest-de','helaba-invest',
  'porsche-se','vw-group','audi-ag','bmw-ag',
  'daimler-ag','mercedes-eq','smart-eq',
  'continental-group','bosch-group','zf-friedrichshafen',
  'thyssenkrupp-ag','salzgitter','voith-de',
  'peri','peri-group','bilfinger','bilfinger-de',
  'hochtief','strabag','strabag-de','goldbeck',
  'implenia','max-boegl','porr',
];




// ─────────────────────────────────────────────────────────────────────────────
// ATS API Testers
// ─────────────────────────────────────────────────────────────────────────────

async function testGreenhouse(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.jobs || !Array.isArray(data.jobs) || data.jobs.length === 0) return null;
    const total = data.jobs.length;
    const germanyJobs = data.jobs.filter(j => hasGermany(j.location?.name));
    if (germanyJobs.length === 0) return null;
    return { ats: 'greenhouse', slug, total, germany: germanyJobs.length,
      sampleJobs: germanyJobs.slice(0, 3).map(j => ({ title: j.title, location: j.location?.name || 'N/A' })),
      url: `https://boards.greenhouse.io/${slug}` };
  } catch { clearTimeout(tid); return null; }
}

async function testAshby(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.jobs || !Array.isArray(data.jobs) || data.jobs.length === 0) return null;
    const total = data.jobs.length;
    const germanyJobs = data.jobs.filter(j => {
      if (hasGermany(j.location)) return true;
      if (j.address?.postalAddress?.addressCountry) {
        const c = j.address.postalAddress.addressCountry.toLowerCase();
        if (c === 'germany' || c === 'deutschland' || c === 'de' || c === 'deu') return true;
      }
      if (j.secondaryLocations?.length > 0) {
        for (const sec of j.secondaryLocations) {
          if (hasGermany(sec.location)) return true;
          if (sec.address?.addressCountry) {
            const c2 = sec.address.addressCountry.toLowerCase();
            if (c2 === 'germany' || c2 === 'deutschland' || c2 === 'de' || c2 === 'deu') return true;
          }
        }
      }
      return false;
    });
    if (germanyJobs.length === 0) return null;
    return { ats: 'ashby', slug, total, germany: germanyJobs.length,
      sampleJobs: germanyJobs.slice(0, 3).map(j => ({ title: j.title, location: j.location || 'N/A' })),
      url: `https://jobs.ashbyhq.com/${slug}` };
  } catch { clearTimeout(tid); return null; }
}

async function testLever(slug) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const total = data.length;
    const germanyJobs = data.filter(j => {
      if (j.country) {
        const cc = j.country.toLowerCase().trim();
        if (cc === 'de' || cc === 'deu') return true;
        if (cc && cc !== 'de' && cc !== 'deu') return false;
      }
      if (hasGermany(j.categories?.location)) return true;
      if (j.categories?.allLocations?.length > 0) {
        for (const loc of j.categories.allLocations) { if (hasGermany(loc)) return true; }
      }
      return false;
    });
    if (germanyJobs.length === 0) return null;
    return { ats: 'lever', slug, total, germany: germanyJobs.length,
      sampleJobs: germanyJobs.slice(0, 3).map(j => ({ title: j.text || 'Untitled', location: j.categories?.location || 'N/A' })),
      url: `https://jobs.lever.co/${slug}` };
  } catch { clearTimeout(tid); return null; }
}

async function testSlug(slug) {
  const results = [];
  const [gh, ash, lev] = await Promise.all([
    testGreenhouse(slug.toLowerCase()),
    testAshby(slug),
    testLever(slug.toLowerCase()),
  ]);
  if (gh) results.push(gh);
  if (ash) results.push(ash);
  if (lev) results.push(lev);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const rawUnique = [...new Set(companySlugs)];
  const uniqueSlugs = rawUnique.filter(s => !isExisting(s));
  const skipped = rawUnique.length - uniqueSlugs.length;
  const startTime = Date.now();

  console.log(`\n🔍 GERMANY ATS DISCOVERY — Testing ${uniqueSlugs.length} NEW slugs`);
  console.log(`   Skipped ${skipped} already in your configs`);
  console.log(`   Platforms: Greenhouse, Ashby, Lever | Concurrency: ${CONCURRENCY}\n`);

  const allFound = { greenhouse: [], ashby: [], lever: [] };
  let tested = 0;

  for (let i = 0; i < uniqueSlugs.length; i += CONCURRENCY) {
    const batch = uniqueSlugs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(testSlug));
    for (const results of batchResults) {
      for (const r of results) {
        allFound[r.ats].push(r);
        console.log(`  ✅ [${r.ats.toUpperCase()}] ${r.slug}: ${r.germany} Germany / ${r.total} total`);
      }
    }
    tested = Math.min(i + CONCURRENCY, uniqueSlugs.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(`\r  [${tested}/${uniqueSlugs.length}] ${elapsed}s | GH: ${allFound.greenhouse.length} | Ashby: ${allFound.ashby.length} | Lever: ${allFound.lever.length}   `);
    if (i + CONCURRENCY < uniqueSlugs.length) await sleep(BATCH_DELAY_MS);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalFound = allFound.greenhouse.length + allFound.ashby.length + allFound.lever.length;

  console.log(`\n\n${'═'.repeat(80)}`);
  console.log(`📊 GERMANY ATS DISCOVERY RESULTS (${totalTime}s)`);
  console.log(`   ${uniqueSlugs.length} NEW slugs tested | ${totalFound} boards with Germany jobs`);
  console.log(`   Greenhouse: ${allFound.greenhouse.length} | Ashby: ${allFound.ashby.length} | Lever: ${allFound.lever.length}`);
  console.log(`${'═'.repeat(80)}`);

  for (const [platform, label, configKey] of [
    ['greenhouse', '🌿 GREENHOUSE', 'companyBoardTokens'],
    ['ashby', '💼 ASHBY', 'companyBoardNames'],
    ['lever', '🔧 LEVER', 'companySiteNames'],
  ]) {
    if (allFound[platform].length === 0) continue;
    const sorted = [...allFound[platform]].sort((a, b) => b.germany - a.germany);
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`${label} — NEW BOARDS (${sorted.length}) → add to ${configKey}:`);
    console.log(`${'─'.repeat(80)}`);
    for (const r of sorted) {
      const pad = ' '.repeat(Math.max(1, 30 - r.slug.length));
      console.log(`  ${r.slug}${pad}🇩🇪 ${String(r.germany).padStart(4)} Germany / ${r.total} total`);
    }
    console.log(`\n// ── COPY-PASTE for ${configKey} ──`);
    for (const r of sorted) {
      console.log(`'${r.slug}',${' '.repeat(Math.max(1, 28 - r.slug.length))}// ${r.germany} DE / ${r.total} total`);
    }
  }

  const allResults = [...allFound.greenhouse, ...allFound.ashby, ...allFound.lever].sort((a, b) => b.germany - a.germany);
  if (allResults.length > 0) {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🔍 SAMPLE GERMANY JOBS (top 30, 3 each):`);
    console.log(`${'═'.repeat(80)}`);
    for (const r of allResults.slice(0, 30)) {
      console.log(`\n  📌 [${r.ats.toUpperCase()}] ${r.slug} — ${r.germany} Germany jobs:`);
      for (const j of r.sampleJobs) console.log(`     • ${j.title}\n       ${j.location}`);
    }
  }

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 FINAL SUMMARY`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`  New slugs tested:   ${uniqueSlugs.length}`);
  console.log(`  Skipped (existing): ${skipped}`);
  console.log(`  Boards found:       ${totalFound}`);
  console.log(`  ├── Greenhouse:     ${allFound.greenhouse.length} (${allFound.greenhouse.reduce((s, r) => s + r.germany, 0)} Germany jobs)`);
  console.log(`  ├── Ashby:          ${allFound.ashby.length} (${allFound.ashby.reduce((s, r) => s + r.germany, 0)} Germany jobs)`);
  console.log(`  └── Lever:          ${allFound.lever.length} (${allFound.lever.reduce((s, r) => s + r.germany, 0)} Germany jobs)`);
  console.log(`  Total Germany jobs: ${allResults.reduce((s, r) => s + r.germany, 0)}`);
  console.log(`  Time:               ${totalTime}s`);
  console.log(`${'═'.repeat(80)}\n`);
}

main();