export class ConversationProposalTextError extends Error {
  constructor(code, lineNumber, message, options) {
    super(message, options);
    this.name = "ConversationProposalTextError";
    this.code = code;
    this.lineNumber = lineNumber;
  }
}

/** Coverage describes text extraction, never business requirements or task completion. */
export function extractConversationUserText(buffer, {
  maxBytes = 2 * 1024 * 1024,
  maxLineBytes = 128 * 1024,
  maxMessages = 100,
  maxTextBytes = 32 * 1024,
} = {}) {
  if (!(buffer instanceof Uint8Array)) {
    throw new ConversationProposalTextError("INVALID_INPUT", null, "A byte snapshot is required");
  }
  const limits = { maxBytes, maxLineBytes, maxMessages, maxTextBytes };
  for (const [limit, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConversationProposalTextError("INVALID_LIMIT", null, `${limit} must be a nonnegative safe integer`);
    }
  }
  // Reject before hashing or decoding a snapshot larger than the agreed budget.
  if (buffer.byteLength > maxBytes) {
    throw new ConversationProposalTextError("INPUT_LIMIT", null, "Snapshot exceeds maxBytes");
  }
  const bytes = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    decoder.decode(bytes);
  } catch (cause) {
    // Find the failing line without accepting replacement characters or parsing JSON.
    let offset = 0, lineNumber = 1;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      try { decoder.decode(bytes.subarray(offset, end)); } catch {
        throw new ConversationProposalTextError("INVALID_UTF8", lineNumber, "Snapshot contains invalid UTF8", { cause });
      }
      offset = end + 1;
      lineNumber += 1;
    }
    throw new ConversationProposalTextError("INVALID_UTF8", null, "Snapshot contains invalid UTF8", { cause });
  }
  if (bytes.length === 0) {
    throw new ConversationProposalTextError("MISSING_SESSION_META", 1, "Snapshot has no session metadata");
  }
  if (bytes.at(-1) !== 10) {
    let lineNumber = 1;
    for (const byte of bytes) if (byte === 10) lineNumber += 1;
    throw new ConversationProposalTextError("MISSING_FINAL_NEWLINE", lineNumber, "Snapshot ends with an unterminated record");
  }

  const messages = [];
  const coverage = {
    complete: true, truncated: false, reasons: [], inputBytes: bytes.length, scannedBytes: 0,
    parsedLines: 0, sessionMetaValidated: false, userMessageRecords: 0, extractedMessages: 0,
    textBytes: 0, ignoredRecords: 0, ignoredContentItems: 0,
  };
  const truncated = (limit, observed, lineNumber) => {
    coverage.complete = false;
    coverage.truncated = true;
    coverage.reasons.push({ limit, maximum: limits[limit], observed, lineNumber });
  };

  let offset = 0, lineNumber = 1;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(10, offset);
    const lineBytes = newline - offset; // LF is excluded; CR in CRLF remains part of the line budget.
    if (lineBytes > maxLineBytes) {
      if (lineNumber === 1) {
        throw new ConversationProposalTextError("HEADER_LIMIT", 1, "Session metadata exceeds maxLineBytes");
      }
      truncated("maxLineBytes", lineBytes, lineNumber);
      break;
    }
    let record;
    try {
      record = JSON.parse(decoder.decode(bytes.subarray(offset, newline)));
    } catch (cause) {
      throw new ConversationProposalTextError("INVALID_JSON", lineNumber, "Snapshot contains an invalid JSON record", { cause });
    }
    if (!isObject(record) || typeof record.type !== "string") {
      throw new ConversationProposalTextError("INVALID_RECORD", lineNumber, "Rollout records must be typed objects");
    }
    coverage.parsedLines += 1;
    coverage.scannedBytes = newline + 1;
    offset = newline + 1;

    if (lineNumber === 1) {
      if (record.type !== "session_meta" || !isObject(record.payload)
        || typeof record.payload.id !== "string" || !THREAD_ID.test(record.payload.id)
        || typeof record.payload.cwd !== "string" || !path.isAbsolute(record.payload.cwd)) {
        throw new ConversationProposalTextError("INVALID_SESSION_META", 1, "The first record must contain a UUID session and absolute cwd");
      }
      coverage.sessionMetaValidated = true;
    } else if (record.type !== "response_item") {
      coverage.ignoredRecords += 1;
    } else if (!isObject(record.payload)) {
      throw new ConversationProposalTextError("INVALID_RECORD", lineNumber, "response_item requires an object payload");
    } else if (record.payload.type !== "message" || record.payload.role !== "user") {
      coverage.ignoredRecords += 1;
    } else {
      if (!Array.isArray(record.payload.content)) {
        throw new ConversationProposalTextError("INVALID_CONTENT", lineNumber, "User message content must be an array");
      }
      coverage.userMessageRecords += 1;
      const parts = [];
      for (const item of record.payload.content) {
        if (!isObject(item) || item.type !== "input_text") {
          coverage.ignoredContentItems += 1;
        } else if (typeof item.text !== "string") {
          throw new ConversationProposalTextError("INVALID_CONTENT", lineNumber, "input_text requires string text");
        } else {
          parts.push(item.text);
        }
      }
      if (parts.length === 0) {
        coverage.ignoredRecords += 1;
      } else if (messages.length >= maxMessages) {
        truncated("maxMessages", messages.length + 1, lineNumber);
        break;
      } else {
        const text = parts.join("\n");
        const textBytes = Buffer.byteLength(text, "utf8");
        if (coverage.textBytes + textBytes > maxTextBytes) {
          truncated("maxTextBytes", coverage.textBytes + textBytes, lineNumber);
          break;
        }
        messages.push({ lineNumber, text });
        coverage.extractedMessages += 1;
        coverage.textBytes += textBytes;
      }
    }
    lineNumber += 1;
  }

  return {
    messages,
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    hashScope: "inputBytes",
    coverage,
    status: "unknown",
    executionBinding: null,
    authorizesDispatch: false,
  };
}
import { createHash } from "node:crypto";
import path from "node:path";

const THREAD_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
