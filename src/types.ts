/** Custom CLI args passed to rollup */
export type RollupArgs = Partial<{
  "config-mode": "development" | "production";
  "config-branch": "main";
  "config-host": "dev" | "github" | "varden";
  "config-assetSource": "local" | "github" | "varden";
  "config-suffix": string;
}>;

/** Configuration object for the script */
export type ScriptConfig = {
  // add data here
};

//#region Wayfarer types

export interface ApiResult<T> {
  result: T,
  message: string | null,
  code: string,
  version: string,
  captcha: false,
}

export interface SubmissionsResult {
  submissions: Contribution[],
}

export interface UserProperties {
  recaptchaKey: string,
  authenticated: boolean,
  canReview: boolean,
  attributionDisclaimerAccepted: boolean,
  language: string,
  oAuth2LoginEnabled: boolean,
  version: string,
  nianticLoginEnabled: boolean,
  hasEnvironmentAccessToSubmit: boolean,
  performance: string,
  rewardProgress: number,
  rewardAvailable: number,
  browserKey: string,
  nianticLoginStartUri: string,
  attribution: boolean,
  nianticIdUrl: string,
  darkMode: string,
  socialProfile: {
    email: string,
    name: string,
    pictureUrl: string,
    username: string,
  },
  browserClientId: string,
  eligibleToOnboard: boolean,
  onboardingState: string,
  autoScroll: boolean,
}

export interface UserSettings {
  hometownLatLng: string,
  bonusLatLng: string,
  bonusCanChange: boolean,
  nextBonusChangeTimeMs: number,
  hometownCanChange: boolean,
  language: string,
  autoScroll: boolean,
  darkMode: string,
  attribution: boolean,
  campaign: boolean,
  autoUpgrade: boolean,
}

export enum ContributionType {
  NOMINATION = "NOMINATION",
  EDIT_LOCATION = "EDIT_LOCATION",
  EDIT_DESCRIPTION = "EDIT_DESCRIPTION",
  EDIT_TITLE = "EDIT_TITLE",
  PHOTO = "PHOTO",
}

export enum ContributionStatus {
  ACCEPTED = "ACCEPTED",
  APPEALED = "APPEALED",
  DUPLICATE = "DUPLICATE",
  HELD = "HELD",
  NIANTIC_REVIEW = "NIANTIC_REVIEW",
  NOMINATED = "NOMINATED",
  REJECTED = "REJECTED",
  VOTING = "VOTING",
  WITHDRAWN = "WITHDRAWN",
}

export interface Contribution {
  id: string,
  type: ContributionType,
  title: string,
  description: string,
  lat: number,
  lng: number,
  city: string,
  state: string,
  day: string,
  order: number,
  imageUrl: string,
  upgraded: boolean,
  status: ContributionStatus,
  isMutable: boolean,
  isNianticControlled: boolean,
  statement: string,
  supportingImageUrl: string,
  rejectReasons: string[],
  canAppeal: boolean,
  appealResolved: boolean,
  isClosed: boolean,
  appealNotes: string,
  userAppealNotes: string,
  canHold: boolean,
  canReleaseHold: boolean,
  poiData: object[],
}
