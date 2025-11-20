import { Email } from ".";
import { InvalidEmailFormatError, NotImplementedError } from "./errors";
import { Header } from "./types";

const ENCODED_WORD_REGEX = /=\?([A-Za-z0-9-]+)\?([QqBb])\?([^?]+)\?=(?:\s+(?==\?[A-Za-z0-9-]+\?[QqBb]\?[^?]+\?=))?/g;

export const extractEmail = (headerValue: string) => {
  // Technically not spec-compliant
  const sb = headerValue.lastIndexOf("<");
  const eb = headerValue.lastIndexOf(">");
  if (sb < 0 && eb < 0) return headerValue;
  return headerValue.substring(sb + 1, eb);
};

export const parseMIME = (data: string): Email => {
  const bound = data.indexOf("\r\n\r\n");
  if (bound < 0) throw new InvalidEmailFormatError("Cannot find boundary between headers and body");
  const headers = data.substring(0, bound).replace(/\r\n\s/g, " ").split(/\r\n/).map((h) => parseHeader(h));
  const body = data.substring(bound + 4);
  return new Email(headers, body);
};

const parseHeader = (headerLine: string): Header => {
  const b = headerLine.indexOf(":");
  const token = headerLine.substring(0, b);
  // Decode RFC 2047 atoms
  const field = headerLine
    .substring(b + 1)
    .trim()
    .replace(ENCODED_WORD_REGEX, (_, c, e, t) => parseEncodedWord(c, e, t));
  return {
    name: token,
    value: field.trim(),
  };
};

const parseEncodedWord = (charset: string, encoding: string, text: string): string => {
  switch (encoding) {
    case "Q":
    case "q":
      return new TextDecoder(charset).decode(qpStringToU8A(text.split("_").join(" ")));
    case "B":
    case "b":
      return charset.toLowerCase() == "utf-8" ? atobUTF8(text) : atob(text);
    default:
      throw new InvalidEmailFormatError(`Invalid RFC 2047 encoding format: ${encoding}`);
  }
};

const qpStringToU8A = (str: string): Uint8Array => {
  const u8a = new Uint8Array(str.length - (2 * (str.split("=").length - 1)));
  for (let i = 0, j = 0; i < str.length; i++, j++) {
    if (str[i] !== "=") {
      u8a[j] = str.codePointAt(i)!;
    } else {
      u8a[j] = parseInt(str.substring(i+1, i+3), 16);
      i += 2;
    }
  }
  return u8a;
};

// https://stackoverflow.com/a/30106551/1955334
const atobUTF8 = (text: string): string => decodeURIComponent(atob(text)
  .split("")
  .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
  .join(""));

export const decodeBodyUsingCTE = (body: string, cte: string | null, charset: string) => {
  switch (cte) {
    case null:
      return body;
    case "quoted-printable":
      return unfoldQuotedPrintable(body, charset);
    case "base64":
      return charset.toLowerCase() === "utf-8" ? atobUTF8(body) : atob(body);
    default:
      throw new NotImplementedError(`Unknown Content-Transfer-Encoding ${cte}`);
  }
};

const unfoldQuotedPrintable = (body: string, charset: string) => {
  // Unfold QP CTE
  const td = new TextDecoder(charset);
  return body
    .split(/=\r?\n/).join("")
    .split(/\r?\n/).map((line) => td.decode(qpStringToU8A(line)))
    .join("\n");
};
