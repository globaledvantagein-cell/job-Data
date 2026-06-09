// Banned Roles (Noise Filter) - Keep this strict
export const BANNED_ROLES = [
    "intern", "internship", "werkstudent", "werkstudentin", 
    "working student", "student assistant", "studentische hilfskraft",
    "ausbildung", "trainee", "duales studium", "apprentice", "apprenticeship",
    "filialleiter", "filialleitung", "store manager", "shop manager", 
    "verke4ufer", "sales assistant", "cashier",
    "zeitarbeit", "leiharbeit", "phd thesis", "master thesis", "bachelor thesis"
];





export const GERMAN_CITIES_CHECK = [
    // Major cities (top 80 by population)
    'berlin', 'hamburg', 'munich', 'münchen', 'cologne', 'köln',
    'frankfurt', 'stuttgart', 'düsseldorf', 'dusseldorf', 'leipzig',
    'dortmund', 'essen', 'bremen', 'dresden', 'hannover', 'hanover',
    'nuremberg', 'nürnberg', 'duisburg', 'bochum', 'wuppertal',
    'bielefeld', 'bonn', 'münster', 'munster', 'karlsruhe', 'mannheim',
    'augsburg', 'wiesbaden', 'mönchengladbach', 'gelsenkirchen',
    'braunschweig', 'aachen', 'kiel', 'chemnitz', 'halle',
    'magdeburg', 'freiburg', 'krefeld', 'lübeck', 'lubeck',
    'oberhausen', 'erfurt', 'mainz', 'rostock', 'kassel', 'hagen',
    'potsdam', 'saarbrücken', 'saarbrucken', 'hamm', 'ludwigshafen',
    'leverkusen', 'oldenburg', 'osnabrück', 'osnabruck', 'solingen',
    'heidelberg', 'darmstadt', 'regensburg', 'ingolstadt', 'würzburg',
    'wurzburg', 'wolfsburg', 'göttingen', 'gottingen', 'recklinghausen',
    'heilbronn', 'ulm', 'pforzheim', 'offenbach', 'bottrop', 'trier',
    'jena', 'cottbus', 'siegen', 'hildesheim', 'salzgitter',

    // Mid-size cities (population 30k–100k)
    'gütersloh', 'gutersloh', 'iserlohn', 'schwerin', 'koblenz',
    'zwickau', 'witten', 'gera', 'hanau', 'esslingen', 'ludwigsburg',
    'tübingen', 'tubingen', 'flensburg', 'konstanz', 'worms',
    'marburg', 'lüneburg', 'luneburg', 'bayreuth', 'bamberg',
    'plauen', 'neubrandenburg', 'wilhelmshaven', 'paderborn',
    'reutlingen', 'neuss', 'passau', 'landshut', 'rosenheim',
    'kaiserslautern', 'giessen', 'gießen', 'fulda', 'weimar',
    'dessau', 'celle', 'detmold', 'schwäbisch gmünd', 'ravensburg',
    'friedrichshafen', 'villingen-schwenningen', 'sindelfingen',
    'böblingen', 'leonberg', 'norderstedt', 'delmenhorst',
    'neumünster', 'neustadt', 'herford', 'minden', 'arnsberg',
    'lüdenscheid', 'unna', 'bergisch gladbach', 'troisdorf',
    'euskirchen', 'dormagen', 'grevenbroich', 'meerbusch',
    'ratingen', 'velbert', 'mettmann', 'langenfeld', 'monheim',
    'hürth', 'kerpen', 'brühl', 'erftstadt', 'frechen',
    'pulheim', 'bergheim', 'hennef', 'sankt augustin', 'bad honnef',
    'königswinter', 'bornheim', 'meckenheim', 'rheinbach',

    // Tech/industry hub towns
    'ottobrunn', 'garching', 'walldorf', 'feldkirchen', 'unterschleissheim',
    'unterhaching', 'ismaning', 'pullach', 'grünwald', 'grasbrunn',
    'haar', 'kirchheim', 'penzberg', 'holzkirchen', 'starnberg',
    'germering', 'gilching', 'planegg', 'martinsried', 'neubiberg',
    'oberhaching', 'taufkirchen', 'brunnthal', 'aschheim', 'heimstetten',
    'maisach', 'olching', 'dachau', 'freising', 'erding',
    'weinheim', 'grenzach', 'wyhlen', 'grenzach-wyhlen',
    'biberach', 'wedel', 'isenburg', 'neu-isenburg', 'neu isenburg',
    'eschborn', 'kronberg', 'bad homburg', 'oberursel', 'friedberg',
    'dreieich', 'langen', 'dietzenbach', 'rodgau', 'seligenstadt',
    'bad vilbel', 'karben', 'nidderau',

    // Industrial/pharma/chemical towns
    'leuna', 'bitterfeld', 'schkopau', 'ludwigshafen', 'worms',
    'frankenthal', 'speyer', 'neustadt an der weinstraße',
    'dormagen', 'brunsbüttel', 'brunsbuttel', 'meppen', 'emden',
    'cuxhaven', 'stade', 'buxtehude', 'leer', 'aurich',
    'papenburg', 'nordhorn', 'lingen', 'rheine', 'ibbenbüren',
    'bocholt', 'borken', 'coesfeld', 'ahlen', 'beckum',
    'warendorf', 'hameln', 'holzminden', 'alfeld', 'goslar',
    'clausthal', 'wolfenbüttel', 'peine', 'gifhorn',
    'helmstedt', 'schöningen', 'königslutter',
    'bad harzburg', 'seesen', 'osterode', 'northeim',
    'einbeck', 'uslar', 'duderstadt',

    // Eastern Germany
    'potsdam', 'oranienburg', 'falkensee', 'bernau', 'eberswalde',
    'schwedt', 'fürstenwalde', 'eisenhüttenstadt', 'senftenberg',
    'spremberg', 'forst', 'guben', 'luckenwalde', 'königs wusterhausen',
    'ludwigsfelde', 'teltow', 'stahnsdorf', 'kleinmachnow',
    'wildau', 'schönefeld', 'blankenfelde', 'rangsdorf',
    'stralsund', 'greifswald', 'wismar', 'güstrow', 'waren',
    'neustrelitz', 'parchim', 'ludwigslust', 'hagenow',
    'wittenberg', 'bitterfeld', 'köthen', 'bernburg',
    'aschersleben', 'quedlinburg', 'halberstadt', 'wernigerode',
    'stendal', 'salzwedel', 'gardelegen',
    'nordhausen', 'mühlhausen', 'eisenach', 'gotha', 'arnstadt',
    'ilmenau', 'suhl', 'meiningen', 'sonneberg', 'saalfeld',
    'rudolstadt', 'gera', 'altenburg', 'schmölln',
    'bautzen', 'görlitz', 'zittau', 'löbau', 'kamenz',
    'hoyerswerda', 'riesa', 'meissen', 'pirna', 'freital',
    'radebeul', 'coswig', 'döbeln', 'mittweida', 'freiberg',
    'annaberg', 'aue', 'schwarzenberg', 'marienberg',
    'limbach-oberfrohna', 'crimmitschau', 'werdau', 'reichenbach',

    // Bavaria (beyond Munich)
    'erlangen', 'fürth', 'schwabach', 'ansbach', 'neumarkt',
    'amberg', 'weiden', 'tirschenreuth', 'hof', 'selb',
    'kulmbach', 'lichtenfels', 'coburg', 'kronach',
    'schweinfurt', 'bad kissingen', 'aschaffenburg', 'miltenberg',
    'kitzingen', 'ochsenfurt', 'bad neustadt',
    'deggendorf', 'straubing', 'cham', 'regen', 'freyung',
    'altötting', 'mühldorf', 'traunstein', 'berchtesgaden',
    'bad reichenhall', 'miesbach', 'garmisch-partenkirchen',
    'weilheim', 'schongau', 'landsberg', 'fürstenfeldbruck',
    'kaufbeuren', 'kempten', 'memmingen', 'lindau',
    'neu-ulm', 'günzburg', 'dillingen', 'donauwörth', 'nördlingen',

    // Baden-Württemberg (beyond Stuttgart)
    'böblingen', 'sindelfingen', 'leonberg', 'ludwigsburg',
    'waiblingen', 'fellbach', 'backnang', 'schorndorf',
    'göppingen', 'geislingen', 'nürtingen', 'esslingen',
    'kirchheim unter teck', 'filderstadt', 'leinfelden-echterdingen',
    'herrenberg', 'rottenburg', 'hechingen', 'balingen',
    'albstadt', 'tuttlingen', 'rottweil', 'oberndorf',
    'offenburg', 'lahr', 'kehl', 'achern', 'bühl',
    'baden-baden', 'rastatt', 'gaggenau', 'ettlingen',
    'bruchsal', 'sinsheim', 'mosbach', 'buchen',
    'schwetzingen', 'hockenheim', 'wiesloch', 'walldorf',
    'lörrach', 'weil am rhein', 'rheinfelden', 'schopfheim',
    'waldshut-tiengen', 'bad säckingen', 'stockach',
    'überlingen', 'salem', 'markdorf', 'tettnang',

    // Schleswig-Holstein
    'lübeck', 'neumünster', 'norderstedt', 'elmshorn',
    'pinneberg', 'wedel', 'itzehoe', 'heide', 'husum',
    'schleswig', 'rendsburg', 'eckernförde', 'eutin',
    'bad segeberg', 'bad oldesloe', 'ahrensburg', 'reinbek',
    'geesthacht', 'lauenburg', 'mölln', 'ratzeburg',

    // Hessen (beyond Frankfurt)
    'wiesbaden', 'darmstadt', 'offenbach', 'hanau',
    'bad homburg', 'oberursel', 'kronberg', 'eschborn',
    'rüsselsheim', 'raunheim', 'kelsterbach', 'mörfelden-walldorf',
    'dreieich', 'langen', 'neu-isenburg', 'dietzenbach',
    'marburg', 'giessen', 'gießen', 'wetzlar', 'limburg',
    'bad nauheim', 'friedberg', 'butzbach', 'bad vilbel',
    'fulda', 'bad hersfeld', 'alsfeld', 'lauterbach',

    // Niedersachsen (beyond Hannover)
    'braunschweig', 'wolfsburg', 'salzgitter', 'hildesheim',
    'göttingen', 'celle', 'lüneburg', 'stade', 'buxtehude',
    'cuxhaven', 'emden', 'leer', 'aurich', 'wilhelmshaven',
    'oldenburg', 'delmenhorst', 'cloppenburg', 'vechta',
    'osnabrück', 'lingen', 'meppen', 'nordhorn', 'papenburg',
    'hameln', 'holzminden', 'peine', 'gifhorn',

    // NRW (beyond Düsseldorf/Cologne)
    'bonn', 'aachen', 'mönchengladbach', 'krefeld', 'duisburg',
    'essen', 'dortmund', 'bochum', 'gelsenkirchen', 'herne',
    'bottrop', 'oberhausen', 'mülheim', 'wuppertal', 'solingen',
    'remscheid', 'leverkusen', 'bergisch gladbach', 'troisdorf',
    'siegburg', 'lohmar', 'much', 'hennef', 'sankt augustin',
    'bad godesberg', 'meckenheim', 'rheinbach', 'euskirchen',
    'düren', 'jülich', 'heinsberg', 'erkelenz', 'wegberg',
    'viersen', 'kempen', 'willich', 'tönisvorst', 'kaarst',
    'korschenbroich', 'jüchen', 'grevenbroich', 'dormagen',
    'neuss', 'meerbusch', 'ratingen', 'mettmann', 'velbert',
    'wülfrath', 'haan', 'hilden', 'langenfeld', 'monheim',
    'erkrath', 'hattingen', 'sprockhövel', 'schwelm',
    'ennepetal', 'gevelsberg', 'herdecke', 'wetter', 'witten',
    'hattingen', 'castrop-rauxel', 'lünen', 'selm', 'werne',
    'bergkamen', 'kamen', 'unna', 'holzwickede', 'schwerte',
    'iserlohn', 'hemer', 'menden', 'arnsberg', 'meschede',
    'brilon', 'winterberg', 'olsberg', 'lippstadt', 'soest',
    'warstein', 'werl', 'hamm', 'ahlen', 'beckum',
    'warendorf', 'oelde', 'rheda-wiedenbrück', 'gütersloh',
    'bielefeld', 'herford', 'minden', 'bad oeynhausen',
    'löhne', 'bünde', 'vlotho', 'porta westfalica',
    'paderborn', 'delbrück', 'bad lippspringe', 'altenbeken',
    'höxter', 'detmold', 'lemgo', 'bad salzuflen', 'lage',

    // Rheinland-Pfalz
    'mainz', 'ludwigshafen', 'kaiserslautern', 'trier',
    'koblenz', 'worms', 'speyer', 'frankenthal', 'neustadt',
    'landau', 'pirmasens', 'zweibrücken', 'bad kreuznach',
    'idar-oberstein', 'bingen', 'ingelheim', 'andernach',
    'neuwied', 'bendorf', 'montabaur', 'limburg',

    // Saarland
    'saarbrücken', 'saarlouis', 'neunkirchen', 'homburg',
    'merzig', 'völklingen', 'st. ingbert', 'dillingen',

    // German state names (for "Neu Isenburg, Hessen" style locations)
    'germany', 'deutschland',
    'hessen', 'bayern', 'bavaria', 'sachsen', 'saxony',
    'niedersachsen', 'nordrhein-westfalen', 'nrw',
    'baden-württemberg', 'baden württemberg', 'rheinland-pfalz',
    'schleswig-holstein', 'mecklenburg-vorpommern',
    'thüringen', 'thuringia', 'brandenburg', 'saarland',
    'sachsen-anhalt', 'saxony-anhalt',
];