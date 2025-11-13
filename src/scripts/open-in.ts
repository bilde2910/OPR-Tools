// Copyright 2025 tehstone, bilde2910
// This file is part of the OPR Tools collection.

// This script is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This script is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You can find a copy of the GNU General Public License in the root
// directory of this script's GitHub repository:
// <https://github.com/tehstone/wayfarer-addons/blob/main/LICENSE>
// If not, see <https://www.gnu.org/licenses/>.

import { register } from "src/core";
import { awaitElement, insertAfter, iterObject, makeChildNode, readGeofences } from "src/utils";
import { AnyReview, AnyContribution, Showcase, SubmissionsResult, Zone, ContributionType } from "src/types";

import proj4 from "proj4";

import "./open-in.css";

export default () => {
  register({
    id: "open-in",
    name: "Open In",
    authors: ["tehstone", "bilde2910"],
    description: "Add open-in buttons to OPR",
    defaultConfig: {},
    initialize: (toolbox, _config) => {
      registerProjections();
      toolbox.interceptOpenJson("GET", "/api/v1/vault/home", injectShowcase);
      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", injectNominations);
      toolbox.interceptOpenJson("GET", "/api/v1/vault/review", injectReview);
    }
  });
};

const projections = {
  "EPSG:2039": "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-48,55,52,0,0,0,0 +units=m +no_defs",
  "EPSG:2056": "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs",
  "EPSG:2180": "+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:3006": "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:3057": "+proj=lcc +lat_1=64.25 +lat_2=65.75 +lat_0=65 +lon_0=-19 +x_0=500000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:3059": "+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=-6000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:3301": "+proj=lcc +lat_1=59.33333333333334 +lat_2=58 +lat_0=57.51755393055556 +lon_0=24 +x_0=500000 +y_0=6375000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:3346": "+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9998 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:3812": "+proj=lcc +lat_1=49.83333333333334 +lat_2=51.16666666666666 +lat_0=50.797815 +lon_0=4.359215833333333 +x_0=649328 +y_0=665262 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:3857": "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext  +no_defs",
  "EPSG:3908": "+proj=tmerc +lat_0=0 +lon_0=18 +k=0.9999 +x_0=6500000 +y_0=0 +ellps=bessel +towgs84=682,-203,480,0,0,0,0 +units=m +no_defs",
  "EPSG:5048": "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:5650": "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=33500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:5972": "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +vunits=m +no_defs",
  "EPSG:5973": "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +vunits=m +no_defs",
  "EPSG:25832": "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:25833": "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:28992": "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs",
  "EPSG:31255": "+proj=tmerc +lat_0=0 +lon_0=13.33333333333333 +k=1 +x_0=0 +y_0=-5000000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs",
  "EPSG:32740": "+proj=utm +zone=40 +south +datum=WGS84 +units=m +no_defs",
};

type Projection = keyof typeof projections;

interface HasPOIData {
  lat: number,
  lng: number,
  title: string,
  description: string,
  guid?: string,
}

interface Provider {
  label: string,
  url: string,
  projection?: Projection,
  cornerOffsets?: number,
  regions?: Zone[],
}

