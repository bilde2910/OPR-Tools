# Unofficial Tools for OPR

This repository is still very much a work in progress. The goal is to port most of the addons from [tehstone's repo](https://github.com/tehstone/wayfarer-addons) from Wayfarer to OPR. At the same time, I'm taking the opportunity to do a major rework of the userscript structure to make the scripts much more pleasant and safe to code.

<details>
  <summary>Current script porting progress</summary>

- [ ] wayfarer-achievements.user.js
- [x] wayfarer-appeal-info.user.js
- [ ] wayfarer-compact-card.user.js
- [x] wayfarer-contribution-management-layout.user.js
- [x] wayfarer-edits-diff.user.js
- [x] wayfarer-email-api.user.js
- [x] wayfarer-extended-stats.user.js
- [x] wayfarer-keyboard-review.user.js
- [ ] wayfarer-localstoragecheck.user.js
- [x] wayfarer-nomination-map.user.js
- [x] wayfarer-nomination-stats.user.js
- [x] wayfarer-nomination-status-history.user.js
- [x] wayfarer-nomination-streetview.user.js
- [ ] wayfarer-nomination-types.user.js
- [x] wayfarer-open-in.user.js
- [ ] wayfarer-prime-portal-links.user.js
- [ ] wayfarer-rejections-plus.user.js
- [ ] wayfarer-reverse-image-search.user.js
- [x] wayfarer-review-counter.user.js
- [x] wayfarer-review-history-idb.user.js
- [x] wayfarer-review-history-table.user.js
- [x] wayfarer-review-map-mods.user.js
- [ ] wayfarer-review-pings.user.js
- [x] wayfarer-review-timer.user.js
- [ ] wayfarer-skip-count.user.js
- [ ] ~~wayfarer-ticket-saver.user.js~~\*
- [ ] wayfarer-translate.user.js
- [ ] wayfarer-upgrade-percent.user.js
- [ ] wayfarer-version-display.user.js

\* Not applicable to Recon
</details>

## Prerequisites

Usage of these tools requires a UserScript manager. Install the manager extension of your choice.

Some options include:
- [Tampermonkey](https://tampermonkey.net/)
- [Greasemonkey](https://www.greasespot.net/)
- [Violentmonkey](https://github.com/Violentmonkey/Violentmonkey)

**⚠️ OPR Tools does not support IITC Button!**

IITC Button will offer to install OPR Tools for you, but it will not actually run it, rendering OPR Tools non-functional. Please switch to a general-purpose UserScript manager instead, like one of those listed above, if you want to use OPR Tools.

## Installation

As noted previously, the current state of this script is very early development. If you want to be an early tester, you can install all of the OPR tools using this link:

https://static.varden.info/opr-tools/dist/opr-tools.user.js

## Setup

If you're familiar with the older [Wayfarer Addons](https://github.com/tehstone/wayfarer-addons) this part will be a bit different.
Installation of the single script linked previously will make all current tools available.
Individual tools can turned on and off from the [OPR Settings page](https://opr.ingress.com/new/settings):

![Example Screenshot](https://i.imgur.com/LxYytUU.png)

Settings for all tools can be found there as well:

![Example Screenshot](https://i.imgur.com/IWmJm72.png)

## Keyboard Review

This tool enables nearly full control of the review page via the keyboard.

- Numbers 1-3 to select a rating for the selected category
- Shortcuts for Rejection reasons:
  - Shift + P: Appropriate -> Private property
  - Shift + I: Appropriate -> Adult location
  - Shift + K: Appropriate -> Schools
  - Shift + S: Appropriate -> Sensitive location
  - Shift + E: Appropriate -> Obstructs emergency operations
  - Shift + G: Appropriate -> Generic business
  - Shift + U: Unsafe
  - Shift + T: Not Permanent or Distinct
  - Shift + 1: Accuracy -> Bad Photo (with additional Letters B, F, L, O, I, T, W, Q for specific reasons)
  - Shift + 2: Accuracy -> Bad Title (with additional Letters E, U, Q for specific reasons)
  - Shift + 3: Accuracy -> Bad Description (with additional Letters E, U, Q for specific reasons)
  - Shift + 4: Accuracy -> Abuse (with additional Letters F, X, I, O, A for specific reasons)
  - Shift + L: Accuracy -> Inaccurate Location
- Left & Right arrows to navigate between categories
- Enter key to submit the nomination.
- Escape key to cancel pop-up dialogs
- "Q" to open the main photo in a new tab
- "E" to open the supporting photo in a new tab
- Number keys to select Edit options
- Letter keys to select photo options

## Nomination Map 

Places a map of all your contributions at the top of the [Contributions Page](https://opr.ingress.com/new/nominations). Also places a counter of the currently listed contributions above the list, this counter updates whenever the search or filter is updated.

## Nomination Stats

Detailed stats about contributions separated by contribution type and status, displayed in a table below the contribution list.


## Review History

Stores review history for New Nomination Reviews, Edit Nomination Reviews, and Photo Reviews
