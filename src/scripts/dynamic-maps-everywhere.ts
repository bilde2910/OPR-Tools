// Copyright 2025 bilde2910
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
// <https://github.com/bilde2910/OPR-Tools/blob/main/LICENSE>
// If not, see <https://www.gnu.org/licenses/>.

import { CheckboxEditor, register, SelectBoxEditor } from "src/core";
import { untilTruthy } from "src/utils";

import "./dynamic-maps-everywhere.css";

interface DynamicMap {
  container: HTMLElement,
  map: google.maps.Map,
  markers: google.maps.Marker[],
  pano: google.maps.StreetViewPanorama,
}

interface EnrichedStaticMapElement extends HTMLElement {
  __oprTools_DME?: DynamicMap,
}

interface StaticMapConfig {
  width: number,
  height: number,
  mapType: string,
  styles: google.maps.MapTypeStyle[],
  markers: google.maps.MarkerOptions[],
}

type ValidMapTypeID = "auto" | "hybrid" | "roadmap" | "satellite" | "terrain";

export default () => {
  register()({
    id: "dynamic-maps-everywhere",
    name: "Interactive Maps Everywhere",
    authors: ["bilde2910"],
    description: "Replaces all static maps with interactive ones, with automatic loading of Street View if desired",
    defaultConfig: {
      mapType: "auto" as ValidMapTypeID,
      autoLoadStreetView: false,
    },
    sessionData: {},
    initialize: (toolbox, logger, config) => {
      config.setUserEditable("mapType", {
        label: "Default map type",
        help: "The type of map to render by default",
        editor: new SelectBoxEditor({
          "auto": "Determine automatically",
          "roadmap": "Roadmap",
          "terrain": "Terrain",
          "satellite": "Satellite",
          "hybrid": "Hybrid",
        }),
      });
      config.setUserEditable("autoLoadStreetView", {
        label: "Automatically load Street View if available",
        help: "If Street View is unavailable, the map falls back to the default map type specified above",
        editor: new CheckboxEditor(),
      });

      const replaceMap = (staticMap: EnrichedStaticMapElement) => {
        const bgImageUrl = staticMap.style.backgroundImage.match(/^url\("(?<url>[^"]+)"\)$/)?.groups?.url;
        if (typeof bgImageUrl !== "undefined") {
          const url = new URL(bgImageUrl);
          const mapConfig = parseStaticMapUrl(url);
          if (typeof mapConfig === "undefined") return;
          if (mapConfig.height === 0 || mapConfig.width === 0) return;
          logger.info("Replacing static map", mapConfig);

          let chosenMapType = config.get("mapType");
          if (chosenMapType === "auto") chosenMapType = mapConfig.mapType as ValidMapTypeID;

          staticMap.classList.add("oprdme-hidden");
          if (typeof staticMap.__oprTools_DME === "undefined") {
            const node = document.createElement("div");
            staticMap.parentElement!.insertBefore(node, staticMap);
            staticMap.__oprTools_DME = createDynamicMap(node, mapConfig, chosenMapType);
          } else {
            reconfigureDynamicMap(staticMap.__oprTools_DME, mapConfig, chosenMapType);
          }

          addDynamicMapMarkers(staticMap.__oprTools_DME, mapConfig.markers);
          if (config.get("autoLoadStreetView")) {
            loadStreetView(staticMap.__oprTools_DME, mapConfig.markers[0].position!)
              .catch((ex) => {
                logger.warn("Failed to load Street View", ex);
              });
          }
        }
      };

      untilTruthy(() => typeof google !== "undefined").then(() => {
        const currentMaps = document.querySelectorAll<EnrichedStaticMapElement>("nia-google-static-map");
        for (const map of currentMaps) replaceMap(map);
        toolbox.observeNodeAttributeChanges("NIA-GOOGLE-STATIC-MAP", ["style"], replaceMap);
      }).catch(logger.error);
    },
  });
};

const createDynamicMap = (container: HTMLElement, mapConfig: StaticMapConfig, chosenMapType: string): DynamicMap => {
  container.style.width = "100%";
  container.style.height = `${mapConfig.height}px`;
  const map = new google.maps.Map(container, {
    mapTypeId: chosenMapType,
    scaleControl: true,
    scrollwheel: true,
    gestureHandling: "greedy",
    mapTypeControl: true,
    tiltInteractionEnabled: true,
    styles: mapConfig.styles,
  });
  const pano = map.getStreetView();
  pano.setOptions({
    motionTracking: false,
    imageDateControl: true,
  });
  const markers: google.maps.Marker[] = [];
  return { container, map, markers, pano };
};