const providers: Provider[] = [
  {
    label: "Google",
    url: "https://maps.google.com/maps?q=%lat%,%lng%"
  },
  {
    label: "OpenStreetMap",
    url: "https://www.openstreetmap.org/?mlat=%lat%&mlon=%lng%#map=18/%lat%/%lng%"
  },
  {
    label: "Intel",
    url: "https://intel.ingress.com/intel?ll=%lat%,%lng%&z=18"
  },
  {
    label: "Bing",
    url: "https://www.bing.com/maps?cp=%lat%~%lng%&lvl=17&style=h"
  },
  {
    label: "Yandex",
    url: "https://yandex.ru/maps/?l=sat%2Cskl&ll=%lng%%2C%lat%&mode=whatshere&whatshere%5Bpoint%5D=%lng%%2C%lat%&whatshere%5Bzoom%5D=17&z=17"
  },
  {
    // Austria
    label: "eBOD",
    url: "https://bodenkarte.at/#/center/%lng%,%lat%/zoom/19",
    regions: ["AT"]
  },
  {
    // Australia (New South Wales)
    label: "NSW Imagery",
    url: "https://www.arcgis.com/home/webmap/viewer.html?url=http%3A%2F%2Fmaps.six.nsw.gov.au%2Farcgis%2Frest%2Fservices%2Fpublic%2FNSW_Imagery%2FMapServer&source=sd&center=%lng%,%lat%&level=20&mapOnly=true",
    regions: ["AU_NSW"]
  },
  {
    // Australia (South Australia)
    label: "Location SA Viewer",
    url: "https://location.sa.gov.au/viewer/?map=hybrid&x=%lng%&y=%lat%&z=18&uids=&pinx=%lng%&piny=%lat%&pinTitle=%title%&pinText=%desc%",
    regions: ["AU_SA"]
  },
  {
    // Australia (Western Australia)
    label: "Landgate Map Viewer Plus",
    url: "https://map-viewer-plus.app.landgate.wa.gov.au/index.html?center=%lng%,%lat%&level=15",
    regions: ["AU_WA"]
  },
  {
    // Belgium
    label: "NGI/IGN",
    url: "https://topomapviewer.ngi.be/?l=en&baselayer=ngi.ortho&x=%lng%&y=%lat%&zoom=12",
    projection: "EPSG:3812",
    regions: ["BE"]
  },
  {
    // Switzerland
    label: "Admin.ch",
    url: "https://map.geo.admin.ch/?lang=en&topic=ech&bgLayer=ch.swisstopo.swissimage&layers=ch.swisstopo.zeitreihen,ch.bfs.gebaeude_wohnungs_register,ch.bav.haltestellen-oev,ch.swisstopo.swisstlm3d-wanderwege,ch.astra.wanderland-sperrungen_umleitungen&layers_opacity=1,1,1,0.8,0.8&layers_visibility=false,false,false,false,false&layers_timestamp=18641231,,,,&E=%lng%&N=%lat%&zoom=17",
    projection: "EPSG:2056",
    regions: ["CH", "LI"]
  },
  {
    // China (PRC)
    label: "高德",
    url: "https://uri.amap.com/marker?position=%lng%,%lat%&coordinate=wgs84&name=%title%",
    regions: ["CN"]
  },
  {
    // China (PRC)
    label: "百度",
    url: "http://api.map.baidu.com/marker?location=%lat%,%lng%&title=%title%&content=.&output=html&coord_type=wgs84",
    regions: ["CN"]
  },
  {
    // Czech Republic and Slovakia
    label: "Mapy.cz",
    url: "https://en.mapy.cz/zakladni?x=%lng%&y=%lat%&z=18&base=ophoto",
    regions: ["CZ", "SK"]
  },
  {
    // Germany (Bavaria)
    label: "BayernAtlas",
    url: "https://geoportal.bayern.de/bayernatlas/?lang=de&topic=ba&bgLayer=atkis&catalogNodes=11&E=%lng%&N=%lat%&zoom=14&layers=luftbild,luftbild_parz,tk_by,d0e7d4ea-62d8-46a0-a54a-09654530beed,bcce5127-a233-4bea-ad08-c0e4c376bccf,e528a2a8-44e7-46e9-9069-1a8295b113b5,6e2f5825-4a89-4942-a464-c88ec41bb734,86e82390-1739-4d21-bf78-e8b189c1a35d,22a00a49-82fc-4562-8176-00bf4a41e587&layers_visibility=false,true,false,true,true,true,true,true,true&crosshair=marker",
    projection: "EPSG:25832",
    regions: ["DE_BY"]
  },
  {
    // Germany (Berlin)
    label: "FIS-Broker",
    url: "https://fbinter.stadt-berlin.de/fb/index.jsp?loginkey=zoomStart&mapId=k_luftbild2011_20@senstadt&bbox=%lng%,%lat%,%lng%,%lat%",
    projection: "EPSG:25833",
    regions: ["DE_BE"]
  },
  {
    // Germany (Bremen)
    label: "GeoPortal Bremen",
    url: "https://geoportal.bremen.de/geoportal/?layerIDs=410_1,400_1,11,17_1&visibility=true,true,true,true&transparency=0,0,0,0&center=%lng%,%lat%&zoomlevel=11",
    projection: "EPSG:25832",
    regions: ["DE_HB"]
  },
  {
    // Germany (Schleswig-Holstein)
    label: "DigitalAtlasNord",
    url: "https://danord.gdi-sh.de/viewer/resources/apps/Anonym/index.html?lang=de&c=%lng%%2C%lat%&vm=2D&s=1500&bm=DOP20&r=0&#/",
    projection: "EPSG:25832",
    regions: ["DE_HB", "DE_HH", "DE_SH"]
  },
  {
    // Germany (Bremen, Hamburg, Schleswig-Holstein)
    label: "Hamburg Geo-Online",
    url: "https://geoportal-hamburg.de/geo-online/?Map/layerIds=12883,12884,16101,19968,94&visibility=true,true,true,true,true&transparency=0,0,0,0,0&Map/center=[%lng%,%lat%]&Map/zoomLevel=9",
    projection: "EPSG:25832",
    regions: ["DE_HB", "DE_HH", "DE_SH"]
  },
  {
    // Germany (Bremen, Hamburg)
    label: "Geoportal der Metropolregion Hamburg",
    url: "https://geoportal.metropolregion.hamburg.de/mrhportal/index.html?Map/layerIds=19101,8012&visibility=true,true&transparency=0,0&Map/center=[%lng%,%lat%]&Map/zoomLevel=11",
    projection: "EPSG:25832",
    regions: ["DE_HB", "DE_HH"]
  },
  {
    // Germany (Mecklenburg-Western Pomerania)
    label: "ORKa.MV",
    url: "https://www.orka-mv.de/app/#!/map=8/%lng%/%lat%/EPSG:25833/S",
    projection: "EPSG:25833",
    regions: ["DE_MV"]
  },
  {
    // Germany (Mecklenburg-Western Pomerania)
    label: "GAIA-MV",
    url: "https://www.gaia-mv.de/gaia/login.php?page=gaia.php&profil=inet_basis&mapext=%lnga%%20%lata%%20%lngb%%20%latb%&target_prj=epsg:5650&target_prj_display_koords=epsg:5650&target_prj_display_koords_format=m&layers=dopmv%20copyright",
    projection: "EPSG:5650",
    cornerOffsets: 10,
    regions: ["DE_MV"]
  },
  {
    // Germany (Lower Saxony)
    label: "GeobasisdatenViewer Niedersachsen",
    url: "https://www.geobasis.niedersachsen.de/?x=%lng%&y=%lat%&z=14&m=lglnDop",
    regions: ["DE_NI"]
  },
  {
    // Germany (Rhineland-Palatinate)
    label: "GeoBasisViewer RLP",
    url: "https://maps.rlp.de/?layerIDs=7&visibility=true&transparency=0&center=%lng%,%lat%&zoomlevel=11",
    projection: "EPSG:25832",
    regions: ["DE_RP"]
  },
  {
    // Germany (Saxony-Anhalt)
    label: "Sachsen-Anhalt-Viewer",
    url: "https://www.geodatenportal.sachsen-anhalt.de/mapapps/resources/apps/viewer_v40/index.html?lang=de&vm=2D&s=500&r=0&c=%lng%%2C%lat%&bm=orthophotos&l=~bauleit(~6%7Bt%3A50%7D%2C~7%7Bt%3A50%7D)",
    projection: "EPSG:25832",
    regions: ["DE_ST"]
  },
  {
    // Germany (Thuringia)
    label: "Thüringen Viewer",
    url: "https://thueringenviewer.thueringen.de/thviewer/?layerIDs=2800&visibility=true&transparency=0&center=%lng%,%lat%&zoomlevel=13",
    projection: "EPSG:25832",
    regions: ["DE_TH"]
  },
  {
    // Denmark
    label: "SDFE Skråfoto",
    url: "https://skraafoto.kortforsyningen.dk/oblivisionjsoff/index.aspx?project=Denmark&lon=%lng%&lat=%lat%",
    regions: ["DK"]
  },
  {
    // Denmark
    label: "Krak",
    url: "https://map.krak.dk/?c=%lat%,%lng%&z=18&l=aerial&g=%lat%,%lng%",
    regions: ["DK"]
  },
  {
    // Denmark
    label: "Find vej",
    url: "https://findvej.dk/%lat%,%lng%",
    regions: ["DK"]
  },
  {
    // Estonia
    label: "Maainfo",
    url: "https://xgis.maaamet.ee/maps/XGis?app_id=UU82A&user_id=at&LANG=1&WIDTH=959&HEIGHT=1305&zlevel=11,%lng%,%lat%",
    projection: "EPSG:3301",
    regions: ["EE"]
  },
  {
    // Estonia
    label: "Maa-amet Fotoladu",
    url: "https://fotoladu.maaamet.ee/?basemap=hybriidk&zlevel=15,%lng%,%lat%&overlay=tyhi",
    regions: ["EE"]
  },
  {
    // Spain
    label: "Iberpix",
    url: "https://www.ign.es/iberpix2/visor/?center=%lng%,%lat%&zoom=20",
    regions: ["ES", "GI", "EA", "IC"]
  },
  {
    // Spain
    label: "Fototeca Digital",
    url: "https://fototeca.cnig.es/fototeca/?center=%lng%,%lat%&zoom=20",
    regions: ["ES", "GI", "EA", "IC"]
  },
  {
    // Finland
    label: "Maanmittauslaitos",
    url: "https://asiointi.maanmittauslaitos.fi/karttapaikka/?lang=fi&share=customMarker&n=%lat%&e=%lng%&title=%title%&desc=%desc%&zoom=13&layers=%5B%7B%22id%22:4,%22opacity%22:35%7D,%7B%22id%22:3,%22opacity%22:100%7D%5D",
    projection: "EPSG:5048",
    regions: ["FI", "AX"]
  },
  {
    // Finland
    label: "Paikkatietoikkuna",
    url: "https://kartta.paikkatietoikkuna.fi/?zoomLevel=13&coord=%lng%_%lat%&mapLayers=24+100+default&markers=2|1|ff4712|%lng%_%lat%|%title%&noSavedState=true&showIntro=false",
    projection: "EPSG:5048",
    regions: ["FI", "AX"]
  },
  {
    // Faroe Islands
    label: "Føroyakort",
    url: "https://kort.foroyakort.fo/kort/?center=%lng%,%lat%&zoom=13",
    regions: ["FO"]
  },
  {
    // Faroe Islands
    label: "Flogmyndir",
    url: "https://umhvorvi.maps.arcgis.com/apps/webappviewer/index.html?id=4c79f18f83c045e181ac87858cb11641&center=%lng%,%lat%&zoom=13",
    regions: ["FO"]
  },
  {
    // France with overseas territories
    label: "Mappy",
    url: "https://fr.mappy.com/plan#/%lat%,%lng%",
    regions: ["FR", "PM", "BL", "SX", "MF", "GP", "MQ", "GF", "YT", "RE", "WF", "MC"]
  },
  {
    // Croatia
    label: "Geoportal DGU",
    url: "https://geoportal.dgu.hr/#/?lng=%lng%&lat=%lat%&zoom=11",
    regions: ["HR"]
  },
  {
    // Indonesia
    label: "Badan Informasi Geospasial",
    url: "https://geoservices.big.go.id/portal/apps/webappviewer/index.html?id=e3509402ccf34c61a44d0f06f952af96&center=%lng%,%lat%&level=18",
    regions: ["ID"]
  },
  {
    // Israel, West Bank
    label: "Govmap",
    url: "https://www.govmap.gov.il/?c=%lng%,%lat%&z=10&b=2",
    projection: "EPSG:2039",
    regions: ["IL", "PS_WB"]
  },
  {
    // Iceland - street view
    label: "Já.is Götusýn",
    url: "https://ja.is/kort/?x=%lng%&y=%lat%&nz=17.00&type=aerial&ja360=1",
    projection: "EPSG:3057",
    regions: ["IS"]
  },
  {
    // Iceland
    label: "Map.is",
    url: "https://map.is/base/@%lng%,%lat%,z10,2",
    projection: "EPSG:3057",
    regions: ["IS"],
  },
  {
    // Iceland
    label: "Landupplýsingagátt LMÍ",
    url: "https://kort.lmi.is/?zoomLevel=15&coord=%lng%_%lat%&mapLayers=396+100+&markers=2|1|ff4712|%lng%_%lat%|%title%&noSavedState=true&showIntro=false",
    projection: "EPSG:3857",
    regions: ["IS"],
  },
  {
    // Iceland
    label: "Samsýn",
    url: "https://kort.samsyn.is/gagnavefsja/?center=%lng%,%lat%&level=11",
    regions: ["IS"]
  },
  {
    // South Korea
    label: "Kakao",
    url: "https://map.kakao.com/?map_type_skyview&map_hybrid=true&q=%lat%%2C%lng%",
    regions: ["KR"]
  },
  {
    // South Korea
    label: "Naver",
    url: "http://map.naver.com/?menu=location&lat=%lat%&lng=%lng%&dLevel=14&title=%title%",
    regions: ["KR"]
  },
  {
    // Liechtenstein
    label: "Geodatenportal der LLV",
    url: "https://geodaten.llv.li/geoportal/public.html?zoombox=%lng%,%lat%,%lng%,%lat%",
    projection: "EPSG:2056",
    regions: ["LI"]
  },
  {
    // Lithuania
    label: "Maps.lt",
    url: "https://maps.lt/map/?lang=en#obj=%lng%;%lat%;%title%;&xy=%lng%,%lat%&z=1000&lrs=orthophoto,hybrid_overlay,vector_2_5d,stops,zebra",
    projection: "EPSG:3346",
    regions: ["LT"]
  },
  {
    // Lithuania
    label: "Geoportal.lt",
    url: "https://www.geoportal.lt/map/mapgen/map2.html#x=%lng%&y=%lat%&l=13&olid=ORT10_2020",
    projection: "EPSG:3346",
    regions: ["LT"]
  },
  {
    // Luxembourg
    label: "Geoportal Luxembourg",
    url: "https://map.geoportail.lu/theme/main?version=3&zoom=19&X=%lng%&Y=%lat%&lang=fr&rotation=0&layers=&opacities=&bgLayer=streets_jpeg&crosshair=true",
    projection: "EPSG:3857",
    regions: ["LU"]
  },
  {
    // Latvia
    label: "LĢIA Kartes",
    url: "https://kartes.lgia.gov.lv/karte/?x=%lat%&y=%lng%&zoom=11&basemap=hibridkarte&bookmark=true",
    projection: "EPSG:3059",
    regions: ["LV"]
  },
  {
    // Latvia and Estonia
    label: "BalticMaps",
    url: "https://www.balticmaps.eu/en/c___%lat%-%lng%-18/w___driving-%lat%,%lng%/bl___pl/labels",
    regions: ["LV", "EE"]
  },
  {
    // Netherlands
    label: "Kaarten van Nederland",
    url: "https://www.kaartenvannederland.nl/#?geometry.x=%lng%&geometry.y=%lat%&zoomlevel=14",
    projection: "EPSG:28992",
    regions: ["NL"]
  },
  {
    // Netherlands
    label: "Map5 NLTopo",
    url: "https://app.map5.nl/nltopo/#rd/openlufo/14/%lng%/%lat%",
    projection: "EPSG:28992",
    regions: ["NL"]
  },
  {
    // Norway
    label: "Finn.no kart",
    url: "https://kart.finn.no/?lng=%lng%&lat=%lat%&zoom=18&mapType=norortho&showPin=1",
    regions: ["NO"]
  },
  {
    // Norway
    label: "1881.no",
    url: "https://kart.1881.no/?lat=%lat%&lon=%lng%&z=18&v=1&r=&o=&layer=",
    regions: ["NO"]
  },
  {
    // Norway
    label: "Gule Sider",
    url: "https://kart.gulesider.no/?c=%lat%,%lng%&z=18&l=aerial&g=%lat%,%lng%",
    regions: ["NO"]
  },
  {
    // Norway
    label: "Norgeskart",
    url: "https://www.norgeskart.no/#!?project=norgeskart&layers=1003&zoom=17&lat=%lat%&lon=%lng%&markerLat=%lat%&markerLon=%lng%",
    projection: "EPSG:5973",
    regions: ["NO"]
  },
  {
    // Norway
    label: "Se eiendom",
    url: "https://www.norgeskart.no/#!?project=seeiendom&layers=1003,1013,1014,1015&zoom=17&lat=%lat%&lon=%lng%&markerLat=%lat%&markerLon=%lng%&panel=Seeiendom&showSelection=true&p=Seeiendom",
    projection: "EPSG:5973",
    regions: ["NO"]
  },
  {
    // Norway
    label: "Norge i bilder",
    url: "https://www.norgeibilder.no/?x=%lng%&y=%lat%&level=17&utm=32",
    projection: "EPSG:5972",
    regions: ["NO"]
  },
  {
    // Norway
    label: "UT.no",
    url: "https://ut.no/kart#17/%lat%/%lng%",
    regions: ["NO"]
  },
  {
    // Norway
    label: "Kommunekart",
    url: "https://www.kommunekart.com/?funksjon=Vispunkt&x=%lat%&y=%lng%&zoom=17&markering=1",
    regions: ["NO"]
  },
  {
    // New Zealand
    label: "Land Information NZ",
    url: "https://basemaps.linz.govt.nz/#@%lat%,%lng%,z19",
    regions: ["NZ_1", "NZ_2"]
  },
  {
    // Poland
    label: "Geoportal",
    url: "https://mapy.geoportal.gov.pl/mobile/?bbox=%lng%,%lat%,%lng%,%lat%#composition=ortofoto",
    projection: "EPSG:2180",
    regions: ["PL"]
  },
  {
    // Serbia
    label: "МРЕ Србије",
    url: "https://gis.mre.gov.rs/smartPortal/Srbija?extent=xmin=%lng%,ymin=%lat%,xmax=%lng%,ymax=%lat%",
    projection: "EPSG:3857",
    regions: ["RS", "XK"]
  },
  {
    // Sweden
    label: "Lantmäteriet",
    url: "https://minkarta.lantmateriet.se/?e=%lng%&n=%lat%&z=14&profile=fastighetskarta&background=1&boundaries=true",
    projection: "EPSG:3006",
    regions: ["SE"]
  },
  {
    // Sweden
    label: "Eniro",
    url: "https://kartor.eniro.se/?c=%lat%,%lng%&z=18&l=aerial&g=%lat%,%lng%",
    regions: ["SE"]
  },
  {
    // Svalbard
    label: "TopoSvalbard",
    url: "https://toposvalbard.npolar.no/?lat=%lat%&long=%lng%&zoom=13&layer=aerial",
    regions: ["SJ_SV"]
  },
];

