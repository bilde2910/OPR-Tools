// Copyright 2025 Tntnnbltn, bilde2910
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

import { CheckboxEditor, register } from "src/core";
import { untilTruthy, makeChildNode } from "src/utils";
import { AnyContribution, AnyEditContribution, ContributionStatus, ContributionType, EditContributionType, SubmissionsResult } from "src/types";
import { AppSubmissionsListItemElement } from "src/unsafe";

import "./contribution-management-layout.css";

interface DisplayedTag {
  style: "queue" | "accepted" | "rejected",
  label: string,
}

const STATUS_MAP: Record<ContributionStatus, DisplayedTag> = {
  [ContributionStatus.ACCEPTED]: {
    style: "accepted",
    label: "Accepted",
  },
  [ContributionStatus.APPEALED]: {
    style: "queue",
    label: "Appealed",
  },
  [ContributionStatus.DUPLICATE]: {
    style: "rejected",
    label: "Duplicate",
  },
  [ContributionStatus.HELD]: {
    style: "queue",
    label: "Held",
  },
  [ContributionStatus.NIANTIC_REVIEW]: {
    style: "queue",
    label: "NIA Voting",
  },
  [ContributionStatus.NOMINATED]: {
    style: "queue",
    label: "In Queue",
  },
  [ContributionStatus.REJECTED]: {
    style: "rejected",
    label: "Rejected",
  },
  [ContributionStatus.VOTING]: {
    style: "queue",
    label: "In Voting",
  },
  [ContributionStatus.WITHDRAWN]: {
    style: "rejected",
    label: "Withdrawn",
  },
};

