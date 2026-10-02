import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationProposalTextError, extractConversationUserText } from "../server/conversation-proposal-text.mjs";

const metadata = { type: "session_meta", payload: { id: "11111111-1111-4111-8111-111111111111", cwd: "/synthetic/project" } };
const user = (content) => ({ type: "response_item", payload: { type: "message", role: "user", content } });
const text = (value) => ({ type: "input_text", text: value });
const jsonl = (...records) => Buffer.from(records.map((record) => JSON.stringify(record)).join("\n") + "\n");
function rejectsFormat(input, code, lineNumber, options) {
  assert.throws(() => extractConversationUserText(input, options), (error) => {
    assert.ok(error instanceof ConversationProposalTextError);
    assert.equal(error.code, code);
    assert.equal(error.lineNumber, lineNumber);
    return true;
  });
}

test("extracts only ordered user input_text with evidence lines and neutral execution state", () => {
  const input = jsonl(metadata,
    user([text("Plan"), { type: "input_image", image_url: "synthetic-image", text: "Image is not a requirement" }, text("保留原文"), { type: "future_content", text: "Unknown content is not text evidence" }]),
    { type: "response_item", payload: { type: "message", role: "assistant", content: [text("Plan"), text("Completed")] } },
    { type: "event_msg", payload: { type: "user_message", message: "Event copy must not become another proposal" } },
    { type: "compacted", payload: { message: "Claimed completion" } },
    { type: "response_item", payload: { type: "function_call_output", output: "Tool claims completion" } },
    user([text("Done")]));
  const before = Buffer.from(input);
  const result = extractConversationUserText(input);
  assert.deepEqual(result.messages, [{ lineNumber: 2, text: "Plan\n保留原文" }, { lineNumber: 7, text: "Done" }]);
  assert.deepEqual(result.coverage, {
    complete: true, truncated: false, reasons: [], inputBytes: input.length, scannedBytes: input.length,
    parsedLines: 7, sessionMetaValidated: true, userMessageRecords: 2, extractedMessages: 2,
    textBytes: 21, ignoredRecords: 4, ignoredContentItems: 2,
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.executionBinding, null);
  assert.equal(result.authorizesDispatch, false);
  assert.deepEqual(input, before);
});

test("SHA256 covers exact original bytes, including newline and UTF8 text", () => {
  const raw = Buffer.from('{"type":"session_meta","payload":{"id":"11111111-1111-4111-8111-111111111111","cwd":"/synthetic"}}\n{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"请核对源文件"}]}}\n');
  const result = extractConversationUserText(raw);
  assert.equal(result.inputSha256, "0490b0345ec34f3a52cc662bee66ca6b6249326f4237d3deb79f01b0316ef24d");
  assert.equal(result.hashScope, "inputBytes");
  assert.deepEqual(result.messages, [{ lineNumber: 2, text: "请核对源文件" }]);
});

test("image-only user messages and unknown content are counted but never fabricated as text", () => {
  const result = extractConversationUserText(jsonl(metadata,
    user([{ type: "input_image", text: "Do not execute this image field" }, { type: "future_content", text: "Do not execute this unknown field" }])));
  assert.deepEqual(result.messages, []);
  assert.equal(result.coverage.userMessageRecords, 1);
  assert.equal(result.coverage.ignoredRecords, 1);
  assert.equal(result.coverage.ignoredContentItems, 2);
  assert.equal(result.coverage.complete, true);
});

test("retains user startup text without claiming it is a business task", () => {
  const value = "# AGENTS.md instructions\nKeep this source text unchanged.\nrm -rf /synthetic/never-executed";
  const result = extractConversationUserText(jsonl(metadata, user([text(value)])));
  assert.deepEqual(result.messages, [{ lineNumber: 2, text: value }]);
  assert.equal(result.status, "unknown");
  assert.equal(result.authorizesDispatch, false);
});

test("byte limit rejects before decoding malformed oversized bytes without a partial input hash", () => {
  rejectsFormat(Buffer.from([0xff, 0xff]), "INPUT_LIMIT", null, { maxBytes: 1 });
});

test("line limit stops before parsing a large record and marks uncovered input", () => {
  const input = jsonl(metadata, user([text("x".repeat(300))]), user([text("later")]));
  const result = extractConversationUserText(input, { maxLineBytes: 200 });
  assert.deepEqual(result.messages, []);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.truncated, true);
  assert.equal(result.coverage.parsedLines, 1);
  assert.equal(result.coverage.scannedBytes, jsonl(metadata).length);
  assert.deepEqual(result.coverage.reasons, [{ limit: "maxLineBytes", maximum: 200, observed: jsonl(user([text("x".repeat(300))])).length - 1, lineNumber: 2 }]);
});

test("metadata over the line budget is rejected instead of returning unvalidated editable evidence", () => {
  const header = { ...metadata, payload: { ...metadata.payload, extra: "x".repeat(300) } };
  rejectsFormat(jsonl(header, user([text("request")])), "HEADER_LIMIT", 1, { maxLineBytes: 200 });
});

