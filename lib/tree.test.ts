import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { daysNeeded, ladder, stageFor, stageForMonth, stageHint, STAGES, withRo } from "./tree.ts";

describe("tree stages", () => {
  it("30-day month, month over: 0 / 1 / 9 / 15 / 21 / 28 / 30 kept days", () => {
    assert.equal(stageFor(0, 30, 30), 0);
    assert.equal(stageFor(1, 30, 30), 1);
    assert.equal(stageFor(8, 30, 30), 1);
    assert.equal(stageFor(9, 30, 30), 2);
    assert.equal(stageFor(14, 30, 30), 2);
    assert.equal(stageFor(15, 30, 30), 3);
    assert.equal(stageFor(20, 30, 30), 3);
    assert.equal(stageFor(21, 30, 30), 4);
    assert.equal(stageFor(27, 30, 30), 4); // 놓친 날 3일
    assert.equal(stageFor(28, 30, 30), 5); // 놓친 날 2일
    assert.equal(stageFor(29, 30, 30), 5);
    assert.equal(stageFor(30, 30, 30), 6);
  });

  it("28-day and 31-day months treat the top two stages the same way", () => {
    for (const days of [28, 31]) {
      assert.equal(stageFor(days, days, days), 6, `${days}: none missed`);
      assert.equal(stageFor(days - 1, days, days), 5, `${days}: 1 missed`);
      assert.equal(stageFor(days - 2, days, days), 5, `${days}: 2 missed`);
      assert.equal(stageFor(days - 3, days, days), 4, `${days}: 3 missed`);
    }
  });

  it("ratio stages follow the length of the month", () => {
    assert.equal(daysNeeded(2, 30), 9);
    assert.equal(daysNeeded(3, 30), 15);
    assert.equal(daysNeeded(4, 30), 21);
    assert.equal(daysNeeded(2, 31), 10);
    assert.equal(daysNeeded(3, 31), 16);
    assert.equal(daysNeeded(4, 31), 22);
    assert.equal(daysNeeded(2, 28), 9);
    assert.equal(daysNeeded(4, 28), 20);
    assert.equal(stageFor(9, 31, 31), 1);
    assert.equal(stageFor(10, 31, 31), 2);
    assert.deepEqual(
      ladder(31).map((s) => s.cond),
      ["1일 이상", "10일 이상", "16일 이상", "22일 이상", "놓친 날 2일 이하", "하루도 안 놓침"],
    );
  });

  it("does not show the top two stages in the middle of the month", () => {
    assert.equal(stageFor(20, 30, 20), 3); // 하루도 안 놓쳤지만 달 중간
    assert.equal(stageFor(29, 30, 29), 4);
    assert.equal(stageFor(28, 31, 30), 4);
    assert.equal(stageFor(0, 30, 0), 0);
  });

  it("a month with few counted days stops at 나무", () => {
    assert.equal(stageForMonth(3, 3, 3), 4);
    assert.equal(stageForMonth(13, 13, 13), 4);
    assert.equal(stageForMonth(14, 14, 14), 6);
    assert.equal(stageForMonth(0, 0, 0), 0);
  });

  it("writes the line under the tree", () => {
    assert.equal(stageHint(26, 30, 28), "남은 2일을 다 지키면 어른나무까지 가요");
    assert.equal(stageHint(22, 30, 27), "이대로 가면 나무로 이번 달을 마쳐요"); // 이미 5일 놓침
    assert.equal(stageHint(20, 30, 27), "남은 3일을 다 지키면 나무까지 가요");
    assert.equal(stageHint(5, 30, 28), "이대로 가면 새싹으로 이번 달을 마쳐요");
    assert.equal(stageHint(30, 30, 30), STAGES[6].note);
    assert.equal(stageHint(0, 30, 30), STAGES[0].note);
    assert.equal(withRo("나무"), "나무로");
    assert.equal(withRo("떡잎"), "떡잎으로");
    assert.equal(withRo("세계수"), "세계수로");
  });
});