export default () => {
  register()({
    id: "contribution-management-layout",
    name: "Contribution Management Layout",
    authors: ["Tntnnbltn", "bilde2910"],
    description: "Improves the layout of the Contribution Management page",
    defaultConfig: {
      showCurrentWayspotInfobox: true,
      showSummaryOfEdits: true,
    },
    sessionData: {},
    initialize: (toolbox, _logger, config) => {
      config.setUserEditable("showCurrentWayspotInfobox", {
        label: "Display current Wayspot details and interactive map for edits",
        editor: new CheckboxEditor(),
      });
      config.setUserEditable("showSummaryOfEdits", {
        label: "Display a summary of all edits for a given Wayspot",
        editor: new CheckboxEditor(),
      });

      const detectAppListItems = async (nominations: SubmissionsResult) => {
        const parentContainer = await untilTruthy(() => document.querySelector(".submissions"));
        // Scan existing elements
        const existingItems = parentContainer.querySelectorAll<AppSubmissionsListItemElement>("app-submissions-list-item");
        for (const item of existingItems) formatItem(item, nominations.submissions);
        // Set up MutationObserver for new elements
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeName === "APP-SUBMISSIONS-LIST-ITEM") {
                formatItem(node as AppSubmissionsListItemElement, nominations.submissions);
              }
            }
          }
        });
        observer.observe(parentContainer, {
          childList: true,
          subtree: true,
        });
      };

      const formatItem = (item: AppSubmissionsListItemElement, nominations: AnyContribution[]) => {
        const data = item.__ngContext__[22];
        modifyPhoto(item, data);
        if (data.type !== ContributionType.NOMINATION) {
          updateRejectionLabels(item, data);
        }
        item.addEventListener("click", () => {
          void interceptDetailsPane(data, nominations);
        });
      };

      const modifyPhoto = (item: AppSubmissionsListItemElement, data: AnyContribution) => {
        const imageElements = item.querySelectorAll("img");
        if (imageElements.length > 1) {
          const selectedImage = imageElements[1];
          selectedImage.classList.add("oprcml-list-image");
          if (data.type === "PHOTO") {
            selectedImage.src = data.imageUrl;
          }
        }
      };

      const updateRejectionLabels = (item: AppSubmissionsListItemElement, data: AnyEditContribution) => {
        // Remove oprcml-overturned class if already present
        const overturnedTags = item.querySelectorAll(".oprcml-overturned");
        for (let i = overturnedTags.length - 1; i >= 0; i--) overturnedTags[i].remove();
        // If the current Wayspot data matches the rejected edit data, mark it as "overturned".
        if (wasOverturned(data)) {
          const nominationTagSet = item.querySelector("app-submission-tag-set");
          if (nominationTagSet) {
            const newTag = makeChildNode(nominationTagSet, "app-submission-tag");
            newTag.classList.add("mr-1", "oprcml-overturned");
            const newTagContent = makeChildNode(newTag, "div");
            newTagContent.classList.add("submission-tag", "ng-star-inserted");
            const newSpan = makeChildNode(newTagContent, "span", "Overturned");
            newSpan.classList.add("submission-tag--accepted");
          }
        }
      };

      const interceptDetailsPane = async (data: AnyContribution, nominations: AnyContribution[]) => {
        await addCoordinates(data);

        const containers = document.querySelectorAll(".oprcml-details-container");
        for (let i = containers.length - 1; i >= 0; i--) containers[i].remove();
        const summaries = document.querySelectorAll(".oprcml-edits-summary");
        for (let i = summaries.length - 1; i >= 0; i--) summaries[i].remove();
        const detailsSections = document.querySelectorAll(".details-pane__section");

        // Unhide things that may have been hidden on the Edits page
        const hiddenItems = document.querySelectorAll(".oprcml-hidden");
        for (let i = hiddenItems.length - 1; i >= 0; i--) {
          hiddenItems[i].classList.remove(".oprcml-hidden");
        }

        if (data.type === ContributionType.NOMINATION) return;

        const detailsContainer = document.createElement("div");
        detailsContainer.classList.add("oprcml-details-container");
        let mapDiv: HTMLElement | null = null;
        let infoboxDiv: HTMLElement | null = null;

        if (config.get("showCurrentWayspotInfobox")) {
          infoboxDiv = makeChildNode(detailsContainer, "div");
          infoboxDiv.classList.add("oprcml-details-column");
          mapDiv = makeChildNode(detailsContainer, "div", "Location");
          mapDiv.classList.add("oprcml-map-column");

          makeChildNode(infoboxDiv, "div", "Current Wayspot Details");
          const wayspotDetails = makeChildNode(infoboxDiv, "div");
          wayspotDetails.classList.add("oprcml-wayspot-details");

          // Title
          const titleContainer = makeChildNode(wayspotDetails, "div");
          titleContainer.classList.add("oprcml-wayspot-title-container");
          const title = makeChildNode(titleContainer, "div", data.poiData.title);
          title.classList.add("oprcml-wd-title");

          // Status
          const statusContainer = makeChildNode(titleContainer, "div");
          statusContainer.classList.add("flex", "flex-wrap", "nominations-item__tags");
          const statusTag = makeChildNode(statusContainer, "div");
          statusTag.classList.add("submission-tag", "ng-star-inserted");

          if (data.poiData.state === "LIVE") {
            const statusSpan = makeChildNode(statusTag, "span", "Live");
            statusSpan.classList.add("submission-tag--accepted", "ng-star-inserted");
            statusContainer.classList.add("oprcml-status-live");
          } else if (data.poiData.state === "RETIRED") {
            const statusSpan = makeChildNode(statusTag, "span", "Retired");
            statusSpan.classList.add("submission-tag--rejected", "ng-star-inserted");
            statusContainer.classList.add("oprcml-status-retired");
            statusContainer.title = `Wayspot retired on ${data.poiData.lastUpdateDate}`;
          }

          // Image
          const image = makeChildNode(wayspotDetails, "img") as HTMLImageElement;
          image.classList.add("oprcml-wd-image");
          image.src = data.poiData.imageUrl;

          // Description
          const description = makeChildNode(wayspotDetails, "div", data.poiData.description || "<No Description>");
          description.classList.add("oprcml-wd-description");

          image.addEventListener("click", () => {
            window.open(`${data.poiData.imageUrl}=s0`, "_blank");
          });

          if (detailsSections.length >= 1) {
            // Hide the "Current Wayspot" data
            if (data.type === ContributionType.PHOTO) {
              const elementsToHide = detailsSections[0].querySelectorAll(":scope > *:nth-child(-n+2)");
              for (const element of elementsToHide) element.classList.add("oprcml-hidden");
            } else {
              detailsSections[0].children[0].classList.add("oprcml-hidden");
            }
          }
          if (detailsSections.length >= 2) {
            // For the static map
            const elementsToHide = detailsSections[1].querySelectorAll(":scope > *:nth-child(-n+2");
            for (const element of elementsToHide) element.classList.add("oprcml-hidden");
          }
        }

        const secondDetailsSection = detailsSections[1];
        if (secondDetailsSection) {
          secondDetailsSection.parentNode!.insertBefore(detailsContainer, secondDetailsSection);
        }

        if (config.get("showCurrentWayspotInfobox")) {
          void addSatMap(data, mapDiv!, infoboxDiv!);
        }

        if (config.get("showSummaryOfEdits") && data.type.startsWith("EDIT")) {
          const wayspotEdits = findWayspotEdits(data, nominations);

          // Create container for all edit tables
          const editsSummaryContainer = document.createElement("div");
          editsSummaryContainer.classList.add("oprcml-edits-summary");

          // Check if there are edits for each type and insert containers accordingly
          const editTypes: { type: EditContributionType, label: string }[] = [
            {
              type: ContributionType.EDIT_TITLE,
              label: "Your Title Edits",
            }, {
              type: ContributionType.EDIT_DESCRIPTION,
              label: "Your Description Edits",
            }, {
              type: ContributionType.EDIT_LOCATION,
              label: "Your Location Edits",
            },
          ];

          for (const editType of editTypes) {
            if (wayspotEdits.some(edit => edit.type === editType.type)) {
              const editsContainer = makeChildNode(editsSummaryContainer, "div");
              editsContainer.classList.add("oprcml-edits-container");
              const editsHeader = makeChildNode(editsContainer, "div", editType.label);
              editsHeader.classList.add("oprcml-edits-summary-header");

              const edits = wayspotEdits.filter(n => n.type === editType.type);
              const editsTable = generateEditSummaryTable(edits, editType.type);
              editsContainer.appendChild(editsTable);
            }
          }

          detailsContainer.parentNode!.insertBefore(editsSummaryContainer, detailsContainer);
        }
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/manage", detectAppListItems);
    },
  });
};

