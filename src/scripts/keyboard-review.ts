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

import { register } from "src/core";
import { unilTruthy } from "src/utils";
import { AnyReview, EditReview, NewReview, PhotoReview } from "src/types";

import "./keyboard-review.scss";

class InvalidContextError extends Error {
  constructor() {
    super("Invalid context type");
  }
}

class ThumbCard {
  id: string;
  opens: string;
  constructor(id: string, opens: string) {
    this.id = id;
    this.opens = opens;
  }

  isDialogOpen() {
    return isDialogOpen(this.opens);
  }
}

const ThumbCards = {
  APPROPRIATE: new ThumbCard(
    "appropriate-card",
    "app-appropriate-rejection-flow-modal"
  ),
  SAFE: new ThumbCard(
    "safe-card",
    "app-safe-rejection-flow-modal"
  ),
  ACCURATE: new ThumbCard(
    "accurate-and-high-quality-card",
    "app-accuracy-rejection-flow-modal"
  ),
  PERMANENT: new ThumbCard(
    "permanent-location-card",
    "app-location-permanent-rejection-flow-modal"
  ),
};

type KeyHandler = (e: KeyboardEvent) => void;
type KeyHandlerMap = Record<string, KeyHandler>;

enum RenderContextType {
  NULL = "NULL",
  NEW = "NEW",
  EDIT = "EDIT",
  PHOTO = "PHOTO",
}

interface RenderContext {
  draw: () => void,
  extraKeys?: () => KeyHandlerMap,
  navigable: boolean,
}

interface CardNavigatingContext extends RenderContext {
  currentCard: number,
  nextCard: () => void,
  prevCard: () => void,
  navigable: true,
}

interface NullRenderContext extends RenderContext {
  type: RenderContextType.NULL,
  navigable: false,
}

interface NewRenderContext extends CardNavigatingContext {
  type: RenderContextType.NEW,
  cards: {
    id: string,
    draw: (card: HTMLElement) => void,
    extraKeys: () => KeyHandlerMap,
  }[],
}

interface EditRenderContext extends CardNavigatingContext {
  type: RenderContextType.EDIT,
  cards: {
    selector: string,
    draw: (card: HTMLElement) => void,
    extraKeys: () => KeyHandlerMap,
  }[],
  markers: google.maps.Marker[],
}

interface PhotoRenderContext extends RenderContext {
  type: RenderContextType.PHOTO,
  cards: NodeListOf<HTMLElement>,
  navigable: false,
}

type AnyRenderContext = NullRenderContext | NewRenderContext | EditRenderContext | PhotoRenderContext;

