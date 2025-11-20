export class InvalidEmailFormatError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "InvalidEmailFormatError";
  }
}

export class InvalidContentTypeError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "InvalidContentTypeError";
  }
}

export class NotImplementedError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

export class EmailImportError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "EmailImportError";
  }
}

export class HeaderNotFoundError extends EmailImportError {
  constructor(message?: string) {
    super(message);
    this.name = "HeaderNotFoundError";
  }
}

export class UnsupportedSenderError extends EmailImportError {
  constructor(message?: string) {
    super(message);
    this.name = "HeaderNotFoundError";
  }
}

export class EmailClassificationError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "EmailClassificationError";
  }
}

export class DisambiguationFailedError extends EmailClassificationError {
  constructor(message?: string) {
    super(message);
    this.name = "DisambiguationFailedError";
  }
}

export class NoMatchingTemplateError extends EmailClassificationError {
  constructor(message?: string) {
    super(message);
    this.name = "NoMatchingTemplateError";
  }
}
