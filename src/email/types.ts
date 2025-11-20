export interface StoredEmail {
  id: string,
  pids: string[],
  filename: string,
  ts: number,
  headers: Header[],
  body: string,
}

export interface Header {
  name: string,
  value: string,
}

export interface EmailFile {
  contents: string,
  filename: string,
  processingID?: string,
}

export enum EmailType {
  NOMINATION_APPEAL_DECIDED = "NOMINATION_APPEAL_DECIDED",
  NOMINATION_APPEAL_RECEIVED = "NOMINATION_APPEAL_RECEIVED",
  EDIT_DECIDED = "EDIT_DECIDED",
  EDIT_RECEIVED = "EDIT_RECEIVED",
  MISCELLANEOUS = "MISCELLANEOUS",
  NOMINATION_DECIDED = "NOMINATION_DECIDED",
  NOMINATION_RECEIVED = "NOMINATION_RECEIVED",
  PHOTO_DECIDED = "PHOTO_DECIDED",
  PHOTO_RECEIVED = "PHOTO_RECEIVED",
  REPORT_DECIDED = "REPORT_DECIDED",
  REPORT_RECEIVED = "REPORT_RECEIVED",
  SURVEY = "SURVEY",
}

export enum EmailStyle {
  INGRESS = "INGRESS",
  LIGHTSHIP = "LIGHTSHIP",
  POKEMON_GO = "POKEMON_GO",
  REDACTED = "REDACTED",
  WAYFARER = "WAYFARER",
  UNKNOWN = "UNKNOWN",
}