export default () => {
  register()({
    id: "keyboard-review",
    name: "Keyboard Review",
    authors: ["tehstone", "bilde2910"],
    description: "Add keyboard review to OPR",
    defaultConfig: {},
    sessionData: {},
    initialize: (toolbox, _config) => {
      let kdEvent: KeyHandler | null = null;
      let keySequence: string | null = null;
      let context: AnyRenderContext = {
        type: RenderContextType.NULL,
        navigable: false,
        draw: () => {},
      };

      (() => {
        document.addEventListener("keyup", e => {
          if (e.key === "Shift") {
            keySequence = null;
            redrawUI();
          }
        });
      })();

      const initKeyboardCtrl = (candidate: AnyReview) => {
        if (kdEvent) {
          toolbox.warn("Keydown event was not freed!");
          freeHandler();
        }
        if (candidate.type === "NEW") initForNew(candidate);
        else if (candidate.type === "EDIT") initForEdit(candidate);
        else if (candidate.type === "PHOTO") initForPhoto(candidate);
      };

      const makeKeyMap = (map: KeyHandlerMap) => (e: KeyboardEvent) => {
        let inputActive = false;
        const ae = document.activeElement as HTMLElement | null;
        if (ae?.tagName == "TEXTAREA") inputActive = true;
        if (ae?.tagName == "INPUT" && !["radio", "checkbox"].includes((ae as HTMLInputElement).type.toLowerCase())) inputActive = true;
        if (inputActive && (e.code.startsWith("Numpad") || e.code.startsWith("Key") || e.code.startsWith("Digit"))) return;

        if (e.shiftKey && e.code.startsWith("Digit")) keySequence = "+" + e.code.substring(5);
        else if (e.shiftKey && e.code.startsWith("Numpad")) keySequence = "+" + e.code.substring(6);
        let idx = keySequence ? keySequence + "," : "";
        if (!keySequence && e.shiftKey) idx += "+";
        if (e.ctrlKey) idx += "^";
        if (e.altKey) idx += "[";

        if (e.code.startsWith("Key")) idx += e.code.substring(3);
        else if (!keySequence && e.code.startsWith("Digit")) idx += e.code.substring(5);
        else if (!keySequence && e.code.startsWith("Numpad")) idx += e.code.substring(6);
        else if (keySequence) idx = keySequence;
        else if (["Shift", "Control", "Alt"].includes(e.key)) return;
        else idx += e.code;
        if (idx in map) {
          map[idx](e);
          e.preventDefault();
          e.stopPropagation();
        }
        redrawUI();
      };

      const initForNew = (candidate: NewReview) => {
        const drawThumbCard = (card: Element) => {
          const idkBtn = card.querySelector(".dont-know-button");
          if (idkBtn) restyle(idkBtn, "btn-key", "key-bracket-3");
          const helpBtn = card.querySelector(".question-subtitle-tooltip");
          if (helpBtn) restyle(helpBtn, "btn-key", "key-bracket-H");
          const btns = card.querySelectorAll("button.thumbs-button");
          for (const btn of btns) {
            restyle(btn, "btn-key", "btn-key-pad");
            const btnIcon = btn.querySelector("mat-icon")?.textContent;
            if (btnIcon === "thumb_up") restyle(btn, "key-bracket-1");
            else if (btnIcon === "thumb_down") restyle(btn, "key-bracket-2");
          }

          const boxes = card.querySelectorAll("label > *:last-child");
          for (let i = 0; i < boxes.length; i++) {
            const btnKey = (i + 4).toString();
            const label = drawNew("span");
            label.classList.add("oprkr2-key-label");
            label.classList.add(`oprkr2-data-key-${btnKey}`);
            label.textContent = `[${btnKey}]`;
            if (boxes[i].classList.contains("mat-radio-label-content")) {
              const textNode = boxes[i].querySelector("div");
              textNode!.insertBefore(label, textNode!.firstChild);
            } else {
              boxes[i].parentNode!.insertBefore(label, boxes[i]);
            }
          }

          restyle(card.querySelector(".title-and-subtitle-row")!, "thumb-card-tassr");
          restyle(card.querySelector(".action-buttons-row")!, "thumb-card-btnr");
        };

        const findKeyBtnInCard = (key: string) => {
          if (context.type !== RenderContextType.NEW) throw new InvalidContextError();
          return document.querySelector<HTMLElement>(
            `#${context.cards[context.currentCard].id} .oprkr2-eds-key-bracket-${key}`
          );
        };
        const clickThumbCardBox = (key: string) => {
          if (context.type !== RenderContextType.NEW) throw new InvalidContextError();
          if (!context.type) return;
          const btn = document.querySelector<HTMLElement>(
            `#${context.cards[context.currentCard].id} .oprkr2-data-key-${key}`
          );
          if (btn) btn.closest("label")!.click();
        };

        const thumbCardKeys = (dialog: boolean) => () => ({
          "1": () => {
            if (context.type !== RenderContextType.NEW) throw new InvalidContextError();
            if (isDialogOpen()) return;
            findKeyBtnInCard("1")!.click();
            context.nextCard();
          },
          "2": () => {
            if (context.type !== RenderContextType.NEW) throw new InvalidContextError();
            if (isDialogOpen()) return;
            findKeyBtnInCard("2")!.click();
            if (!dialog) context.nextCard();
            else waitForDialog().then(() => redrawUI());
          },
          "3": () => {
            if (context.type !== RenderContextType.NEW) throw new InvalidContextError();
            if (isDialogOpen()) return;
            findKeyBtnInCard("3")!.click();
            context.nextCard();
          },
          "4": () => clickThumbCardBox("4"),
          "5": () => clickThumbCardBox("5"),
          "6": () => clickThumbCardBox("6"),
          "7": () => clickThumbCardBox("7"),
          "8": () => clickThumbCardBox("8"),
          "9": () => clickThumbCardBox("9"),
          "H": () => {
            if (isDialogOpen()) return;
            const help = findKeyBtnInCard("H");
            if (help) help.click();
            waitForDialog().then(() => redrawUI());
          }
        });

        const dupImgs = document.querySelectorAll<HTMLImageElement>(
          "#check-duplicates-card nia-map ~ * div.overflow-x-auto img.cursor-pointer"
        );

        context = {
          type: RenderContextType.NEW,
          navigable: true,
          draw: () => {
            if (context.type !== RenderContextType.NEW) throw new InvalidContextError();
            if (isDialogOpen()) {
              if (isDialogClosing()) {
                unilTruthy(() => !isDialogClosing()).then(() => redrawUI());
                return;
              } else if (ThumbCards.APPROPRIATE.isDialogOpen()) {
                const btns = document.querySelectorAll("mat-dialog-container mat-radio-button");
                for (const btn of btns) {
                  let btnKey = "";
                  switch (btn.querySelector<HTMLInputElement>("input[type=radio]")?.value) {
                    case "PRIVATE": btnKey = "P"; break;
                    case "INAPPROPRIATE": btnKey = "I"; break;
                    case "SCHOOL": btnKey = "K"; break;
                    case "SENSITIVE": btnKey = "S"; break;
                    case "EMERGENCY": btnKey = "E"; break;
                    case "GENERIC": btnKey = "G"; break;
                    default: continue;
                  }
                  const label = drawNew("span");
                  label.classList.add("oprkr2-key-label");
                  label.textContent = `[\u{1f879}${btnKey}] `;
                  const textNode = btn.querySelector(".mat-radio-label-content > div");
                  textNode!.insertBefore(label, textNode!.firstChild);
                }
              } else if (isDialogOpen("app-report-modal")) {
                const aahqrl10n = toolbox.i18nPrefixResolver("review.report.modal.");
                const btns = document.querySelectorAll("mat-dialog-container wf-checkbox");
                let btnKey = "";
                for (const btn of btns) {
                  const lbl = btn.querySelector(".mat-checkbox-label")?.textContent?.trim();
                  switch(lbl) {
                    case aahqrl10n("fake"): btnKey = "+5,F"; break;
                    case aahqrl10n("explicit"): btnKey = "+5,X"; break;
                    case aahqrl10n("influencing"): btnKey = "+5,I"; break;
                    case aahqrl10n("offensive"): btnKey = "+5,O"; break;
                    case aahqrl10n("abuse"): btnKey = "+5,A"; break;
                    default: continue;
                  }
                  const label = keyLabel(btnKey);
                  const eLbl = btn.querySelector(".mat-checkbox-label")!;
                  eLbl.parentNode!.insertBefore(label, eLbl);
                }
              } else if (ThumbCards.ACCURATE.isDialogOpen()) {
                const aahqrl10n = toolbox.i18nPrefixResolver("review.new.question.accurateandhighquality.reject.");
                const btns = document.querySelectorAll("mat-dialog-container wf-checkbox");
                for (const btn of btns) {
                  const lbl = btn.querySelector(".mat-checkbox-label")!.textContent?.trim();
                  const panel = btn.closest("mat-expansion-panel");
                  const pnl = panel ? panel.querySelector("mat-panel-title > div > div")!.textContent?.trim() : null;
                  let btnKey = "";
                  switch (pnl) {
                    case null:
                      switch (lbl) {
                        case aahqrl10n("inaccuratelocation"): btnKey = "L"; break;
                        default: continue;
                      }
                      break;
                    case aahqrl10n("photos"):
                      switch (lbl) {
                        case aahqrl10n("photos.blurry"): btnKey = "1,B"; break;
                        case aahqrl10n("photos.face"): btnKey = "1,F"; break;
                        case aahqrl10n("photos.license"): btnKey = "1,L"; break;
                        case aahqrl10n("photos.orientation"): btnKey = "1,O"; break;
                        case aahqrl10n("photos.identifiable"): btnKey = "1,I"; break;
                        case aahqrl10n("photos.thirdparty"): btnKey = "1,T"; break;
                        case aahqrl10n("photos.watermark"): btnKey = "1,W"; break;
                        case aahqrl10n("photos.lowquality"): btnKey = "1,Q"; break;
                        default: continue;
                      }
                      break;
                    case aahqrl10n("title"):
                      switch (lbl) {
                        case aahqrl10n("title.emoji"): btnKey = "2,E"; break;
                        case aahqrl10n("title.url"): btnKey = "2,U"; break;
                        case aahqrl10n("title.quality"): btnKey = "2,Q"; break;
                        default: continue;
                      }
                      break;
                    case aahqrl10n("description"):
                      switch (lbl) {
                        case aahqrl10n("description.emoji"): btnKey = "3,E"; break;
                        case aahqrl10n("description.url"): btnKey = "3,U"; break;
                        case aahqrl10n("description.quality"): btnKey = "3,Q"; break;
                        default: continue;
                      }
                      break;
                    case aahqrl10n("abuse"):
                      switch (lbl) {
                        case aahqrl10n("abuse.fakenomination"): btnKey = "4,F"; break;
                        case aahqrl10n("abuse.explicit"): btnKey = "4,X"; break;
                        case aahqrl10n("abuse.influencing"): btnKey = "4,I"; break;
                        case aahqrl10n("abuse.offensive"): btnKey = "4,O"; break;
                        case aahqrl10n("abuse.other"): btnKey = "4,A"; break;
                        default: continue;
                      }
                      break;
                  }
                  const label = keyLabel(btnKey);
                  const eLbl = btn.querySelector(".mat-checkbox-label")!;
                  eLbl.parentNode!.insertBefore(label, eLbl);
                }
                const panels = document.querySelectorAll("mat-dialog-container mat-accordion mat-expansion-panel");
                for (let i = 0; i < panels.length; i++) {
                  const lbl = panels[i].querySelector("mat-panel-title")!;
                  let btnKey = "";
                  switch (lbl.querySelector("div > div")?.textContent?.trim()) {
                    case aahqrl10n("photos"): btnKey = "1"; break;
                    case aahqrl10n("title"): btnKey = "2"; break;
                    case aahqrl10n("description"): btnKey = "3"; break;
                    case aahqrl10n("abuse"): btnKey = "4"; break;
                    default: continue;
                  }
                  const label = keyLabel(btnKey);
                  lbl.parentNode!.insertBefore(label, lbl);
                }
              } else if (isDialogOpen("app-confirm-duplicate-modal")) {
                const cancelBtn = document.querySelector("mat-dialog-container .mat-dialog-actions button.wf-button");
                if (cancelBtn) restyle(cancelBtn, "btn-key", "btn-key-pad", "key-bracket-Esc");
              }
              const l10n = toolbox.l10n;
              const actions = document.querySelectorAll("mat-dialog-container .mat-dialog-actions button.wf-button");
              for (let i = 0; i < actions.length; i++) {
                if (actions[i].textContent == l10n["modal.close"]) {
                  restyle(actions[i], "btn-key", "btn-key-pad", "key-bracket-Esc");
                  break;
                }
              }
              const submitBtn = document.querySelector("mat-dialog-container .mat-dialog-actions button.wf-button--primary");
              if (submitBtn) restyle(submitBtn, "btn-key", "btn-key-pad", "key-bracket-Enter");
            } else {
              const cc = context.cards[context.currentCard];
              const card = document.getElementById(cc.id);
              if (card) {
                restyle(card, "highlighted");
                cc.draw(card);
                /*card.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center'
                });*/
              } else {
                unilTruthy(() => document.getElementById(cc.id)).then(() => redrawUI());
              }
            }
          },
          cards: [
            {
              id: "check-duplicates-card",
              draw: (card) => {
                if (dupImgs.length > 0) {
                  const dupImgBox = card.querySelector("#check-duplicates-card nia-map ~ * div.overflow-x-auto");
                  const dupeHelp = drawNew("p");
                  const dhK1 = document.createElement("span");
                  dhK1.classList.add("oprkr2-key-span");
                  dhK1.textContent = "[Alt]+[";
                  const dhK2 = document.createElement("span");
                  dhK2.classList.add("oprkr2-key-span");
                  dhK2.classList.add("oprkr2-key-span-wildcard");
                  dhK2.textContent = "letter";
                  const dhK3 = document.createElement("span");
                  dhK3.classList.add("oprkr2-key-span");
                  dhK3.textContent = "]";
                  const dhK4 = document.createElement("span");
                  dhK4.classList.add("oprkr2-key-span");
                  dhK4.textContent = "[Alt]+[Shift]+[";
                  const dhK5 = document.createElement("span");
                  dhK5.classList.add("oprkr2-key-span");
                  dhK5.classList.add("oprkr2-key-span-wildcard");
                  dhK5.textContent = "letter";
                  const dhK6 = document.createElement("span");
                  dhK6.classList.add("oprkr2-key-span");
                  dhK6.textContent = "]";
                  dupeHelp.appendChild(document.createTextNode("Press "));
                  dupeHelp.appendChild(dhK1);
                  dupeHelp.appendChild(dhK2);
                  dupeHelp.appendChild(dhK3);
                  dupeHelp.appendChild(document.createTextNode(" to pick a duplicate, or "));
                  dupeHelp.appendChild(dhK4);
                  dupeHelp.appendChild(dhK5);
                  dupeHelp.appendChild(dhK6);
                  dupeHelp.appendChild(document.createTextNode(" to open its photo in full screen"));
                  dupImgBox!.parentNode!.insertBefore(dupeHelp, dupImgBox);

                  for (let i = 0; i < dupImgs.length && i < 26; i++) {
                    const dpbox = drawNew("div");
                    dpbox.classList.add("oprkr2-dupe-key-box");
                    dupImgs[i].parentNode!.insertBefore(dpbox, dupImgs[i]);
                    const inner = document.createElement("div");
                    inner.textContent = String.fromCharCode(65 + i);
                    dpbox.appendChild(inner);
                  }

                  const dupeBtn = card.querySelectorAll(".agm-info-window-content button.wf-button--primary");
                  for (let i = 0; i < dupeBtn.length; i++) {
                    if (dupeBtn[i] && dupeBtn[i].closest("body")) {
                      restyle(dupeBtn[i], "btn-key", "key-bracket-Enter");
                      break;
                    }
                  }
                }
              },
              extraKeys: () => {
                const dupKeys: KeyHandlerMap = {
                  "Enter": () => {
                    if (!isDialogOpen()) {
                      const dupeBtns = document.querySelectorAll<HTMLElement>("#check-duplicates-card .agm-info-window-content button.wf-button--primary");
                      for (const dupeBtn of dupeBtns) {
                        if (dupeBtn && dupeBtn.closest("body")) {
                          dupeBtn.click();
                          unilTruthy(() => document.querySelector("mat-dialog-container > *")).then(() => redrawUI());
                          break;
                        }
                      }
                    } else {
                      handleEnterNew();
                    }
                  },
                  "Escape": () => {
                    if (isDialogOpen("app-confirm-duplicate-modal")) {
                      const cancelBtn = document.querySelector<HTMLElement>("mat-dialog-container .mat-dialog-actions button.wf-button");
                      cancelBtn!.click();
                      unilTruthy(() => !isDialogOpen()).then(() => redrawUI());
                    }
                  },
                };
                for (let i = 0; i < dupImgs.length && i < 26; i++) {
                  const key = String.fromCharCode(65 + i);
                  const img = dupImgs[i];
                  dupKeys[`[${key}`] = () => {
                    img.click();
                    unilTruthy(() => document.activeElement!.tagName === "IMG").then(() => {
                      (document.activeElement! as HTMLImageElement).blur();
                      redrawUI();
                    });
                  };
                  dupKeys[`+[${key}`] = () => window.open(`${img.src}=s0`);
                }
                return dupKeys;
              }
            }, {
              id: "appropriate-card",
              draw: drawThumbCard,
              extraKeys: thumbCardKeys(true)
            }, {
              id: "safe-card",
              draw: drawThumbCard,
              extraKeys: thumbCardKeys(true)
            }, {
              id: "accurate-and-high-quality-card",
              draw: drawThumbCard,
              extraKeys: thumbCardKeys(true)
            }, {
              id: "permanent-location-card",
              draw: drawThumbCard,
              extraKeys: thumbCardKeys(true)
            }, {
              id: "socialize-card",
              draw: drawThumbCard,
              extraKeys: thumbCardKeys(false)
            }, {
              id: "exercise-card",
              draw: drawThumbCard,
              extraKeys: thumbCardKeys(false)
            }, {
              id: "explore-card",
              draw: drawThumbCard,
              extraKeys: thumbCardKeys(false)
            }, {
              id: "categorization-card",
              draw: card => {
                const labels = card.querySelectorAll("mat-button-toggle-group > div");
                for (let i = 0; i < labels.length; i++) {
                  restyle(labels[i], "btn-key", `key-bracket-${i + 1}`, "btn-key-no-highlight", "btn-key-pad");
                }
                const catBox = card.querySelector("mat-button-toggle-group");
                if (catBox) {
                  const catHelp = drawNew("p");
                  const noAllKey = document.createElement("span");
                  noAllKey.classList.add("oprkr2-key-span");
                  noAllKey.textContent = "[Tab]";
                  catHelp.appendChild(document.createTextNode("Press "));
                  catHelp.appendChild(noAllKey);
                  catHelp.appendChild(document.createTextNode(" set all options to \"No\""));
                  catBox.parentNode!.insertBefore(catHelp, catBox);
                }
              },
              extraKeys: () => {
                const setAllNo = (evenIfYes: boolean) => {
                  const rows = document.querySelectorAll("#categorization-card mat-button-toggle-group");
                  for (let i = 0; i < rows.length; i++) {
                    if (evenIfYes || !rows[i].querySelector("mat-button-toggle.mat-button-toggle-checked")) {
                      rows[i].querySelector<HTMLButtonElement>("mat-button-toggle:last-of-type button")!.click();
                    }
                  }
                };
                const toggleYN = (key: string) => {
                  setAllNo(false);
                  const label = document.querySelector(`#categorization-card .oprkr2-eds-key-bracket-${key}`);
                  const opts = label!.closest("mat-button-toggle-group")!.querySelectorAll("mat-button-toggle");
                  for (let i = 0; i < opts.length; i++) {
                    if (!opts[i].classList.contains("mat-button-toggle-checked")) {
                      opts[i].querySelector<HTMLButtonElement>("button")!.click(); break;
                    }
                  }
                };
                const keys: KeyHandlerMap = {
                  "Tab": () => setAllNo(true)
                };
                let i = 1;
                while (i <= candidate.categoryIds.length) {
                  const key = (i++).toString();
                  keys[key] = () => toggleYN(key);
                }
                return keys;
              }
            }
          ],
          currentCard: 1,
          nextCard: () => {
            if (context.type !== RenderContextType.NEW) throw new InvalidContextError();
            if (context.currentCard < context.cards.length - 1) {
              context.currentCard++;
              context.extraKeys = context.cards[context.currentCard].extraKeys;
              updateKeybindsNew(candidate);
            }
          },
          prevCard: () => {
            if (context.type !== RenderContextType.NEW) throw new InvalidContextError();
            if (context.currentCard > 0) {
              context.currentCard--;
              context.extraKeys = context.cards[context.currentCard].extraKeys;
              updateKeybindsNew(candidate);
            }
          },
        };
        if (context.type !== RenderContextType.NEW) throw new InvalidContextError();
        context.extraKeys = context.cards[context.currentCard].extraKeys;
        updateKeybindsNew(candidate);
      };

      const initForEdit = (candidate: EditReview) => {
        const drawTextEdit = (card: HTMLElement) => {
          const btns = card.querySelectorAll("mat-radio-button");
          for (let i = 0; i < btns.length && i < 9; i++) {
            const btnKey = (i + 1).toString();
            const label = drawNew("span");
            label.classList.add("oprkr2-key-label");
            label.textContent = `[${btnKey}] `;
            const textNode = btns[i].querySelector(".mat-radio-label-content fragment") ?? btns[i].querySelector(".mat-radio-label-content");
            textNode!.insertBefore(label, textNode!.firstChild);
          }
        };
        const handleTextEditKeys = (selector: string) => () => {
          const keys: KeyHandlerMap = {};
          const btns = document.querySelectorAll<HTMLElement>(`${selector} mat-radio-button label`);
          for (let i = 0; i < btns.length && i < 9; i++) {
            const btn = btns[i];
            keys[(i + 1).toString()] = () => {
              if (context.type !== RenderContextType.EDIT) throw new InvalidContextError();
              btn.click();
              context.nextCard();
            };
          }
          return keys;
        };

        context = {
          type: RenderContextType.EDIT,
          navigable: true,
          draw: () => {
            if (context.type !== RenderContextType.EDIT) throw new InvalidContextError();
            while (context.markers.length) {
              context.markers.pop()!.setMap(null);
            }
            const cc = context.cards[context.currentCard];
            const card = document.querySelector<HTMLElement>(cc.selector)!;
            restyle(card, "highlighted");
            cc.draw(card);
          },
          cards: [
            {
              selector: "app-select-title-edit wf-review-card",
              draw: drawTextEdit,
              extraKeys: handleTextEditKeys("app-select-title-edit wf-review-card")
            }, {
              selector: "app-select-description-edit wf-review-card",
              draw: drawTextEdit,
              extraKeys: handleTextEditKeys("app-select-description-edit wf-review-card")
            }, {
              selector: "app-select-location-edit wf-review-card",
              draw: (card: HTMLElement) => {
                const gmap: any = card.querySelector("nia-map");
                const map: google.maps.Map = gmap.__ngContext__[gmap.__ngContext__.length - 1].componentRef.map;
                if (!map) {
                  setTimeout(redrawUI, 50);
                } else {
                  candidate.locationEdits.forEach((marker, i) => {
                    if (context.type !== RenderContextType.EDIT) throw new InvalidContextError();
                    if (i >= 26) return;
                    const labelMarker = new google.maps.Marker({
                      position: {
                        lat: parseFloat(marker.lat),
                        lng: parseFloat(marker.lng)
                      },
                      label: {
                        text: String.fromCharCode(65 + i),
                        fontWeight: "bold"
                      },
                      clickable: false,
                      zIndex: 1000,
                      map: map,
                    });
                    context.markers.push(labelMarker);
                  });
                }
              },
              extraKeys: () => {
                const keys: KeyHandlerMap = {};
                for (let i = 0; i < candidate.locationEdits.length && i < 26; i++) {
                  const idx = i;
                  keys[String.fromCharCode(65 + idx)] = () => {
                    const gmap: any = document.querySelector("app-select-location-edit wf-review-card nia-map");
                    const { markers } = gmap.__ngContext__[gmap.__ngContext__.length - 1].componentRef;
                    // TODO: Type checking
                    const defaultMarker = markers.default.markers.filter((m: any /*TODO*/) => m.id == candidate.locationEdits[idx].hash)[0];
                    markers.default.markerOnClick(defaultMarker);
                  };
                }
                return keys;
              }
            }
          ].filter(ch => !!document.querySelector(ch.selector)),
          markers: [],
          currentCard: 0,
          nextCard: () => {
            if (context.type !== RenderContextType.EDIT) throw new InvalidContextError();
            if (context.currentCard < context.cards.length - 1) {
              context.currentCard++;
              context.extraKeys = context.cards[context.currentCard].extraKeys;
              updateKeybindsEdit(candidate);
            }
          },
          prevCard: () => {
            if (context.type !== RenderContextType.EDIT) throw new InvalidContextError();
            if (context.currentCard > 0) {
              context.currentCard--;
              context.extraKeys = context.cards[context.currentCard].extraKeys;
              updateKeybindsEdit(candidate);
            }
          }
        };
        if (context.cards.length > 0) {
          context.extraKeys = context.cards[context.currentCard].extraKeys;
          updateKeybindsEdit(candidate);
        } else {
          setTimeout(() => initForEdit(candidate), 250);
        }
      };

      const initForPhoto = async (_candidate: PhotoReview) => {
        const acceptAll = await unilTruthy(() => document.querySelector<HTMLElement>("app-review-photo app-accept-all-photos-card .photo-card"));

        context = {
          type: RenderContextType.PHOTO,
          navigable: false,
          draw: () => {
            if (context.type !== RenderContextType.PHOTO) throw new InvalidContextError();
            const infoCard = document.querySelector("app-review-photo .review-photo__info div");
            toolbox.log(infoCard);
            if (infoCard === null) {
              setTimeout(() => redrawUI(), 250);
              return;
            }
            const photoHelp = drawNew("p");
            photoHelp.style.marginTop = "10px";
            const phK1 = document.createElement("span");
            phK1.classList.add("oprkr2-key-span");
            phK1.textContent = "[";
            const phK2 = document.createElement("span");
            phK2.classList.add("oprkr2-key-span");
            phK2.classList.add("oprkr2-key-span-wildcard");
            phK2.textContent = "letter";
            const phK3 = document.createElement("span");
            phK3.classList.add("oprkr2-key-span");
            phK3.textContent = "]";
            const phK4 = document.createElement("span");
            phK4.classList.add("oprkr2-key-span");
            phK4.textContent = "[Shift]+[";
            const phK5 = document.createElement("span");
            phK5.classList.add("oprkr2-key-span");
            phK5.classList.add("oprkr2-key-span-wildcard");
            phK5.textContent = "letter";
            const phK6 = document.createElement("span");
            phK6.classList.add("oprkr2-key-span");
            phK6.textContent = "]";
            photoHelp.appendChild(document.createTextNode("Press "));
            photoHelp.appendChild(phK1);
            photoHelp.appendChild(phK2);
            photoHelp.appendChild(phK3);
            photoHelp.appendChild(document.createTextNode(" reject a photo, or "));
            photoHelp.appendChild(phK4);
            photoHelp.appendChild(phK5);
            photoHelp.appendChild(phK6);
            photoHelp.appendChild(document.createTextNode(" to open it in full screen"));
            infoCard.appendChild(photoHelp);

            for (let i = 0; i < context.cards.length; i++) {
              const actions = context.cards[i].querySelector(".photo-card__actions");
              const label = drawNew("span");
              label.classList.add("oprkr2-key-label");
              label.classList.add("oprkr2-photo-card-label");
              label.textContent = String.fromCharCode(65 + i);
              actions!.insertBefore(label, actions!.firstChild);
            }

            const label = drawNew("span");
            label.classList.add("oprkr2-key-label");
            label.textContent = "[Tab]";
            const acceptAllText = acceptAll.querySelector("span");
            acceptAllText!.insertBefore(label, acceptAllText!.firstChild);
          },
          cards: document.querySelectorAll<HTMLElement>("app-review-photo app-photo-card .photo-card"),
        };
        
        if (context.type !== RenderContextType.PHOTO) throw new InvalidContextError();
        const keys: KeyHandlerMap = {
          "Tab": () => acceptAll!.click(),
          "Enter": () => handleEnterNew(),
          "+Space": () => skip()
        };
        for (let i = 0; i < context.cards.length; i++) {
          const card = context.cards[i];
          keys[String.fromCharCode(65 + i)] = () => card.click();
          keys["+" + String.fromCharCode(65 + i)] = () => window.open(card.querySelector<HTMLImageElement>(".photo-card__photo img")!.src + "=s0");
        }
        setHandler(makeKeyMap(keys));
      };

      const handleEnterNew = () => {
        let btn = null;
        toolbox.log("handleEnterNew");
        if (isDialogOpen() && !isDialogClosing()) {
          btn = document.getElementById("oprtmr-ssmb-r");
          if (!btn) btn = document.getElementById("oprtmr-ssmb-d");
          if (!btn) btn = document.querySelector<HTMLElement>("mat-dialog-container .mat-dialog-actions button.wf-button--primary");
        } else {
          btn = document.getElementById("oprtmr-ssb-0");
          if (!btn) btn = document.querySelector<HTMLElement>("app-submit-review-split-button button.wf-button--primary");
        }
        if (btn) btn.click();
      };

      const skip = () => {
        const aahqrl10n = toolbox.i18nPrefixResolver("submission.");
        const xpath = `//button[contains(text(),'${aahqrl10n("skiptonext")}')]`;
        const matchingElement = document
          .evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
          .singleNodeValue as HTMLButtonElement | null;
        if (matchingElement) matchingElement.click();
      };

      const thumbDownOpen = (card: ThumbCard) => new Promise<void>((resolve, reject) => {
        if (isDialogOpen()) {
          if (!card.opens) {
            reject();
            return;
          } else if (isDialogOpen(card.opens)) {
            resolve();
            return;
          } else {
            closeDialog();
          }
        }
        const btns = document.getElementById(card.id)!.querySelectorAll<HTMLButtonElement>("button.thumbs-button");
        for (const btn of btns) {
          if (btn.querySelector("mat-icon")!.textContent === "thumb_down") {
            btn.click();
            unilTruthy(() => document.querySelector("mat-dialog-container > *")).then(() => {
              redrawUI();
              resolve();
            });
            return;
          }
        }
        reject();
      });

      const closeDialog = () => {
        const l10n = toolbox.l10n;
        const actions = document.querySelectorAll<HTMLButtonElement>("mat-dialog-container .mat-dialog-actions button.wf-button");
        for (let i = 0; i < actions.length; i++) {
          if (actions[i].textContent === l10n["modal.close"]) {
            actions[i].click();
            return;
          }
        }
      };

      const report = () => new Promise<void>((resolve, reject) => {
        if (isDialogOpen()) {
          resolve();
          return;
        }
        const aahqrl10n = toolbox.i18nPrefixResolver("submission.");
        const xpath = `//button[contains(text(),'${aahqrl10n("report")}')]`;
        const matchingElement = document
          .evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
          .singleNodeValue as HTMLButtonElement | null;
        if (matchingElement) {
          matchingElement.click();
          resolve();
          return;
        }
        reject();
      });

      const updateKeybindsNew = (candidate: NewReview) => {
        const aahqrl10n = toolbox.i18nPrefixResolver("review.new.question.accurateandhighquality.reject.");
        const aahqrl10nReport = toolbox.i18nPrefixResolver("review.report.modal.");
        setHandler(makeKeyMap({
          "+P": () => thumbDownOpen(ThumbCards.APPROPRIATE).then(() => selectDialogRadio("PRIVATE")),
          "+I": () => thumbDownOpen(ThumbCards.APPROPRIATE).then(() => selectDialogRadio("INAPPROPRIATE")),
          "+K": () => thumbDownOpen(ThumbCards.APPROPRIATE).then(() => selectDialogRadio("SCHOOL")),
          "+S": () => thumbDownOpen(ThumbCards.APPROPRIATE).then(() => selectDialogRadio("SENSITIVE")),
          "+E": () => thumbDownOpen(ThumbCards.APPROPRIATE).then(() => selectDialogRadio("EMERGENCY")),
          "+G": () => thumbDownOpen(ThumbCards.APPROPRIATE).then(() => selectDialogRadio("GENERIC")),
          "+U": () => thumbDownOpen(ThumbCards.SAFE),
          "+1": () => thumbDownOpen(ThumbCards.ACCURATE).then(() => expandDialogAccordionPanel(aahqrl10n("photos"))),
          "+1,B": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("photos"))!, aahqrl10n("photos.blurry")),
          "+1,F": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("photos"))!, aahqrl10n("photos.face")),
          "+1,L": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("photos"))!, aahqrl10n("photos.license")),
          "+1,O": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("photos"))!, aahqrl10n("photos.orientation")),
          "+1,I": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("photos"))!, aahqrl10n("photos.identifiable")),
          "+1,T": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("photos"))!, aahqrl10n("photos.thirdparty")),
          "+1,W": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("photos"))!, aahqrl10n("photos.watermark")),
          "+1,Q": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("photos"))!, aahqrl10n("photos.lowquality")),
          "+2": () => thumbDownOpen(ThumbCards.ACCURATE).then(() => expandDialogAccordionPanel(aahqrl10n("title"))),
          "+2,E": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("title"))!, aahqrl10n("title.emoji")),
          "+2,U": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("title"))!, aahqrl10n("title.url")),
          "+2,Q": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("title"))!, aahqrl10n("title.quality")),
          "+3": () => thumbDownOpen(ThumbCards.ACCURATE).then(() => expandDialogAccordionPanel(aahqrl10n("description"))),
          "+3,E": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("description"))!, aahqrl10n("description.emoji")),
          "+3,U": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("description"))!, aahqrl10n("description.url")),
          "+3,Q": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("description"))!, aahqrl10n("description.quality")),
          "+4": () => thumbDownOpen(ThumbCards.ACCURATE).then(() => expandDialogAccordionPanel(aahqrl10n("abuse"))),
          "+4,F": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("abuse"))!, aahqrl10n("abuse.fakenomination")),
          "+4,X": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("abuse"))!, aahqrl10n("abuse.explicit")),
          "+4,I": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("abuse"))!, aahqrl10n("abuse.influencing")),
          "+4,O": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("abuse"))!, aahqrl10n("abuse.offensive")),
          "+4,A": () => checkDialogBox(getDialogAccordionPanel(aahqrl10n("abuse"))!, aahqrl10n("abuse.other")),
          "+R": () => report(),
          "+5,F": () => getDialogReportCheckbox(aahqrl10nReport("fake")),
          "+5,X": () => getDialogReportCheckbox(aahqrl10nReport("explicit")),
          "+5,I": () => getDialogReportCheckbox(aahqrl10nReport("influencing")),
          "+5,O": () => getDialogReportCheckbox(aahqrl10nReport("offensive")),
          "+5,A": () => getDialogReportCheckbox(aahqrl10nReport("abuse")),
          "+L": () => thumbDownOpen(ThumbCards.ACCURATE).then(() => checkDialogBox(null, aahqrl10n("inaccuratelocation"))),
          "+O": () => thumbDownOpen(ThumbCards.ACCURATE).then(() => checkDialogBox(null, null)),
          "+T": () => thumbDownOpen(ThumbCards.PERMANENT),
          "Q": () => window.open(candidate.imageUrl + "=s0"),
          "E": () => window.open(candidate.supportingImageUrl + "=s0"),
          "+Space": () => !isDialogOpen() && skip(),
          "Tab": () => !isDialogOpen() && context.navigable && context.nextCard(),
          "+Tab": () => !isDialogOpen() && context.navigable && context.prevCard(),
          "ArrowDown": () => !isDialogOpen() && context.navigable && context.nextCard(),
          "ArrowUp": () => !isDialogOpen() && context.navigable && context.prevCard(),
          "ArrowRight": () => !isDialogOpen() && context.navigable && context.nextCard(),
          "ArrowLeft": () => !isDialogOpen() && context.navigable && context.prevCard(),
          "Enter": () => handleEnterNew(),
          ...context.extraKeys!()
        }));
      };

      const updateKeybindsEdit = (_candidate: EditReview) => {
        setHandler(makeKeyMap({
          "Tab": () => context.navigable && context.nextCard(),
          "+Tab": () => context.navigable && context.prevCard(),
          "ArrowDown": () => context.navigable && context.nextCard(),
          "ArrowUp": () => context.navigable && context.prevCard(),
          "ArrowRight": () => context.navigable && context.nextCard(),
          "ArrowLeft": () => context.navigable && context.prevCard(),
          "Enter": () => handleEnterNew(),
          "+Space": () => skip(),
          ...context.extraKeys!()
        }));
      };

      const keyLabel = (btnKey: string) => {
        const label = drawNew("span");
        label.classList.add("oprkr2-key-label");
        console.log(keySequence, btnKey);
        if (btnKey.includes(",")) {
          if (keySequence && `+${btnKey}`.startsWith(keySequence)) {
            label.textContent = "\u2026" + btnKey.substring(keySequence.length)
              .split(",").map(key => `[${key}]`).join("") + " ";
          } else {
            label.textContent = `\u{1f879}${btnKey}`
              .split(",").map(key => `[${key}]`).join("") + " ";
          }
        } else {
          label.textContent = `[\u{1f879}${btnKey}]`;
        }
        return label;
      };

      const redrawUI = () => {
        const ephemeral = document.getElementsByClassName("oprkr2-ephemeral");
        for (let i = ephemeral.length - 1; i >= 0; i--) {
          ephemeral[i].parentNode!.removeChild(ephemeral[i]);
        }
        const touched = document.getElementsByClassName("oprkr2-touched");
        for (let i = touched.length - 1; i >= 0; i--) {
          for (let j = touched[i].classList.length - 1; j >= 0; j--) {
            if (touched[i].classList[j].startsWith("oprkr2-eds-")) {
              touched[i].classList.remove(touched[i].classList[j]);
            }
          }
          touched[i].classList.remove("oprkr2-touched");
        }
        if (context.draw) context.draw();
      };

      const restyle = (e: Element, ...clss: string[]) => {
        if (!e.classList.contains("oprkr2-touched")) {
          e.classList.add("oprkr2-touched");
        }
        for (const cls of clss) {
          if (!e.classList.contains(`oprkr2-eds-${cls}`)) {
            e.classList.add(`oprkr2-eds-${cls}`);
          }
        }
      };

      const drawNew = (tag: string) => {
        const e = document.createElement(tag);
        e.classList.add("oprkr2-ephemeral");
        return e;
      };

      const freeHandler = () => {
        if (kdEvent) document.removeEventListener("keydown", kdEvent);
        kdEvent = null;
        keySequence = null;
      };

      const setHandler = (handler: KeyHandler) => {
        if (kdEvent) freeHandler();
        document.addEventListener("keydown", kdEvent = handler);
        redrawUI();
      };

      toolbox.interceptOpenJson("GET", "/api/v1/vault/review", initKeyboardCtrl);
    }
  });
};