const findWayspotEdits = (data: AnyEditContribution, nominations: AnyContribution[]) =>
  nominations
    .filter(n => n.type !== ContributionType.NOMINATION)
    .filter(n => n.poiData.id === data.poiData.id);

const wasOverturned = (data: AnyEditContribution) =>
  data.status === ContributionStatus.REJECTED &&
  (
    (data.type === ContributionType.EDIT_TITLE && data.title.trim() === data.poiData.title.trim()) ||
    (data.type === ContributionType.EDIT_DESCRIPTION && data.description.trim() === data.poiData.description.trim()) ||
    (data.type === ContributionType.EDIT_LOCATION && data.lat === data.poiData.lat && data.lng === data.poiData.lng) ||
    (data.type === ContributionType.PHOTO && data.imageUrl === data.poiData.imageUrl)
  );

const generateNominationTag = (data: AnyEditContribution) => {
  const tag: DisplayedTag = wasOverturned(data)
    ? { style: "accepted", label: "Overturned" }
    : STATUS_MAP[data.status];
  const asTag = document.createElement("app-submission-tag");
  const subTag = makeChildNode(asTag, "div");
  subTag.classList.add("submission-tag");
  makeChildNode(subTag, "span", tag.label).classList.add(`submission-tag--${tag.style}`);
  return asTag;
};

const addCoordinates = async (data: AnyContribution) => {
  const lat = "lat" in data.poiData ? data.poiData.lat : data.lat;
  const lng = "lng" in data.poiData ? data.poiData.lng : data.lng;
  const locationP = await untilTruthy(() => document.querySelector<HTMLParagraphElement>("app-submissions app-details-pane p"));
  const coordinates = `${lat},${lng}`;
  const newText = `${data.city} ${data.state} (${coordinates})`;
  locationP.textContent = newText;
  locationP.style.cursor = "pointer";
  locationP.title = "Copy coordinates to clipboard";
  locationP.addEventListener("click", () => {
    void navigator.clipboard.writeText(coordinates);
  });
};

