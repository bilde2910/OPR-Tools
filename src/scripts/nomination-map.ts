// Copyright 2025 tehstone, bilde2910, Tntnnbltn
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

import { CheckboxEditor, NumericInputEditor, register } from "src/core";
import { untilTruthy, debounce, weightNumericArray } from "src/utils";
import { AnyContribution, ContributionStatus, SubmissionsResult } from "src/types";

import { Cluster, ClusterStats, Marker, MarkerClusterer, Renderer } from "@googlemaps/markerclusterer";

import "./nomination-map.css";

const CTRLESS_ZOOM = true;

export default () => {
  register()({
    id: "nomination-map",
    name: "Nomination Map",
    authors: ["tehstone", "bilde2910", "Tntnnblth"],
    description: "Add map of all nominations",
    defaultConfig: {
      loadFirst: true,
      maxClusteringZoom: 10,
    },
    sessionData: {},
    initialize: (toolbox, logger, config) => {
      config.setUserEditable("loadFirst", {
        label: "Load first wayspot detail automatically",
        editor: new CheckboxEditor(),
      });
      config.setUserEditable("maxClusteringZoom", {
        label: "Max zoom level for marker clustering",
        help: "Value from 0-20, where higher numbers equal closer zoom. When the map is zoomed in beyond this level, markers will no longer cluster together.",
        editor: new NumericInputEditor({ min: 0, max: 20 }),
      });

      let countText: HTMLElement | null = null;
      let nominationCluster: MarkerClusterer | null = null;
      let nominationMarkers: google.maps.Marker[] = [];
      let nominationMap: google.maps.Map | null = null;
      let nominations: AnyContribution[] | null = null;

      const parseContributions = (data: SubmissionsResult) => {
        if (!data.submissions) return;
        nominations = data.submissions;
        void addCounter();
        void initPrimaryListener();
        void initNominationMap();
        void checkAutoLoad();
      };

      const clickFirst = async () => {
        const ref = await untilTruthy(() => document.querySelector(".cdk-virtual-scroll-content-wrapper"));
        (ref.children[0] as HTMLElement).click();
      };

      const addCounter = async () => {
        const listEl: any = await untilTruthy(() => document.querySelector(".cdk-virtual-scroll-content-wrapper"));
        const insDiv = await untilTruthy(() => document.querySelector(".mt-2"));

        const searchInput = document.querySelector("input.w-full");
        if (searchInput !== undefined) {
          searchInput?.addEventListener("keyup", debounce(() => updateMapFilter(), 1000));
        }

        setTimeout(() => {
          const count = listEl.__ngContext__[3][26].length;
          countText = document.createElement("div");
          countText.textContent = `Count: ${count}`;
          countText.classList.add("oprnm-text");
          insDiv.insertBefore(countText, insDiv.children[0]);
        }, 1000);
      };

      const initPrimaryListener = async () => {
        const ref = await untilTruthy(() => document.querySelector(".cursor-pointer"));
        ref.addEventListener("click", function() {
          const modal = document.getElementsByTagName("app-submissions-sort-modal");
          const els = modal[0].getElementsByClassName("wf-button--primary");
          for (let i = 0; i < els.length; i++) {
            els[i].addEventListener("click", function() {
              setTimeout(updateMapFilter, 250);
            });
          }
        });
      };

      const checkAutoLoad = async () => {
        if (config.get("loadFirst")) {
          await clickFirst();
        }
      };

      const initNominationMap = async () => {
        await untilTruthy(() => typeof google !== "undefined" && nominations!.length > 0);
        if (nominationMap === null) {
          addMap(createElements());
        } else {
          updateMap(true);
        }
      };

      const addMap = (mapElement: HTMLElement) => {
        const mapSettings: google.maps.MapOptions = CTRLESS_ZOOM ? {
          scrollwheel: true,
          gestureHandling: "greedy",
        } : {};
        nominationMap = new google.maps.Map(mapElement, {
          zoom: 8,
          ...mapSettings,
        });
        updateMap(true);
      };

      const createElements = () => {
        const container = document.createElement("div");
        container.classList.add("oprnm-wrap-collapsible");

        const collapsibleInput = document.createElement("input");
        collapsibleInput.id = "oprnm-collapsed-map";
        collapsibleInput.classList.add("oprnm-toggle");
        collapsibleInput.type = "checkbox";

        const collapsibleLabel = document.createElement("label");
        collapsibleLabel.classList.add("oprnm-lbl-toggle");
        collapsibleLabel.textContent = "View Nomination Map";
        collapsibleLabel.setAttribute("for", "oprnm-collapsed-map");

        const collapsibleContent = document.createElement("div");
        collapsibleContent.classList.add("oprnm-collapsible-content");

        const mapElement = document.createElement("div");
        mapElement.classList.add("oprnm-map");
        mapElement.textContent = "Loading...";

        collapsibleContent.appendChild(mapElement);

        container.appendChild(collapsibleInput);
        container.appendChild(collapsibleLabel);
        container.appendChild(collapsibleContent);

        const sectionElement = document.getElementsByTagName("app-submissions")[0];
        sectionElement.insertBefore(container, sectionElement.children[0]);

        return mapElement;
      };

      const updateMapFilter = () => {
        if (countText) {
          const listEl: any = document.querySelector(".cdk-virtual-scroll-content-wrapper");
          const count = listEl.__ngContext__[3][26].length;
          nominations = listEl.__ngContext__[3][26];
          countText.textContent = `Count: ${count}`;
          updateMap(true);
        }
        window.dispatchEvent(new Event("OPRNM_MapFilterChange"));
      };

      const updateMap = (reset: boolean) => {
        if (nominationMap === null) return;
        if (nominationCluster !== null) {
          nominationCluster.clearMarkers();
        }
        const bounds = new google.maps.LatLngBounds();
        nominationMarkers = nominations!.map(n => {
          const ll = {
            lat: n.lat,
            lng: n.lng,
          };
          const marker = new google.maps.Marker({
            map: nominationMap,
            position: ll,
            title: n.title,
            icon: {
              url: getIconUrl(n),
            },
          });
          marker.addListener("click", () => {
            const inputs = document.querySelectorAll("input[type=text]");
            const input = inputs[0] as HTMLInputElement;
            input.value = n.id;
            input.dispatchEvent(new Event("input"));
            setTimeout(clickFirst, 500);
            setTimeout(() => {
              logger.info("Calling updateMap with false");
              updateMap(false);
            }, 500);
          });
          bounds.extend(ll);
          return marker;
        });
        nominationCluster = new MarkerClusterer({
          map: nominationMap,
          markers: nominationMarkers,
          renderer: new NominationMapClusterRenderer(),
          algorithmOptions: {
            maxZoom: config.get("maxClusteringZoom"),
          },
        });

        if (reset) {
          logger.info("Resetting bounds");
          nominationMap.fitBounds(bounds);
        }
      };

      const getIconUrl = (nomination: AnyContribution) => {
        const colorMap = <Record<ContributionStatus, string>>{
          [ContributionStatus.ACCEPTED]: "green",
          [ContributionStatus.APPEALED]: "purple",
          [ContributionStatus.NOMINATED]: "blue",
          [ContributionStatus.WITHDRAWN]: "grey",
          [ContributionStatus.VOTING]: "yellow",
          [ContributionStatus.DUPLICATE]: "orange",
          [ContributionStatus.REJECTED]: "red",
        };
        return `https://maps.google.com/mapfiles/ms/icons/${colorMap[nomination.status] || "blue"}.png`;
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", parseContributions);
    },
  });
};

interface GradientStop {
  count: number,
  color: number[],
}

class NominationMapClusterRenderer implements Renderer {
  render(cluster: Cluster, _stats: ClusterStats, _map: google.maps.Map): Marker {
    const gradient: GradientStop[] = [
      {
        count: 1,
        color: [68, 185, 0], // rgba(68, 185, 0, 1)
      }, {
        count: 10,
        color: [255, 183, 0], // rgba(255, 183, 0, 1)
      }, {
        count: 100,
        color: [224, 0, 0], // rgba(224, 0, 0, 1)
      }, {
        count: 1000,
        color: [186, 0, 233], // rgba(186, 0, 233, 1)
      }, {
        count: 10000,
        color: [48, 168, 224], // rgb(48, 168, 224)
      },
    ];
    let nextStop = 0;
    while ((++nextStop) < gradient.length - 1 && gradient[nextStop].count < cluster.count);
    const colorComponents =
      (cluster.count > gradient[nextStop].count)
        ? gradient[nextStop].color
        : weightNumericArray(
          gradient[nextStop - 1].color,
          gradient[nextStop].color,
          1 - (
            (cluster.count - gradient[nextStop - 1].count) /
            (gradient[nextStop].count - gradient[nextStop - 1].count)
          ),
        );

    const color = `rgb(${colorComponents.map(c => c.toString()).join(", ")})`;
    const svg = `<svg fill="${color}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="50" height="50">
<circle cx="120" cy="120" opacity=".6" r="70" />
<circle cx="120" cy="120" opacity=".3" r="90" />
<circle cx="120" cy="120" opacity=".2" r="110" />
<text x="50%" y="50%" style="fill: #fff; font-family: sans-serif; font-weight: bold;" text-anchor="middle" font-size="50" dominant-baseline="middle">${cluster.count}</text>
</svg>`;

    const title = `Cluster of ${cluster.count} contributions`;
    // Adjust zIndex to be above other markers
    const zIndex = Number(google.maps.Marker.MAX_ZINDEX) + cluster.count;

    const clusterOptions = {
      position: cluster.position,
      zIndex,
      title,
      icon: {
        url: `data:image/svg+xml;base64,${btoa(svg)}`,
        anchor: new google.maps.Point(25, 25),
      },
    };
    return new google.maps.Marker(clusterOptions);
  }
}