const isDialogOpen = (diag?: string) => {
  return !!document.querySelector(
    "mat-dialog-container" + (diag ? ` > ${diag}` : "")
  );
};

const isDialogClosing = (diag?: string) => {
  return !!document.querySelector(
    "mat-dialog-container.ng-animating" + (diag ? ` > ${diag}` : "")
  );
};

const waitForDialog = () => unilTruthy(
  () => document.querySelector("mat-dialog-container > *")
);

const checkDialogBox = (parent: HTMLElement | null, text: string | null) => new Promise<void>((resolve, reject) => {
  const btns = parent ? parent.querySelectorAll("wf-checkbox") : document.querySelectorAll("mat-dialog-container wf-checkbox");
  for (let i = 0; i < btns.length; i++) {
    const label = btns[i].querySelector<HTMLElement>(".mat-checkbox-label")!;
    const input = btns[i].querySelector<HTMLElement>(".mat-checkbox-label app-text-input-review-b input");
    if (text && label.textContent?.trim() == text) {
      label.click();
      resolve();
      return;
    } else if (!text && input) {
      label.click();
      setTimeout(() => input.focus(), 0);
      const stopInstantBlur = () => {
        setTimeout(() => input.focus(), 0);
        input.removeEventListener("blur", stopInstantBlur);
      };
      input.addEventListener("blur", stopInstantBlur);
      return;
    }
  }
  reject();
});

