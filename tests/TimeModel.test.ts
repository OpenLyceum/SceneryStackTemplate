/**
 * TimeModel.test.ts
 *
 * Sample unit test shipped with the template so new sims are testable by default.
 * Exercises the composable play/pause + elapsed-time model in src/common/TimeModel.ts.
 * Delete or replace these when building a real sim — but keep at least one test so the
 * fleet-wide CI "test" step has something to run.
 */

import { TimeSpeed } from "scenerystack/scenery-phet";
import { describe, expect, it } from "vitest";
import { TimeModel } from "../src/common/TimeModel.js";

describe("TimeModel", () => {
  it("starts paused at time 0 by default", () => {
    const model = new TimeModel();
    expect(model.isPlayingProperty.value).toBe(false);
    expect(model.timeProperty.value).toBe(0);
    model.dispose();
  });

  it("can start playing when constructed with initiallyPlaying", () => {
    const model = new TimeModel({ initiallyPlaying: true });
    expect(model.isPlayingProperty.value).toBe(true);
    model.dispose();
  });

  it("does not advance time while paused", () => {
    const model = new TimeModel();
    model.step(1);
    expect(model.timeProperty.value).toBe(0);
    model.dispose();
  });

  it("accumulates time while playing", () => {
    const model = new TimeModel({ initiallyPlaying: true });
    model.step(0.5);
    model.step(0.25);
    expect(model.timeProperty.value).toBeCloseTo(0.75);
    model.dispose();
  });

  it("reset() restores the initial playback state and clears time", () => {
    const model = new TimeModel();
    model.isPlayingProperty.value = true;
    model.step(2);
    model.reset();
    expect(model.isPlayingProperty.value).toBe(false);
    expect(model.timeProperty.value).toBe(0);
    model.dispose();
  });

  it("does not advance for a non-finite or non-positive dt", () => {
    const model = new TimeModel({ initiallyPlaying: true });
    model.step(Number.NaN);
    model.step(Number.POSITIVE_INFINITY);
    model.step(-1);
    model.step(0);
    expect(model.timeProperty.value).toBe(0);
    model.dispose();
  });

  it("advance() moves the clock by exactly dt, even while paused", () => {
    const model = new TimeModel({
      timeSpeedMultipliers: new Map([
        [TimeSpeed.NORMAL, 1],
        [TimeSpeed.SLOW, 0.25],
      ]),
      initialTimeSpeed: TimeSpeed.SLOW,
    });
    model.advance(0.5);
    model.advance(-0.2);
    expect(model.timeProperty.value).toBeCloseTo(0.3);
    model.dispose();
  });

  it("defaults to a single NORMAL speed with multiplier 1", () => {
    const model = new TimeModel();
    expect(model.timeSpeeds).toEqual([TimeSpeed.NORMAL]);
    expect(model.timeSpeedProperty.value).toBe(TimeSpeed.NORMAL);
    expect(model.speedMultiplier).toBe(1);
    model.dispose();
  });

  it("scales step() and scaledDt() by the selected speed, in display order", () => {
    const model = new TimeModel({
      initiallyPlaying: true,
      timeSpeedMultipliers: new Map([
        [TimeSpeed.FAST, 2],
        [TimeSpeed.NORMAL, 1],
        [TimeSpeed.SLOW, 0.25],
      ]),
    });
    expect(model.timeSpeeds).toEqual([TimeSpeed.FAST, TimeSpeed.NORMAL, TimeSpeed.SLOW]);
    model.timeSpeedProperty.value = TimeSpeed.SLOW;
    expect(model.scaledDt(1)).toBeCloseTo(0.25);
    model.step(1);
    model.timeSpeedProperty.value = TimeSpeed.FAST;
    model.step(1);
    expect(model.timeProperty.value).toBeCloseTo(2.25);
    model.isPlayingProperty.value = false;
    expect(model.scaledDt(1)).toBe(0);
    model.dispose();
  });

  it("reset() restores the initial speed", () => {
    const model = new TimeModel({
      timeSpeedMultipliers: new Map([
        [TimeSpeed.NORMAL, 1],
        [TimeSpeed.SLOW, 0.4],
      ]),
      initialTimeSpeed: TimeSpeed.SLOW,
    });
    model.timeSpeedProperty.value = TimeSpeed.NORMAL;
    model.reset();
    expect(model.timeSpeedProperty.value).toBe(TimeSpeed.SLOW);
    expect(model.speedMultiplier).toBe(0.4);
    model.dispose();
  });

  it("rejects an initial speed that is not selectable", () => {
    expect(() => new TimeModel({ initialTimeSpeed: TimeSpeed.FAST })).toThrow();
  });

  it("omits units metadata when units is null", () => {
    const model = new TimeModel({ units: null });
    expect(model.timeProperty.units).toBeNull();
    model.dispose();
  });
});