const registerProjections = () => {
  for (const [epsg, def] of iterObject(projections)) {
    proj4.defs(epsg, def);
  }
};

const injectShowcase = async (result: Showcase) => {
  await readGeofences();
  await awaitElement(() => document.querySelector(".showcase-item"));
  const showcase = result.showcase;
  const count = showcase.length;
  let index = 0;
  let box: HTMLElement | null = null;

  const renderRef = () => document.getElementsByClassName("showcase-item__map")[0];
  const render = () => awaitElement(renderRef).then(async (rref: any) => {
    const nBox = await addOpenButtons(rref, showcase[index]);
    if (box) box.parentElement!.removeChild(box);
    box = nBox;
  });

  render();
  const paginators = document.getElementsByClassName("showcase-gallery__button");
  if (paginators.length === 2) {
    paginators[0].addEventListener("click", () => {
      index = (index - 1 + count) % count; render();
    });
    paginators[1].addEventListener("click", () => {
      index = (index + 1 + count) % count; render();
    });
  }
};

const injectNominations = async (result: SubmissionsResult) => {
  const ref = await awaitElement(() => document.querySelector("app-submissions-list"));
  const nomCache = {} as Record<string, AnyContribution>;
  let box: HTMLElement | null = null;

  for (const contribution of result.submissions) {
    if (contribution.imageUrl.length > 0) {
      nomCache[contribution.imageUrl] = contribution;
    } else if (contribution.type !== ContributionType.NOMINATION) {
      nomCache[contribution.poiData.imageUrl] = contribution;
    }
  }

  ref.addEventListener("click", async (e: any) => {
    const item = e.target!.closest("app-submissions-list-item") as HTMLElement | null;
    if (item) {
      const nom = nomCache[item.querySelector<HTMLImageElement>(".object-cover")!.src];
      const rref = await awaitElement(() => document.querySelector<HTMLElement>("app-details-pane .details-pane__map"));
      const nBox = await addOpenButtons(rref, nom);
      if (box) box.parentElement!.removeChild(box);
      box = nBox;
    }
  });
};