const selectDialogRadio = (value: string) => new Promise<void>((resolve, reject) => {
  const btns = document.querySelectorAll("mat-dialog-container mat-radio-button");
  for (const btn of btns) {
    if (btn.querySelector<HTMLInputElement>("input[type=radio]")!.value == value) {
      btn.querySelector<HTMLElement>(".mat-radio-container")!.click();
      resolve();
      return;
    }
  }
  reject();
});

const getDialogAccordionPanel = (text: string) => {
  const panels = document.querySelectorAll<HTMLElement>("mat-dialog-container mat-accordion mat-expansion-panel");
  for (let i = 0; i < panels.length; i++) {
    const label = panels[i].querySelector("mat-panel-title > div > div");
    if (label?.textContent?.trim() == text) {
      return panels[i];
    }
  }
  return null;
};

const expandDialogAccordionPanel = (text: string) => new Promise<void>((resolve, reject) => {
  const panel = getDialogAccordionPanel(text);
  if (panel) {
    if (!panel.classList.contains("mat-expanded")) {
      panel.querySelector<HTMLElement>("mat-panel-title")!.click();
    }
    resolve();
    return;
  }
  reject();
});

const getDialogReportCheckbox = (text: string) => {
  const reportModal = document.querySelector("[class*='report-modal-content']")!;
  for (let i = 0; i < reportModal.childNodes.length; i++) {
    const checkbox = reportModal.childNodes[i].childNodes[0] as HTMLElement;
    if (checkbox.textContent?.trim().includes(text)) {
      checkbox.querySelector("span")!.click();
      return;
    }
  }
};