const generateEditSummaryTable = (edits: AnyEditContribution[], type: EditContributionType) => {
  // Sort edits by date in descending order (most recent to oldest)
  edits.sort((a, b) => b.order - a.order);

  const table = document.createElement("table");
  table.classList.add("oprcml-edit-summary-table");

  // Populate table with edit data
  for (const edit of edits) {
    const content = (() => {
      switch (type) {
        case ContributionType.EDIT_TITLE: return edit.title;
        case ContributionType.EDIT_DESCRIPTION: return edit.description;
        case ContributionType.EDIT_LOCATION: return `${edit.lat}, ${edit.lng}`;
        default: return undefined;
      }
    })();
    const row = table.insertRow();
    makeChildNode(row, "td", edit.day);
    makeChildNode(row, "td", content);
    const cell3 = makeChildNode(row, "td");
    cell3.appendChild(generateNominationTag(edit));
  }

  return table;
};

const addSatMap = async (selected: AnyEditContribution, mapDiv: HTMLElement, infoboxDiv: HTMLElement) => {
  await untilTruthy(() => typeof google !== "undefined");

  let svMapElement = document.getElementById("oprt-nomination-satmap");
  if (!svMapElement) {
    svMapElement = makeChildNode(mapDiv, "div");
    svMapElement.classList.add("oprcml-satmap");
    svMapElement.id = "oprt-nomination-satmap";

    // Create an image element to track the image's loading status
    // This helps make sure that the map window is the right height
    const image = new Image();
    image.src = selected.poiData.imageUrl;
    image.style.display = "none";

    image.addEventListener("load", () => {
      const detailsColumnHeight = parseFloat(getComputedStyle(infoboxDiv).height);
      svMapElement!.style.height = `${detailsColumnHeight - 31}px`;
    });

    // Append the image element to the document body to trigger image loading
    document.body.appendChild(image);
  }

  const { lat, lng } = selected.poiData;
  const currentLocation = new google.maps.LatLng(lat, lng);
  const svMap = new google.maps.Map(svMapElement, {
    center: { lat, lng },
    mapTypeId: "hybrid",
    zoom: 17,
    scaleControl: true,
    scrollwheel: true,
    gestureHandling: "greedy",
    mapTypeControl: true,
    tiltInteractionEnabled: true,
  });

  if (selected.type === ContributionType.EDIT_LOCATION) {
    if (selected.lat !== lat || selected.lng !== lng) {
      const suggestedLocation = new google.maps.LatLng(selected.lat, selected.lng);
      new google.maps.Marker({
        map: svMap,
        position: suggestedLocation,
        icon: generateSvgMapMarker("#08CA00"),
        zIndex: 4,
      });
      const polylineOptions: google.maps.PolylineOptions = {
        map: svMap,
        path: [currentLocation, suggestedLocation],
        strokeOpacity: 1,
        geodesic: true,
      };
      new google.maps.Polyline({
        ...polylineOptions,
        strokeColor: "#08CA00",
        strokeWeight: 2,
        zIndex: 2,
        icons: [{ icon: {
          path: "M 0,0 3,6 M 0,0 -3,6",
        }}],
      });
      new google.maps.Polyline({
        ...polylineOptions,
        strokeColor: "#ffffff",
        strokeWeight: 6,
        zIndex: 1,
        icons: [{ icon: {
          path: "M 0,0 1,2 M 0,0 -1,2",
        }}],
      });
    }
  }

  new google.maps.Marker({
    map: svMap,
    position: { lat, lng },
    icon: generateSvgMapMarker("#000000"),
    zIndex: 3,
  });
};

const generateSvgMapMarker = (fillColor: string) => {
  const icon = `<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg"
  width="24" height="24" viewBox="0 0 24 24"
  fill="${fillColor}" stroke="#FFFFFF"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  class="feather feather-map-pin">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
</svg>`;
  return `data:image/svg+xml;base64,${btoa(icon)}`;
};