test("message limit preserves complete earlier evidence and flags the next user message", () => {
  const result = extractConversationUserText(jsonl(metadata, user([text("first")]),
    { type: "event_msg", payload: { message: "not another user message" } }, user([text("second")])) , { maxMessages: 1 });
  assert.deepEqual(result.messages, [{ lineNumber: 2, text: "first" }]);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.truncated, true);
  assert.deepEqual(result.coverage.reasons, [{ limit: "maxMessages", maximum: 1, observed: 2, lineNumber: 4 }]);
});

test("text limit uses UTF8 bytes and never emits half a multi-part user message", () => {
  const result = extractConversationUserText(jsonl(metadata, user([text("中")]), user([text("a"), text("b")])) , { maxTextBytes: 5 });
  assert.deepEqual(result.messages, [{ lineNumber: 2, text: "中" }]);
  assert.equal(result.coverage.textBytes, 3);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.truncated, true);
  assert.deepEqual(result.coverage.reasons, [{ limit: "maxTextBytes", maximum: 5, observed: 6, lineNumber: 3 }]);
});

test("exact limits allow full coverage when nothing was excluded", () => {
  const input = jsonl(metadata, user([text("中")]));
  const lineLimit = Math.max(jsonl(metadata).length, jsonl(user([text("中")])).length) - 1;
  const result = extractConversationUserText(input, { maxBytes: input.length, maxLineBytes: lineLimit, maxMessages: 1, maxTextBytes: 3 });
  assert.deepEqual(result.messages, [{ lineNumber: 2, text: "中" }]);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.truncated, false);
  assert.deepEqual(result.coverage.reasons, []);
});

test("zero message budget produces explicit incomplete coverage", () => {
  const result = extractConversationUserText(jsonl(metadata, user([text("request")])), { maxMessages: 0 });
  assert.deepEqual(result.messages, []);
  assert.equal(result.coverage.complete, false);
  assert.deepEqual(result.coverage.reasons, [{ limit: "maxMessages", maximum: 0, observed: 1, lineNumber: 2 }]);
});

test("invalid UTF8 is rejected instead of substituting replacement characters", () => {
  rejectsFormat(Buffer.concat([jsonl(metadata), Buffer.from([0xff, 0x0a])]), "INVALID_UTF8", 2);
});

test("malformed complete JSON records and blank records are rejected with source lines", () => {
  rejectsFormat(Buffer.concat([jsonl(metadata), Buffer.from('{"type":\n')]), "INVALID_JSON", 2);
  rejectsFormat(Buffer.concat([jsonl(metadata), Buffer.from("\n")]), "INVALID_JSON", 2);
});

test("a valid but unterminated final record is rejected as an incomplete snapshot", () => {
  const input = jsonl(metadata, user([text("do not accept this tail")]));
  rejectsFormat(input.subarray(0, input.length - 1), "MISSING_FINAL_NEWLINE", 2);
});

test("a session_meta object must be the first record and legacy headers have no fallback", () => {
  rejectsFormat(jsonl(user([text("request")])), "INVALID_SESSION_META", 1);
  rejectsFormat(jsonl({ type: "metadata", payload: { id: "legacy" } }), "INVALID_SESSION_META", 1);
  rejectsFormat(jsonl({ type: "session_meta", payload: null }), "INVALID_SESSION_META", 1);
  rejectsFormat(jsonl({ type: "session_meta", payload: { id: "not-a-uuid", cwd: "/synthetic" } }), "INVALID_SESSION_META", 1);
  rejectsFormat(jsonl({ ...metadata, payload: { ...metadata.payload, cwd: "relative/project" } }), "INVALID_SESSION_META", 1);
  rejectsFormat(Buffer.alloc(0), "MISSING_SESSION_META", 1);
});

test("legacy message content and malformed input_text do not receive a silent fallback", () => {
  rejectsFormat(jsonl(metadata, user("legacy plain text")), "INVALID_CONTENT", 2);
  rejectsFormat(jsonl(metadata, user([{ type: "input_text", text: 12 }])), "INVALID_CONTENT", 2);
});

test("non-object JSON records cannot masquerade as supported rollout records", () => {
  rejectsFormat(jsonl(metadata, null), "INVALID_RECORD", 2);
  rejectsFormat(jsonl(metadata, []), "INVALID_RECORD", 2);
});

test("CRLF input preserves line numbers and supports an exact byte view", () => {
  const raw = jsonl(metadata, user([text("literal \r\n inside text")])).toString("utf8").replaceAll("\n", "\r\n");
  const prefix = Buffer.from("ignored prefix");
  const bytes = Buffer.concat([prefix, Buffer.from(raw)]);
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset + prefix.length, bytes.length - prefix.length);
  const result = extractConversationUserText(view);
  assert.deepEqual(result.messages, [{ lineNumber: 2, text: "literal \r\n inside text" }]);
  assert.equal(result.coverage.inputBytes, view.byteLength);
  assert.equal(result.inputSha256, "ad50258ec728faacb137ec26e63ba829ac0a064281a4b302233e6a41120d8c94");
});

test("non-byte inputs and invalid limits fail explicitly", () => {
  rejectsFormat("not a byte snapshot", "INVALID_INPUT", null);
  for (const options of [{ maxBytes: -1 }, { maxLineBytes: Infinity }, { maxMessages: 1.5 }, { maxTextBytes: NaN }]) {
    rejectsFormat(jsonl(metadata), "INVALID_LIMIT", null, options);
  }
});
