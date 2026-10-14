/* london-trip — 장소 사진 매핑 (spec 15.3 · 15.5 · 15.x)
 * 사진: Wikimedia Commons 자유 라이선스(CC BY / CC BY-SA) 이미지를 가로 960px 이하로 줄여 img/에 저장.
 * 저작자·라이선스·출처는 카드 캡션과 img/CREDITS.md에 표시한다. 앱은 외부 요청을 하지 않는다.
 * 형태: window.TripPlaces[rowId] = { key, ko, en, wiki, img, w, h, artist, license, licenseUrl, source[, pos] }
 * data.js는 수정하지 않는다. 이동 행·식사·숙소·자유시간·custom 일정은 매핑하지 않는다. */
(function () {
  'use strict';
  var PLACES = {
    'notting-hill': { ko: "노팅힐", en: "Notting Hill", wiki: "Notting_Hill", img: "img/notting-hill.jpg", w: 640, h: 480, artist: "Urban", license: "CC BY-SA 2.5", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.5", source: "https://commons.wikimedia.org/wiki/File:London_110.jpg" },
    'portobello': { ko: "포토벨로 마켓", en: "Portobello Road Market", wiki: "Portobello_Road", img: "img/portobello.jpg", w: 960, h: 701, artist: "Alexrk2", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:Portobello_market.jpg" },
    'british-museum': { ko: "대영박물관", en: "British Museum", wiki: "British_Museum", img: "img/british-museum.jpg", w: 960, h: 688, artist: "Ham", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:British_Museum_from_NE_2.JPG" },
    'national-gallery': { ko: "내셔널 갤러리", en: "National Gallery", wiki: "National_Gallery", img: "img/national-gallery.jpg", w: 960, h: 509, artist: "Diego Delso", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Galer%C3%ADa_Nacional,_Londres,_Inglaterra,_2014-08-07,_DD_036.JPG" },
    'piccadilly': { ko: "피카딜리 서커스", en: "Piccadilly Circus", wiki: "Piccadilly_Circus", img: "img/piccadilly.jpg", w: 960, h: 638, artist: "Jimmy Baikovicius", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0", source: "https://commons.wikimedia.org/wiki/File:Open_Happiness_Piccadilly_Circus_Blue-Pink_Hour_120917-1126-jikatu.jpg" },
    'soho': { ko: "소호", en: "Soho", wiki: "Soho", img: "img/soho.jpg", w: 960, h: 720, artist: "Leandro Neumann Ciuffo", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:Soho_(1877979497).jpg" },
    'borough-market': { ko: "버로우 마켓", en: "Borough Market", wiki: "Borough_Market", img: "img/borough-market.jpg", w: 960, h: 640, artist: "Øyvind Holmstad", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:London_2018_March_IMG_0663.jpg" },
    'tower-bridge': { ko: "타워브리지", en: "Tower Bridge", wiki: "Tower_Bridge", img: "img/tower-bridge.jpg", w: 960, h: 640, artist: "Fuzzypiggy", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:Tower_Bridge_at_Dawn.jpg" },
    'tower-of-london': { ko: "런던탑", en: "Tower of London", wiki: "Tower_of_London", img: "img/tower-of-london.jpg", w: 960, h: 623, artist: "[Duncan] from Nottingham, UK", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:Tower_of_London_from_the_Shard_(8515883950).jpg" },
    'tate-modern': { ko: "테이트 모던", en: "Tate Modern", wiki: "Tate_Modern", img: "img/tate-modern.jpg", w: 960, h: 720, artist: "Acabashi", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Tate_Modern_-_Bankside_Power_Station.jpg" },
    'london-eye': { ko: "런던아이", en: "London Eye", wiki: "London_Eye", img: "img/london-eye.jpg", w: 960, h: 640, artist: "Khamtran", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:London-Eye-2009.JPG" },
    'covent-garden': { ko: "코번트가든", en: "Covent Garden", wiki: "Covent_Garden", img: "img/covent-garden.jpg", w: 960, h: 745, artist: "Diliff (derivative work: SilkTork)", license: "CC BY 2.5", licenseUrl: "https://creativecommons.org/licenses/by/2.5", source: "https://commons.wikimedia.org/wiki/File:Covent_Garden_Interior_May_2006_crop.jpg" },
    'richmond-park': { ko: "리치몬드 파크", en: "Richmond Park", wiki: "Richmond_Park", img: "img/richmond-park.jpg", w: 960, h: 739, artist: "Stefan Czapski", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0", source: "https://commons.wikimedia.org/wiki/File:Ham_Bottom_in_late_November_-_geograph.org.uk_-_5214113.jpg" },
    'west-end': { ko: "웨스트엔드 극장가", en: "West End theatre", wiki: "West_End_theatre", img: "img/west-end.jpg", w: 960, h: 569, artist: "Pedro Szekely from Los Angeles, USA", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0", source: "https://commons.wikimedia.org/wiki/File:London_(44761485915).jpg" },
    'big-ben': { ko: "빅벤 · 국회의사당", en: "Big Ben", wiki: "Big_Ben", img: "img/big-ben.jpg", w: 540, h: 960, artist: "Christian David", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Elizabeth_Tower_and_the_north_front_of_the_Palace_of_Westminster,_London.jpg", pos: "center 20%" },
    'buckingham': { ko: "버킹엄 궁전", en: "Buckingham Palace", wiki: "Buckingham_Palace", img: "img/buckingham.jpg", w: 960, h: 575, artist: "Julian Herzog", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0", source: "https://commons.wikimedia.org/wiki/File:Buckingham_Palace_London_Morning_2020_01_(cropped).jpg" },
    'sky-garden': { ko: "스카이가든", en: "Sky Garden", wiki: "20_Fenchurch_Street", img: "img/sky-garden.jpg", w: 960, h: 641, artist: "© User:Colin / Wikimedia Commons", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:The_Sky_Garden.jpg" },
    'st-pauls': { ko: "세인트폴 대성당", en: "St Paul's Cathedral", wiki: "St_Paul's_Cathedral", img: "img/st-pauls.jpg", w: 960, h: 659, artist: "Mark Fosh", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:St_Pauls_aerial_(cropped).jpg" },
    'brick-lane': { ko: "브릭레인", en: "Brick Lane", wiki: "Brick_Lane", img: "img/brick-lane.jpg", w: 960, h: 643, artist: "ahisgett", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:Brick_Lane.JPG" },
    'kensington-palace': { ko: "켄싱턴 궁전", en: "Kensington Palace", wiki: "Kensington_Palace", img: "img/kensington-palace.jpg", w: 640, h: 480, artist: "Colin Smith", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0", source: "https://commons.wikimedia.org/wiki/File:Kensington_Palace,_the_South_Front_-_geograph.org.uk_-_287402.jpg" },
    'chinatown': { ko: "차이나타운", en: "Chinatown", wiki: "Chinatown,_London", img: "img/chinatown.jpg", w: 960, h: 640, artist: "Dietmar Rabich", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:London,_China_Town_--_2016_--_4868.jpg" },
    'regent-street': { ko: "리전트 스트리트", en: "Regent Street", wiki: "Regent_Street", img: "img/regent-street.jpg", w: 960, h: 640, artist: "aurélien.", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0", source: "https://commons.wikimedia.org/wiki/File:Regent_Street_2011-04-25.jpg" },
    'heathrow': { ko: "히드로 공항", en: "Heathrow Airport", wiki: "Heathrow_Airport", img: "img/heathrow.jpg", w: 960, h: 720, artist: "Panhard", license: "CC BY 2.5", licenseUrl: "https://creativecommons.org/licenses/by/2.5", source: "https://commons.wikimedia.org/wiki/File:Heathrow_Airport_010.jpg" },
  };
  var ROWS = {
    r09: 'notting-hill',
    r11: 'portobello',
    r13: 'british-museum',
    r15: 'national-gallery',
    r17: 'piccadilly',
    r19: 'soho',
    r21: 'piccadilly',
    r23: 'borough-market',
    r25: 'tower-bridge',
    r26: 'tower-of-london',
    r28: 'tate-modern',
    r30: 'london-eye',
    r32: 'covent-garden',
    r34: 'soho',
    r36: 'richmond-park',
    r43: 'west-end',
    r46: 'big-ben',
    r48: 'buckingham',
    r51: 'sky-garden',
    r53: 'st-pauls',
    r54: 'brick-lane',
    r56: 'kensington-palace',
    r57: 'chinatown',
    r59: 'regent-street',
    r63: 'heathrow',
    r65: 'heathrow',
  };
  var out = {};
  Object.keys(ROWS).forEach(function (rid) {
    var key = ROWS[rid];
    var p = PLACES[key];
    var o = { key: key };
    Object.keys(p).forEach(function (k) { o[k] = p[k]; });
    out[rid] = Object.freeze(o);
  });
  window.TripPlaces = Object.freeze(out);
})();