const reconfigureDynamicMap = (dMap: DynamicMap, mapConfig: StaticMapConfig, chosenMapType: string) => {
  dMap.container.style.height = `${mapConfig.height}px`;
  dMap.map.setMapTypeId(chosenMapType);
  dMap.pano.setVisible(false);
  while (dMap.markers.length > 0) {
    dMap.markers.pop()?.setMap(null);
  }
};

const addDynamicMapMarkers = (dMap: DynamicMap, markers: google.maps.MarkerOptions[]) => {
  const bounds = new google.maps.LatLngBounds();
  for (const marker of markers) {
    bounds.extend(marker.position!);
    dMap.markers.push(new google.maps.Marker({
      map: dMap.map,
      ...marker,
    }));
  }
  google.maps.event.addListenerOnce(dMap.map, "bounds_changed", function () {
    if ((this.getZoom() ?? 20) > 17) {
      this.setZoom(17);
    }
  });
  dMap.map.fitBounds(bounds);
};

const loadStreetView = async (dMap: DynamicMap, position: google.maps.LatLng | google.maps.LatLngLiteral) => {
  const svClient = new google.maps.StreetViewService;
  const result = await svClient.getPanorama({ location: position, radius: 50 });
  const svLocation = result.data.location!.latLng!;
  const heading = google.maps.geometry.spherical.computeHeading(svLocation, position);
  dMap.pano.setPov({ heading, pitch: 0 });
  dMap.pano.setPosition(svLocation);
  dMap.pano.setVisible(true);
};

const parseStaticMapUrl = (url: URL): StaticMapConfig | undefined => {
  const size = url.searchParams.get("size")?.match(/^(\d+)x(\d+)$/)?.slice(1);
  if (!size || size.length < 2) return;
  const [width, height] = size;
  const markers = url.searchParams.getAll("markers");
  if (!markers.length) return;
  const styles = url.searchParams.getAll("style");
  const mapType = url.searchParams.get("maptype") ?? "hybrid";
  return {
    width: parseInt(width),
    height: parseInt(height),
    mapType,
    styles: styles
      .map(spc => parseStyle(spc)),
    markers: markers
      .map(spc => parseMarker(spc))
      .reduce((p, c) => { p.push(...c); return p; }, []),
  };
};

const parseStyle = (style: string): google.maps.MapTypeStyle => {
  const styleSpec = style.split("|");
  const mapsStyle: google.maps.MapTypeStyle = {
    stylers: [],
  };
  for (const arg of styleSpec) {
    const key = arg.substring(0, arg.indexOf(":"));
    const value = arg.substring(arg.indexOf(":") + 1);
    if (key === "element") mapsStyle.elementType = value;
    else if (key === "feature") mapsStyle.featureType = value;
    else mapsStyle.stylers.push({ [key]: convertStaticStyles(value) });
  }
  return mapsStyle;
};

const convertStaticStyles = (value: string) => {
  if (value.startsWith("0x")) return `#${value.substring(2)}`;
  else if (value.match(/^-?\d+$/)) return parseInt(value);
  else if (value.match(/^-?\d+\.\d+$/)) return parseFloat(value);
  else return value;
};

const parseMarker = (marker: string): google.maps.MarkerOptions[] => {
  if (marker.indexOf("|") <= 0) return [];
  const markerSpec = marker.split("|");
  const style: Record<string, string> = {};
  while (markerSpec.length > 0 && markerSpec[0].includes(":")) {
    console.log("b");
    const s = markerSpec.shift()!;
    style[s.substring(0, s.indexOf(":"))] = s.substring(s.indexOf(":") + 1);
  }
  return markerSpec
    .filter(spc => spc.includes(","))
    .map(spc => spc.split(",").map(coord => parseFloat(coord)))
    .map(([ lat, lng ]) => ({
      position: new google.maps.LatLng(lat, lng),
      icon: style.icon?.replace(/^(https?:)(?!\/\/)/, "$1//"),
    }));
};
