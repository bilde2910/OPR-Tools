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

import { CheckboxEditor, NumericInputEditor, register } from "src/core";
import { untilTruthy, insertAfter } from "src/utils";
import { AnyReview } from "src/types";

import "./review-timer.css";

const REVIEW_EXPIRES_SECS = 1200;

export default () => {
  register()({
    id: "review-timer",
    name: "Review Timer",
    authors: ["tehstone", "bilde2910"],
    description: "Add review timer to OPR. Also adds an optional Smart Submit function that delays your submissions to prevent getting cooldowns.",
    defaultConfig: {
      smartSubmit: false,
      minDelay: 20,
      maxDelay: 30,
    },
    sessionData: {},
    initialize: (toolbox, _logger, config) => {
      config.setUserEditable("smartSubmit", {
        label: "Enable Smart Submit",
        help: "Smart Submit helps you avoid cooldowns by delaying your submission if you are reviewing quickly.",
        editor: new CheckboxEditor(),
      });
      config.setUserEditable("minDelay", {
        label: "Smart Submit minimum delay",
        editor: new NumericInputEditor({ min: 0 }),
      });
      config.setUserEditable("maxDelay", {
        label: "Smart Submit maximum delay",
        editor: new NumericInputEditor({ min: 0 }),
      });

      let submitButtonClicked = false;
      let expireTime = 0;

      let interval: any = 0;
      let rejectModalCheckTimer: any = 0;

      const injectTimer = async (candidate: AnyReview) => {
        submitButtonClicked = false;
        expireTime = candidate.expires;
        const container = await untilTruthy(() => document.querySelector("wf-logo")?.parentElement?.parentElement);
        let counter = document.getElementById("oprtmr-counter");
        if (counter === null) {
          const div = document.createElement("div");
          div.id = "oprtmr-outer";
          div.classList.add("oprtmr-div");
          const countLabel = document.createElement("p");
          countLabel.id = "oprtmr-counter-label";
          countLabel.textContent = "Time remaining:";
          counter = document.createElement("p");
          counter.id = "oprtmr-counter";
          counter.classList.add("oprtmr-counter");
          div.appendChild(countLabel);
          div.appendChild(counter);
          container.appendChild(div);

          if (interval) clearInterval(interval);
          interval = setInterval(() => updateTime(counter!, expireTime), 1000);
          updateTime(counter!, expireTime);
          addSmartSubmitButton();
        } else {
          counter.style.display = "block";
        }
      };

      const removeTimer = () => {
        if (interval) {
          clearInterval(interval);
          interval = 0;
        }
        if (rejectModalCheckTimer) {
          clearInterval(rejectModalCheckTimer);
          rejectModalCheckTimer = 0;
        }
        const timer = document.getElementById("oprtmr-outer");
        if (timer !== null) timer.remove();
      };

      const updateTime = (counter: HTMLElement, expiry: number) => {
        const diff = Math.ceil((expiry - new Date().getTime()) / 1000);
        if (diff < 0) {
          counter!.textContent = "Expired";
          return;
        }
        const minutes = Math.floor(diff / 60).toString().padStart(2, "0");
        const seconds = Math.abs(diff % 60).toString().padStart(2, "0");
        counter!.textContent = `${minutes}:${seconds}`;
      };

      const addSmartSubmitButton = () => {
        const buttons = document.getElementsByClassName("wf-split-button");
        if (buttons.length < 1) {
          setTimeout(addSmartSubmitButton, 400);
          return;
        }

        const smartSubmitEnabled = config.get("smartSubmit");
        for (let i = 0; i < buttons.length; i++) {
          let ssButton = document.getElementById(`oprtmr-ssb-${i}`) as HTMLButtonElement;
          if (!smartSubmitEnabled) {
            if (ssButton !== null) ssButton.style.display = "none";
            return;
          }
          if (ssButton === null) {
            ssButton = document.createElement("button");
            ssButton.classList.add("wf-button", "wf-split-button__main", "oprtmr-ssb");
            ssButton.disabled = true;
            ssButton.id = `oprtmr-ssb-${i}`;
            ssButton.textContent = "Smart Submit";
            ssButton.addEventListener("click", () => checkSubmitReview());
          }
          const sButton = buttons[i].firstElementChild! as HTMLElement;
          insertAfter(sButton, ssButton);
          sButton.style.display = "none";
        }

        addSubmitButtonObserver();
        addRejectModalCheck();
      };

      const addRejectModalCheck = () => {
        if (rejectModalCheckTimer) clearInterval(rejectModalCheckTimer);
        rejectModalCheckTimer = setInterval(() => {
          const rejectModal = document.querySelector("[id^=mat-dialog]");
          if (!rejectModal || rejectModal.childElementCount < 1) return;

          const isDupModal = rejectModal.children[0].tagName === "APP-CONFIRM-DUPLICATE-MODAL";
          const buttonId = `oprtmr-ssmb-${isDupModal ? "d" : "r"}`;
          const parent = document.getElementsByClassName("mat-dialog-actions");
          const selectionRequired = [
            "APP-APPROPRIATE-REJECTION-FLOW-MODAL",
            "APP-ACCURACY-REJECTION-FLOW-MODAL",
          ].includes(rejectModal.children[0].tagName);
          let ssButton = document.getElementById(buttonId) as HTMLButtonElement;
          if (ssButton === null) {
            const buttons = parent[0].getElementsByTagName("button");
            ssButton = document.createElement("button");
            ssButton.classList.add("wf-button", "wf-split-button__main", "wf-button--primary", "oprtmr-ssb");
            ssButton.style.marginLeft = "1.5rem";
            ssButton.id = buttonId;
            ssButton.textContent = "Smart Submit";
            ssButton.addEventListener("click", () => checkSubmitReview(true));
            insertAfter(buttons[1], ssButton);
            buttons[1].style.display = "none";
            if (selectionRequired) {
              addModalSubmitButtonObserver(buttonId, buttons[1]);
            }
          }
        }, 500);
      };

      const addSubmitButtonObserver = () => {
        const buttonWrapper = document.getElementsByTagName("wf-split-button");
        if (buttonWrapper.length < 1) {
          setTimeout(addSubmitButtonObserver, 250);
          return;
        }
        const button = buttonWrapper[0].querySelector<HTMLButtonElement>("button.wf-button--primary")!;
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.attributeName == "disabled") {
              for (let i = 0; i < buttonWrapper.length; i++) {
                const smartButton = document.getElementById(`oprtmr-ssb-${i}`) as HTMLButtonElement;
                toggleButtonClasses(smartButton, button);
              }
            }
          }
        });
        observer.observe(button, {
          attributes: true,
          attributeFilter: ["disabled"],
        });
      };

      const toggleButtonClasses = (smartButton: HTMLButtonElement, button: HTMLButtonElement) => {
        smartButton.disabled = button.disabled;
        smartButton.classList.toggle("wf-button--disabled", button.disabled);
        smartButton.classList.toggle("wf-button--primary", !button.disabled);
      };

      const addModalSubmitButtonObserver = (buttonId: string, button: HTMLButtonElement) => {
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.attributeName === "disabled") {
              const smartButton = document.getElementById(buttonId) as HTMLButtonElement;
              toggleButtonClasses(smartButton, button);
            }
          }
        });

        observer.observe(button, {
          attributes: true,
          attributeFilter: ["disabled"],
        });
      };

      const checkSubmitReview = (rejection = false) => {
        if (submitButtonClicked) return;
        submitButtonClicked = true;
        const diff = Math.ceil((expireTime - new Date().getTime()) / 1000);
        const delay = randomIntFromInterval(config.get("minDelay"), config.get("maxDelay"));
        if (diff + delay > REVIEW_EXPIRES_SECS) {
          updateButtonText(
            `Submitting in ${Math.abs(REVIEW_EXPIRES_SECS - delay - diff)}`,
            Math.abs(REVIEW_EXPIRES_SECS - delay - diff),
          );
        }
        waitToSubmit(delay, rejection);
      };

      const waitToSubmit = (delay: number, rejection: boolean) => {
        const diff = Math.ceil((expireTime - new Date().getTime()) / 1000);
        if (diff + delay < REVIEW_EXPIRES_SECS) {
          let btn;
          if (rejection) {
            const parent = document.getElementsByClassName("mat-dialog-container")[0];
            btn = parent.querySelector<HTMLButtonElement>("[class*='wf-button--primary'][style*='display: none;']");
          } else {
            btn = document.querySelector<HTMLButtonElement>("button[class=\"wf-button wf-split-button__main wf-button--primary\"]");
          }
          btn!.click();
        } else {
          updateButtonText(
            `Submitting in ${Math.abs(REVIEW_EXPIRES_SECS - delay - diff)}`,
            Math.abs(REVIEW_EXPIRES_SECS - delay - diff),
          );
          setTimeout(() => waitToSubmit(delay, rejection), 1000);
        }
      };

      const updateButtonText = (message: string, timeRemaining: number) => {
        let button;
        for (let i = 0; i < 5; i++) {
          button = document.getElementById(`oprtmr-ssb-${i}`);
          if (button === null) break;
          button.textContent = message;
        }
        button = document.getElementById("oprtmr-ssmb-r");
        if (button !== null) button.textContent = message;
        button = document.getElementById("oprtmr-ssmb-d");
        if (button !== null) button.textContent = message;

        const timerText = document.getElementById("oprtmr-counter");
        timerText!.style.display = "none";

        let counter = document.getElementById("oprtmr-subcounter");
        if (counter === null) {
          counter = document.createElement("p");
          counter.textContent = timeRemaining.toString();
          counter.id = "oprtmr-subcounter";
          counter.classList.add("oprtmr-counter");
          timerText!.parentNode!.appendChild(counter);
        } else {
          counter.textContent = timeRemaining.toString();
        }

        const counterLabel = document.getElementById("oprtmr-counter-label");
        counterLabel!.textContent = "Submitting in:";
        counterLabel!.style.fontWeight = "bold";
      };

      const randomIntFromInterval = (min: number, max: number) => {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/review", injectTimer);
      toolbox.interceptSendJson("/api/v1/vault/review", removeTimer);
    },
  });
};
