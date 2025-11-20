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
// <https://github.com/bilde2910/OPR-Tools/blob/main/LICENSE>
// If not, see <https://www.gnu.org/licenses/>.

import { CheckboxEditor, register, SelectBoxEditor } from "src/core";
import { unilTruthy, haversine } from "src/utils";
import { AnyReview } from "src/types";

import "./extended-stats.css";

type MapType = "map" | "satellite" | "streetview";
interface LatLngLiteral {
  lat: number,
  lng: number,
}

const RESET_SELECTOR = "#check-duplicates-card .wf-review-card__header button";

export default () => {
  register()({
    id: "review-map-mods",
    name: "Review Map Mods",
    authors: ["tehstone", "bilde2910"],
    description: "Add map mods to OPR Review Page",
    defaultConfig: {
      display: "map" as MapType,
      renderCloseCircle: true,
      renderMoveCircle: true,
    },
    sessionData: {},
    initialize: (toolbox, logger, config) => {
      config.setUserEditable("display", {
        label: "Default map view",
        editor: new SelectBoxEditor({
          map: "Map",
          satellite: "Satellite",
          streetview: "Street View",
        }),
      });
      config.setUserEditable("renderCloseCircle", {
        label: "Render minimum portal proximity circle",
        help: "New Portals will not show up if they are within 20 meters of another Portal. Enabling this will make Review Map Mods draw a blue circle around the proposed location that corresponds to this minimum distance.",
        editor: new CheckboxEditor(),
      });
      config.setUserEditable("renderMoveCircle", {
        label: "Render minimum move distance circle",
        help: "If a new Portal is misplaced, you can move it during review, but only if the new location is more than 2 meters away from the submitter's proposal. Enable this option to make Review Map Mods draw a red circle to highlight this movement deadzone when suggesting a new location for the Portal.",
        editor: new CheckboxEditor(),
      });

      let pano: google.maps.StreetViewPanorama | null = null;
      let closeCircle: google.maps.Circle | null = null;
      let moveCircle: google.maps.Circle | null = null;
      let listenSvFocus = false;

      document.addEventListener("focusin", () => {
        if (listenSvFocus && document.activeElement!.classList.contains("mapsConsumerUiSceneInternalCoreScene__root")) {
          listenSvFocus = false;
          document.querySelector("mat-sidenav-content")?.scrollTo(0, 0);
        }
      });

      const addMapMods = async (candidate: AnyReview) => {
        if (typeof google === "undefined") {
          logger.info("addMapMods waiting for google");
          setTimeout(() => addMapMods(candidate), 200);
          return;
        }

        let mapCtx: any | null = null;
        if (candidate.type === "NEW") {
          const gmap: any = await unilTruthy(() => document.querySelector("#check-duplicates-card nia-map"));
          mapCtx = gmap.__ngContext__[gmap.__ngContext__.length - 1];
          await modifyNewReviewMap(gmap, candidate, mapCtx);
        } else if (candidate.type === "EDIT" && candidate.locationEdits.length > 0) {
          const gmap: any = await unilTruthy(() => document.querySelector("app-select-location-edit"));
          mapCtx = gmap.__ngContext__[gmap.__ngContext__.length - 1].niaMap;
        }

        if (mapCtx !== null) {
          logger.info(mapCtx);
          const map = mapCtx.componentRef.map as google.maps.Map;
          if (config.get("renderCloseCircle")) drawCloseCircle(map, candidate);
          void addLocationChangeBtnListener(map, mapCtx, candidate);
          addLocationResetChangeBtnListener(map, mapCtx, candidate);
        }
      };

      const addLocationChangeBtnListener = async (map: google.maps.Map, mapCtx: any, candidate: AnyReview) => {
        const locationChangeBtn = await unilTruthy(() => document.querySelector("#check-duplicates-card nia-map ~ div button"));
        locationChangeBtn.addEventListener("click", () => {
          logger.info("Location change started");
          if (config.get("renderCloseCircle")) drawCloseCircle(map, candidate);
          if (config.get("renderMoveCircle")) drawMoveCircle(map, candidate);
          setTimeout(() => addListenerToMarker(map, mapCtx), 500);
        }, true);
      };

      const addLocationResetChangeBtnListener = (map: google.maps.Map, mapCtx: any, candidate: AnyReview) => {
        const resetButton = document.querySelector(RESET_SELECTOR);
        if (resetButton) {
          resetButton.addEventListener("click", () => {
            logger.info("Resetting location change");
            map.setZoom(17);
            if (config.get("renderCloseCircle")) drawCloseCircle(map, candidate);
            if (config.get("renderMoveCircle")) drawMoveCircle(map, null);
            void addLocationChangeBtnListener(map, mapCtx, candidate);
            addLocationResetChangeBtnListener(map, mapCtx, candidate);
          });
        }
      };

      const addListenerToMarker = async (map: google.maps.Map, mapCtx: any) => {
        const suggested = await unilTruthy(() => mapCtx.markers.suggested);
        const wrapped = suggested.markerOnDrag;
        suggested.markerOnDrag = function (t?: any) {
          if (t && t.lat) {
            if (config.get("renderCloseCircle")) drawCloseCircle(map, t);
          }
          wrapped(t);
        };
      };

      const drawMoveCircle = (map: google.maps.Map, ll: LatLngLiteral | null) => {
        if (moveCircle !== null) moveCircle.setMap(null);
        moveCircle = ll === null ? null : drawCircle(map, ll, "red", 2);
      };

      const drawCloseCircle = (map: google.maps.Map, ll: LatLngLiteral) => {
        if (closeCircle !== null) closeCircle.setMap(null);
        closeCircle = drawCircle(map, ll, "blue", 20);
      };

      const drawCircle = (map: google.maps.Map, ll: LatLngLiteral, color: string, radius: number) =>
        new google.maps.Circle({
          map,
          center: new google.maps.LatLng(ll.lat, ll.lng),
          radius,
          strokeColor: color,
          fillColor: color,
          strokeOpacity: 0.8,
          strokeWeight: 1,
          fillOpacity: 0.2,
        });

      const modifyNewReviewMap = async (ref: HTMLElement, candidate: AnyReview, mapCtx: any) => {
        logger.info("Modifying new review map");
        const map = mapCtx.componentRef.map as google.maps.Map;
        const markers = mapCtx.componentRef.markers;

        // Correct the size of the default marker
        const defaultMarker = markers.default.markers[0];
        defaultMarker.icon.size.height = defaultMarker.icon.size.width;
        // Needed to apply the change
        document.querySelector<HTMLButtonElement>(RESET_SELECTOR)?.click();

        const nomLocation = new google.maps.LatLng(candidate.lat, candidate.lng);
        map.setZoom(17);
        map.setCenter(nomLocation);

        const displayType = config.get("display");
        if (displayType === "satellite") {
          // hybrid includes labels as well as satellite imagery
          map.setMapTypeId("hybrid");
        } else if (displayType === "streetview") {
          // do this here as well as a fallback if no SV image available
          map.setMapTypeId("hybrid");
          const sv = map.getStreetView();
          sv.setOptions({
            motionTracking: false,
            imageDateControl: true,
          });
          const svClient = new google.maps.StreetViewService;
          try {
            const result = await svClient.getPanorama({ location: nomLocation, radius: 50 });
            // listenSvFocus = true;
            const svLocation = result.data.location!.latLng!;
            const heading = google.maps.geometry.spherical.computeHeading(svLocation, nomLocation);
            pano = sv;
            logger.info(`Setting Street View POV heading to ${heading}`);
            pano.setPov({ heading, pitch: 0 });
            pano.setPosition(svLocation);
            pano.setVisible(true);
          } catch {
            const warningBox = document.createElement("p");
            warningBox.classList.add("oprrmm-warning-box");
            warningBox.textContent = "No Street View found within a close radius";
            ref.parentElement!.insertBefore(warningBox, ref);
          }
        }
        await addNearbyTooltips(candidate, mapCtx);
      };

      const addNearbyTooltips = async (candidate: AnyReview, mapCtx: any) => {
        const allMarkers = await unilTruthy(() => document.querySelectorAll("#check-duplicates-card nia-map agm-map div[role=button]"));
        if (allMarkers.length <= 1) {
          setTimeout(() => addNearbyTooltips(candidate, mapCtx), 500);
          return;
        }
        const markers = Array.from(allMarkers).filter(m => window.getComputedStyle(m).width === "32px") as HTMLElement[];

        let closeMarker = false;
        const nearby = mapCtx.markers.nearby;
        if (nearby.markers?.length) {
          logger.info(`Adding tooltips to ${nearby.markers.length} markers`);
          for (let i = 0; i < nearby.markers.length; i++) {
            markers[i].title = nearby.markers[i].infoWindowComponentData.title;
            if (!closeMarker) {
              const distance = haversine(candidate.lat, candidate.lng, nearby.markers[i].latitude, nearby.markers[i].longitude);
              if (distance <= 20) closeMarker = true;
            }
          }
        } else {
          logger.info("No markers to add tooltips to");
        }

        if (closeMarker) {
          const header = document.querySelector<HTMLElement>("body > app-root > app-wayfarer > div > mat-sidenav-container > mat-sidenav-content > div > app-review > wf-page-header > div > div:nth-child(1) > p > div");
          if (header) {
            header.textContent = "There is at least one waypoint within 20 meters of this nomination, check closely for duplicates!";
            header.style.color = "red";
          }
        }
      };

      const unloadPano = () => {
        if (pano !== null) {
          // Street View panorama must be unloaded to avoid it remaining alive in the background
          // after each review is submitted. The additional photospheres pile up in browser memory
          // and either slow down the browser, or crash the tab entirely. This was the root cause
          // behind why reviews would slow down and eventually crash Firefox before Street View was
          // removed by default in Wayfarer 5.2.
          pano.setVisible(false);
          pano = null;
        }
      };
      
      toolbox.interceptOpenJson("GET", "/api/v1/vault/review", addMapMods);
      toolbox.interceptSendJson("/api/v1/vault/review", unloadPano);
    },
  });
};


