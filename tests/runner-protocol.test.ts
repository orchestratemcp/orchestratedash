/**
 * The runner ↔ agent protocol (MAR-415).
 *
 * Two properties carry the weight here, and both are the kind that pass by
 * accident in a unit test and fail under load in the field:
 *
 * 1. **Framing survives chunk boundaries.** A pipe splits wherever it likes,
 *    and code that splits each chunk on newlines corrupts exactly the messages
 *    that straddle a boundary — which is to say, more of them the busier an
 *    agent gets.
 * 2. **Non-protocol output is not an error.** Agents log. The first
 *    `console.log` in anybody's agent must not look like a fault.
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_PROTOCOL_VERSION,
  createLineReader,
  encodeCommand,
  parseAgentMessage,
} from "../runner/protocol";

describe("command encoding", () => {
  it("writes one newline-terminated line carrying the version", () => {
    const line = encodeCommand({
      command_id: "cmd-1",
      command: "approve",
      target: { agent_id: "a", approval_id: "ap-1" },
      payload: { reason: "looks right" },
    });

    expect(line.endsWith("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);

    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed["protocol_version"]).toBe(AGENT_PROTOCOL_VERSION);
    expect(parsed["type"]).toBe("command");
    expect(parsed["command"]).toBe("approve");
  });

  it("forwards the user's reason to the agent", () => {
    // The reason is deliberately absent from DASH's audit table and present
    // here: the runner is where "why was this approved" is answered.
    const line = encodeCommand({
      command_id: "cmd-1",
      command: "approve",
      target: { agent_id: "a" },
      payload: { reason: "spoke to the customer" },
    });
    const parsed = JSON.parse(line) as { payload?: { reason?: string } };
    expect(parsed.payload?.reason).toBe("spoke to the customer");
  });
});

describe("parsing agent messages", () => {
  it("reads an ack", () => {
    expect(parseAgentMessage('{"type":"ack","command_id":"c1","ok":true,"detail":"done"}')).toEqual({
      type: "ack",
      command_id: "c1",
      ok: true,
      detail: "done",
    });
  });

  it("reads a state report", () => {
    const message = parseAgentMessage('{"type":"state","state":{"status":"running"}}');
    expect(message).toEqual({ type: "state", state: { status: "running" } });
  });

  it("reads a telemetry candidate without pre-validating the event body", () => {
    const valid = parseAgentMessage(
      '{"type":"telemetry","event":{"event_version":1,"agent":"a","run_id":"r","seq":0,"ts":"2026-07-29T12:00:00Z","type":"run_started"}}',
    );
    expect(valid).toMatchObject({
      type: "telemetry",
      event: { event_version: 1, agent: "a", run_id: "r" },
    });

    // The NDJSON envelope is valid even though the telemetry contract is not.
    // Keeping it recognizable lets ingestEvents reject and record this one
    // without discarding valid neighbours in the runner's batch.
    expect(parseAgentMessage('{"type":"telemetry","event":{"event_version":1}}')).toEqual({
      type: "telemetry",
      event: { event_version: 1 },
    });
  });

  it.each([
    ["ordinary logging", "starting up..."],
    ["an empty line", "   "],
    ["broken JSON", "{ not json"],
    ["JSON that is not an object", "[1,2,3]"],
    ["an unknown message type", '{"type":"hello"}'],
    ["an ack with no command id", '{"type":"ack","ok":true}'],
    ["an ack whose ok is not a boolean", '{"type":"ack","command_id":"c","ok":"yes"}'],
    ["a state message whose state is an array", '{"type":"state","state":[]}'],
    ["a telemetry message with no event", '{"type":"telemetry"}'],
  ])("returns null for %s", (_label, line) => {
    expect(parseAgentMessage(line)).toBeNull();
  });
});

describe("line framing", () => {
  it("joins a message split across chunks", () => {
    const reader = createLineReader();
    expect(reader.push('{"type":"a')).toEqual([]);
    expect(reader.push('ck","command_id":"c1"')).toEqual([]);
    expect(reader.push(',"ok":true}\n')).toEqual(['{"type":"ack","command_id":"c1","ok":true}']);
  });

  it("splits several messages arriving in one chunk", () => {
    const reader = createLineReader();
    expect(reader.push("one\ntwo\nthree\n")).toEqual(["one", "two", "three"]);
  });

  it("holds a trailing partial line until its newline arrives", () => {
    const reader = createLineReader();
    expect(reader.push("complete\npartial")).toEqual(["complete"]);
    expect(reader.push("\n")).toEqual(["partial"]);
  });

  it("drops an over-long line and resynchronises at the next newline", () => {
    // An agent that writes forever with no newline must not be able to exhaust
    // the runner's memory, and must not poison every message after it either.
    const reader = createLineReader(32);
    expect(reader.push("x".repeat(64))).toEqual([]);
    expect(reader.overflowed()).toBe(true);

    expect(reader.push("still-truncated\nrecovered\n")).toEqual(["still-truncated", "recovered"]);
    expect(reader.overflowed()).toBe(false);
  });
});
