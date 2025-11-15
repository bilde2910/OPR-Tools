import geofenceJson from "../assets/geofences.json" with { type: "json" };

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

export type Zone = keyof typeof geofenceJson;
export type GeofenceMap = Record<Zone, number[][]>;

//#region API types

export interface Requests {
  "/api/v1/vault/review": AnySubmittedReview,
  "/api/v1/vault/manage/hold": SetHold,
  "/api/v1/vault/manage/releasehold": ReleaseHold,
  "/api/v1/vault/manage/edit": EditContribution,
  "/api/v1/vault/manage/appeal": SubmitAppeal,
  "/api/v1/vault/settings": SaveSettings,
}

export interface Responses {
  "GET": {
    "/api/v1/vault/manage": SubmissionsResult,
    "/api/v1/vault/review": AnyReview,
    "/api/v1/vault/home": Showcase,
    "/api/v1/vault/settings": UserSettings,
    "/api/v1/vault/profile": Profile,
  },
  "POST": {
    "/api/v1/vault/review": string,
    "/api/v1/vault/manage/hold": string,
    "/api/v1/vault/manage/releasehold": string,
    "/api/v1/vault/manage/edit": string,
    "/api/v1/vault/manage/appeal": string,
    "/api/v1/vault/settings": string,
  },
}

//#region Wayfarer types

export interface ApiResult<T> {
  result: T,
  message: string | null,
  code: string,
  version: string,
  captcha: boolean,
}

type DarkMode = "ENABLED" | "DISABLED" | "AUTOMATIC";

export interface SaveSettings {
  darkMode?: DarkMode,
  autoScroll?: false,
  // TODO: Add more
}

export interface SubmissionsResult {
  submissions: AnyContribution[],
}

export interface ShowcasedPortal {
  guid: string,
  title: string,
  description: string,
  lat: number,
  lng: number,
  address: string,
  countryLong: string,
  countryShort: string,
  stateLong: string,
  stateShort: string,
  city: string,
  postalCode: null, // TODO
  imageUrl: string,
  index: number,
  discoverer: string,
  discovererGame: string,
  categoryName: string,
  criteriaTitle: string,
  criteriaDescription: string,
}

export interface Showcase {
  showcase: ShowcasedPortal[],
  notifications: never[], // TODO
  punishmentWarn: boolean,
  showcaseMessage: string,
}

interface SocialProfile {
  email: string,
  name: string,
  pictureUrl: string,
  username: string,
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
  darkMode: DarkMode,
  socialProfile: SocialProfile,
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
  darkMode: DarkMode,
  attribution: boolean,
  campaign: boolean,
  autoUpgrade: boolean,
}

export interface Profile {
  socialProfile: SocialProfile,
  performance: string,
  finished: number,
  accepted: number,
  rejected: number,
  duplicated: number,
  available: number,
  progress: number,
  total: number,
  interval: number,
  maximum: number,
  history: never[], // TODO: what is this?
}

export enum ContributionType {
  NOMINATION = "NOMINATION",
  EDIT_LOCATION = "EDIT_LOCATION",
  EDIT_DESCRIPTION = "EDIT_DESCRIPTION",
  EDIT_TITLE = "EDIT_TITLE",
  PHOTO = "PHOTO",
}

type EditContributionType =
  ContributionType.EDIT_TITLE |
  ContributionType.EDIT_DESCRIPTION |
  ContributionType.EDIT_LOCATION |
  ContributionType.PHOTO

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

interface Contribution {
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
  rejectReasons: {
    reason: string,
  }[],
  canAppeal: boolean,
  appealResolved: boolean,
  isClosed: boolean,
  appealNotes: string,
  userAppealNotes: string,
  canHold: boolean,
  canReleaseHold: boolean,
}

export interface EditContribution extends Contribution {
  type: EditContributionType
  poiData: {
    id: string,
    imageUrl: string,
    title: string,
    description: string,
    lat: number,
    lng: number,
    city: string,
    state: "LIVE" | "RETIRED",
    lastUpdateDate: string,
  }
}

export interface Nomination extends Contribution {
  type: ContributionType.NOMINATION,
  poiData: never[],
}

export type AnyContribution = EditContribution | Nomination

//#region Incoming reviews

export interface BaseReview {
  id: string,
  lat: number,
  lng: number,
  expires: number,
  canSkip: boolean,
  autoScroll: boolean | null,
  china: boolean | null,
  title: string,
  description: string,
}

export interface NewReview extends BaseReview {
  type: "NEW",
  imageUrl: string,
  nearbyPortals: {
    guid: string,
    title: string,
    description: string,
    imageUrl: string,
    lat: number,
    lng: number,
  }[],
  t1: number,
  newLocationMaxDistance: number,
  statement: string,
  supportingImageUrl: string,
  streetAddress: string,
  categoryIds: string[],
}

export interface EditReview extends BaseReview {
  type: "EDIT",
  imageUrl: string,
  titleEdits: {
    value: string,
    hash: string,
  }[],
  descriptionEdits: never[], // TODO
  locationEdits: {
    value: string,
    hash: string,
    lat: string,
    lng: string,
  }[],
}

export interface PhotoReview extends BaseReview {
  type: "PHOTO",
  newPhotos: {
    value: string,
    hash: string,
  }[],
}

export type AnyReview = NewReview | EditReview | PhotoReview;

//#region Submitted reviews

export interface AcceptedNewReview {
  id: string,
  type: "NEW",
  quality: number,
  description: number,
  cultural: number,
  uniqueness: number,
  safety: number,
  location: number,
  socialize: number,
  photo: number,
  exercise: number,
  accuracyDontKnowComment: string,
  reviewerSuggestedCategories: string[],
}

export interface RejectedNewReview {
  id: string,
  type: "NEW",
  spam: true,
  rejectReasons: string[],
  accuracyRejectComment: string,
}

export interface DuplicatedNewReview {
  id: string,
  type: "NEW",
  duplicate: true,
  duplicateOf: string,
}

export type SubmittedNewReview = AcceptedNewReview | RejectedNewReview | DuplicatedNewReview;

export interface SubmittedEditReview {
  id: string,
  type: "EDIT",
  comment: string,
  descriptionUnable: boolean,
  selectedDescriptionHash?: string,
  locationUnable: boolean,
  selectedLocationHash?: string,
  titleUnable: boolean,
  selectedTitleHash?: string,
}

export interface SubmittedPhotoReview {
  id: string,
  type: "PHOTO",
  abuseReasons: Record<string, string>, // ID -> reason
  acceptPhotos: string[],
  rejectPhotos: string[],
}

export type AnySubmittedReview = SubmittedNewReview | SubmittedEditReview | SubmittedPhotoReview;

//#region Contribution management

export interface SetHold {
  id: string,
}

export interface ReleaseHold {
  id: string,
}

export interface EditContribution {
  id: string,
  title: string,
  description: string,
  supporting: string,
}

export interface SubmitAppeal {
  id: string,
  statement: string,
}