const injectReview = async (candidate: AnyReview) => {
  if (candidate.type === "NEW") {
    const ref = await awaitElement(() => document.getElementById("check-duplicates-card"));
    if (candidate.streetAddress) {
      const addrBox = document.createElement("p");
      addrBox.classList.add("oproi-address");
      addrBox.textContent = candidate.streetAddress;
      insertAfter(ref.firstChild!, addrBox);
    }
    addOpenButtons(ref.firstChild!, candidate);
  } else if (candidate.type === "EDIT") {
    const ref = await awaitElement(() => document.querySelector(".review-edit-info .review-edit-info__info"));
    addOpenButtons(ref, candidate);
  } else if (candidate.type === "PHOTO") {
    const pref = await awaitElement(() => document.querySelector("app-review-photo"));
    const ref = await awaitElement(() => pref.querySelector(".review-photo__info > div > div:nth-child(2)"));
    addOpenButtons(ref, candidate);
  }
};

const addOpenButtons = async (before: Node, portal: HasPOIData) => {
  const box = document.createElement("div");
  box.classList.add("oproi-container");
  const globalBox = document.createElement("p");
  makeChildNode(globalBox, "span", "Open in: ").classList.add("oproi-label");

  const membership = await getGeofenceMemberships(portal.lat, portal.lng);
  const regionBoxes = {} as Record<string, HTMLElement>;
  for (const [zone, member] of iterObject(membership)) {
    if (member) {
      const flag = getFlag(zone);
      regionBoxes[flag] = document.createElement("p");
      makeChildNode(regionBoxes[flag], "span", `Local maps (${flag}): `)
        .classList.add("oproi-label");
    }
  }

  //let experimental = false;
  providers.forEach(e => {
    if (e.regions && !e.regions.some(region => (membership[region]))) return;
    const linkSpan = document.createElement("span");
    linkSpan.classList.add("oproi-linkspan");
    const link = document.createElement("a");
    let nLat = portal.lat, nLng = portal.lng;
    if (e.projection) {
      [ nLng, nLat ] = proj4(e.projection, [ nLng, nLat ]);
    }
    let nLatA = nLat, nLatB = nLat, nLngA = nLng, nLngB = nLng;
    if (e.cornerOffsets) {
      nLatA -= e.cornerOffsets;
      nLngA -= e.cornerOffsets;
      nLatB += e.cornerOffsets;
      nLngB += e.cornerOffsets;
    }
    link.href = e.url
      .split("%lat%").join(nLat.toString())
      .split("%lng%").join(nLng.toString())
      .split("%title%").join(encodeURIComponent(portal.title))
      .split("%desc%").join(encodeURIComponent(portal.description))
      .split("%lata%").join(nLatA.toString())
      .split("%lnga%").join(nLngA.toString())
      .split("%latb%").join(nLatB.toString())
      .split("%lngb%").join(nLngB.toString());
    link.target = "oproi-provider-site";
    link.textContent = e.label;
    linkSpan.appendChild(link);
    /*if (e.hasOwnProperty("onload")) {
      experimental = true;
      const ast = document.createElement("span");
      ast.classList.add("oproi-experimental");
      ast.textContent = "*";
      const tooltip = document.createElement("span");
      tooltip.classList.add("oproi-tooltip");
      const ttTitle = document.createElement("span");
      ttTitle.textContent = "OPEN IN: EXPERIMENTAL PROVIDER";
      ttTitle.classList.add("oproi-tttitle");
      const ttBody = document.createElement("span");
      ttBody.textContent = "Open In uses JavaScript injection to make this map provider focus on the Wayspot's location. This is not supported by the map provider, and as such is considered an experimental feature of Open In and indicated as such with an orange star. Use at your own responsibility.";
      tooltip.appendChild(ttTitle);
      tooltip.appendChild(document.createElement("br"));
      tooltip.appendChild(ttBody);
      ast.appendChild(tooltip);
      linkSpan.appendChild(ast);
    }*/
    if (typeof e.regions !== "undefined") {
      for (const [zone, member] of iterObject(membership)) {
        if (member && e.regions.includes(zone)) {
          regionBoxes[getFlag(zone)].appendChild(linkSpan);
        }
      }
    } else {
      globalBox.appendChild(linkSpan);
    }

    // Needed for postMessage:
    // dataCache = { latLng: { lat: nLat, lng: nLng }, title, description };
  });

  if ("guid" in portal && portal.guid !== null && typeof portal.guid !== "undefined") {
    const linkSpan = document.createElement("span");
    linkSpan.classList.add("oproi-linkspan");
    const link = document.createElement("a");
    link.href = `https://link.ingress.com/portal/${portal.guid}`;
    link.target = "_blank";
    link.textContent = "Ingress Prime";
    linkSpan.appendChild(link);
    globalBox.appendChild(linkSpan);
  }

  box.appendChild(globalBox);
  for (const zoneBox of Object.values(regionBoxes)) {
    box.appendChild(zoneBox);
  }

  insertAfter(before, box);
  return box;
};

const getGeofenceMemberships = async (lat: number, lng: number) => {
  const geofences = await readGeofences();
  const membership = {} as Record<Zone, boolean>;
  for (const [zone, points] of iterObject(geofences)) {
    membership[zone] = isWithinBounds(points, lat, lng);
  }
  return membership;
};

const isWithinBounds = (geofence: number[][], lat: number, lng: number) => {
  let inside = false;
  const count = geofence.length;
  for (let b = 0, a = count - 1; b < count; a = b++) {
    const [ aLat, aLng ] = geofence[a], [ bLat, bLng ] = geofence[b];
    if (aLng > lng != bLng > lng && lat > (aLat - bLat) * (lng - bLng) / (aLng - bLng) + bLat) {
      inside = !inside;
    }
  }
  return inside;
};

const getFlag = (countryCode: string) => {
  const regionalIndicatorOffset = 127397;
  const c1 = String.fromCodePoint(countryCode.codePointAt(0)! + regionalIndicatorOffset);
  const c2 = String.fromCodePoint(countryCode.codePointAt(1)! + regionalIndicatorOffset);
  return c1 + c2;
};
