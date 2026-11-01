import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axisFor, carriedSpeed, coastStep, onAxis, releaseVelocity, withCarry } from '../src/carrel/static/pan.js';

/** A move of `length` px at `degrees` from straight down. */
function at(degrees, length = 100) {
  const rad = (degrees * Math.PI) / 180;
  return [length * Math.sin(rad), length * Math.cos(rad)];
}

test('a swipe within 30° of an axis keeps to it, either way', () => {
  for (const sign of [1, -1]) {
    assert.equal(axisFor(0, 100 * sign), 'y');
    assert.equal(axisFor(...at(25).map((v) => v * sign)), 'y');
    assert.equal(axisFor(-at(25)[0], at(25)[1] * sign), 'y');
    assert.equal(axisFor(100 * sign, 0), 'x');
    assert.equal(axisFor(...at(65).map((v) => v * sign)), 'x');
  }
});

test('a diagonal moves freely', () => {
  assert.equal(axisFor(...at(35)), 'both');
  assert.equal(axisFor(...at(45)), 'both');
  assert.equal(axisFor(...at(55)), 'both');
  assert.equal(axisFor(-70, -70), 'both');
});

test('a move kept to its axis', () => {
  assert.deepEqual(onAxis('y', 7, 40), { dx: 0, dy: 40 });
  assert.deepEqual(onAxis('x', 40, 7), { dx: 40, dy: 0 });
  assert.deepEqual(onAxis('both', 30, 30), { dx: 30, dy: 30 });
});

test('the speed at release weighs the last three moves, the newest least, on the axis', () => {
  const samples = [
    { t: 0, x: 0, y: 0 },
    { t: 16, x: 0, y: 10 }, // 0.625 px/ms, too old to count
    { t: 32, x: 0, y: 26 }, // 1 px/ms, weighed 0.6
    { t: 48, x: 8, y: 58 }, // 2 px/ms, weighed 0.35
    { t: 64, x: 8, y: 106 }, // 3 px/ms, weighed 0.05
  ];
  const { vx, vy } = releaseVelocity(samples, 'y', 70);
  assert.equal(vx, 0);
  assert.ok(Math.abs(vy - (0.6 * 1 + 0.35 * 2 + 0.05 * 3)) < 1e-9, String(vy));
  assert.ok(Math.abs(releaseVelocity(samples, 'both', 70).vx - 0.35 * 0.5) < 1e-9);
});

test('a short flick of one or two moves still coasts at its speed', () => {
  const one = [
    { t: 0, x: 0, y: 0 },
    { t: 16, x: 0, y: -32 },
  ];
  assert.deepEqual(releaseVelocity(one, 'y', 20), { vx: 0, vy: -2 });
});

test('a release is no faster than 8 px/ms', () => {
  const samples = [
    { t: 0, x: 0, y: 0 },
    { t: 10, x: 0, y: 200 },
  ];
  assert.equal(releaseVelocity(samples, 'y', 12).vy, 8);
});

test('a finger that stopped before lifting does not coast', () => {
  const samples = [
    { t: 0, x: 0, y: 0 },
    { t: 50, x: 0, y: 80 },
  ];
  assert.deepEqual(releaseVelocity(samples, 'y', 100), { vx: 0, vy: 0 });
  assert.deepEqual(releaseVelocity([], 'y', 0), { vx: 0, vy: 0 });
});

test('a flick while coasting adds to the speed, as iOS does', () => {
  // Flutter's fit: 3000 px/s carries 0.000816 · 3000^1.967 px/s.
  const carried = carriedSpeed(3);
  assert.ok(Math.abs(carried - (0.000816 * 3000 ** 1.967) / 1000) < 1e-9);
  assert.ok(carriedSpeed(-3) < 0);
  assert.equal(carriedSpeed(1000), 40);
  assert.ok(Math.abs(withCarry(3, carried) - (3 + carried)) < 1e-9);
});

test('a flick against the coast, or much slower than it, carries nothing', () => {
  assert.equal(withCarry(-3, carriedSpeed(3)), -3);
  assert.equal(withCarry(1, 4), 1);
  assert.equal(withCarry(2, 0), 2);
  assert.equal(withCarry(0, 3), 0);
  assert.equal(withCarry(30, 30), 40);
});

test('coasting slows at UIScrollView’s rate, and one slow frame goes as far as two', () => {
  const one = coastStep({ vx: 0, vy: 2 }, 32);
  const half = coastStep({ vx: 0, vy: 2 }, 16);
  const second = coastStep(half, 16);
  assert.ok(Math.abs(one.dy - (half.dy + second.dy)) < 1e-9);
  assert.ok(Math.abs(one.vy - 2 * 0.998 ** 32) < 1e-12);
  assert.ok(one.dy < 2 * 32 && one.dy > 2 * 0.998 ** 32 * 32);
  assert.equal(one.done, false);
});

test('coasting stops once slow', () => {
  let state = { vx: 0, vy: 3 };
  let travelled = 0;
  let frames = 0;
  while (!state.done && frames < 10000) {
    state = coastStep(state, 16);
    travelled += state.dy;
    frames += 1;
  }
  assert.ok(state.done);
  // A 3 px/ms flick coasts about 3 / -ln(0.998) ≈ 1500 px, less the slow tail cut off.
  assert.ok(travelled > 1400 && travelled < 1500, String(travelled));
});
