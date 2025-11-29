// This file contains type definitions for the internal Angular state of the OPR app. Things here
// may change or break at any moment, which is why they're put in a file called "unsafe".
// Technically, we're not "supposed" to do anything to OPR at all, but the things in here are
// things we're *particularly* not supposed to access because it is a "private implementation
// detail" in Angular "and it shouldn't be relied upon" (ref: angular/angular#53990).

// Unfortunately, this state is the only way to access some things we need, so we're doing it
// anyway. If something does break down the line, we can just change the type definitions in here,
// and ESLint will tell us which places we need to fix things in the scripts.

// In an effort to reduce the amount of unnecessary maintenance, only things that are actually used
// in the scripts should be declared here.

import { AnyContribution } from "./types";

export interface AppSubmissionsListItemElement extends HTMLElement {
  __ngContext__: {
    22: AnyContribution,
  }
};
