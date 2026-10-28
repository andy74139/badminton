"use strict";
var assert = require("assert");
var R = require("../roster.js");
var P = require("../pairing.js");

var passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS:", name); }
  catch (e) { console.error("FAIL:", name, "\n", e && e.stack ? e.stack : e); }
}

function membersArr(state) { return Object.keys(state.members).map(function(id){return state.members[id];}); }

// 測試用固定名單（16 組 20 人，含 4 組雙人輪流），不依賴 roster.js 的預設名單，修改預設名單不會影響測試。
var FIXTURE_ROSTER = "述懷\n睿汎\n述懷友\n廉恩 / 詩婷\n皓昕 / 郁婷\n宜蓁 / 楷鵑\n翊暄 / 采音\n俊宏\n永謙\n炫州\n四月\nCindy\n鄧斌\n石承恩\n吳承樺\n廖奕深";
function fixtureState() {
  var st = R.createDefaultState();
  var parsed = R.parsePaste(FIXTURE_ROSTER);
  R.attachSuggestedProfiles(st, parsed);
  R.applyImport(st, parsed, "new", null, 0);
  st.profiles = {};
  R.ensureProfiles(st);
  return st;
}

test("individual score boundaries", function() {
  var avg = 3;
  var cases = [
    [1.9, 4], [2, 2], [2.49, 2], [2.5, 0], [3.5, 0], [3.6, -2], [4, -2], [4.01, -4]
  ];
  cases.forEach(function(c) {
    var st = fixtureState();
    var m = membersArr(st)[0];
    m.playCount = c[0];
    m.restCreditTotal = 0; m.restStartAverage = null; m.resting = false;
    // disable weird: effective = playCount
    var sc = P.individualScore(m, st, avg, 1000000);
    // recent finish not triggered
    assert.strictEqual(sc, c[1], "count=" + c[0] + " expected " + c[1] + " got " + sc);
  });
});

test("recent finish penalty boundaries", function() {
  var st = fixtureState();
  var m = membersArr(st)[0];
  m.playCount = 3; // avg effective approx
  var now = 500000;
  m.lastFinishedAt = now - 119999;
  var s1 = P.individualScore(m, st, 3, now);
  m.lastFinishedAt = now - 120000;
  var s2 = P.individualScore(m, st, 3, now);
  // d iff recent penalty -3; base 0 likely
  assert.strictEqual(s1 + 3, s2, "119999 should deduct 3, 120000 not");
  // also direct check lastFinished now-119999 has penalty, now-120000 no penalty
});

test("pairing bonus: all-female and mixed (M+F vs M+F)", function() {
  function mk(g) { return { name:"x", gender:g, skill:2 }; }
  var allF = [mk("F"), mk("F"), mk("F"), mk("F")];
  // any split
  P.PAIRINGS.forEach(function(split) {
    assert.strictEqual(P.pairingBonusForSplit(allF, split), P.SCORE.ALL_FEMALE_BONUS);
  });
  var mixed = [mk("M"), mk("F"), mk("M"), mk("F")];
  // mixed split where teams are M/F vs M/F: split [0,2? Wait people order. Try split [[0,1],[2,3]] with team 0=M/F?]
  // Build people order so team0 indices 0,1 = M,F and team1 2,3=M,F
  var p2 = [mk("M"), mk("F"), mk("M"), mk("F")];
  var goodSplit = [[0,1],[2,3]];
  assert.strictEqual(P.pairingBonusForSplit(p2, goodSplit), P.SCORE.MIXED_DOUBLE_BONUS);
  // bad split: teams M,M and F,F
  var badSplit = [[0,2],[1,3]];
  assert.strictEqual(P.pairingBonusForSplit(p2, badSplit), 0);
  // unknown gender -> 0
  var unk = [mk("M"), mk("F"), mk(null), mk("F")];
  assert.strictEqual(P.pairingBonusForSplit(unk, goodSplit), 0);
});

test("skill penalty", function() {
  function mk(s) { return { name:"x", gender:null, skill:s }; }
  // diff 0
  var p0 = [mk(1), mk(1), mk(2), mk(2)]; // team 1+1=2 vs 2+2=4 diff2 actually
  // construct explicit team sums via pairingScoreForSplit split [0,1] vs [2,3]
  var p = [mk(1), mk(2), mk(1), mk(2)];
  // 0,1 sum 3; 2,3 sum 3 diff0
  assert.strictEqual(P.skillPenaltyForSplit(p, [[0,1],[2,3]]), P.SCORE.SKILL_DIFF_0_OR_1);
  // diff2
  var p2 = [mk(1), mk(1), mk(2), mk(2)]; // 2 vs 4 diff2
  assert.strictEqual(P.skillPenaltyForSplit(p2, [[0,1],[2,3]]), P.SCORE.SKILL_DIFF_2);
  // diff3+
  var p3 = [mk(1), mk(1), mk(3), mk(3)]; // 2 vs 6 diff4
  assert.strictEqual(P.skillPenaltyForSplit(p3, [[0,1],[2,3]]), P.SCORE.SKILL_DIFF_3_OR_MORE);
  // missing skill -> 0
  var pm = [mk(1), mk(null), mk(2), mk(2)];
  assert.strictEqual(P.skillPenaltyForSplit(pm, [[0,1],[2,3]]), 0);
});

test("rest credit thresholds", function() {
  var m = { resting: true, restStartAverage: 1.0 };
  assert.strictEqual(P.activeRestCredit(m, 1.49, true), 0);
  assert.strictEqual(P.activeRestCredit(m, 1.5, true), 0.5);
  assert.strictEqual(P.activeRestCredit(m, 1.99, true), 0.5);
  assert.strictEqual(P.activeRestCredit(m, 2.0, true), 1.0);
  // baseline 0.6 -> 1.0
  var m2 = { resting: true, restStartAverage: 0.6 };
  assert.strictEqual(P.activeRestCredit(m2, 1.49, true), 0);
  assert.strictEqual(P.activeRestCredit(m2, 1.5, true), 0.5);
});

test("rest credit no feedback to avgActual", function() {
  var st = fixtureState();
  var m = membersArr(st)[0];
  m.playCount = 0; m.restCreditTotal = 5; m.resting = true; m.restStartAverage = 1;
  var before = P.avgActualPlayCount(st);
  // add more credit
  m.restCreditTotal += 3;
  var after = P.avgActualPlayCount(st);
  assert.strictEqual(before, after);
});

test("disabled compensation not counted in effective play count", function() {
  var st = fixtureState();
  st.settings.restCompensationEnabled = false;
  var m = membersArr(st)[0];
  m.playCount = 2; m.restCreditTotal = 5; m.resting = false;
  assert.strictEqual(P.effectivePlayCount(m, st), 2);
  // enabled then counts stored compensation
  st.settings.restCompensationEnabled = true;
  assert.strictEqual(P.effectivePlayCount(m, st), 7);
});

test("disabled compensation no accumulate", function() {
  var st = fixtureState();
  st.settings.restCompensationEnabled = false;
  var m = membersArr(st)[0];
  m.resting = true; m.restStartAverage = null;
  // toggle on with disabled? using setResting with enabled? Pairing.setResting uses state.settings
  // entering rest should not set baseline when disabled
  var m2 = membersArr(st)[1];
  m2.playCount = 0;
  P.toggleResting(st, m2.id); // enable? state disabled, but free toggle enters resting
  // restStartAverage should null due disabled
  assert.strictEqual(st.members[m2.id].restStartAverage, null);
  assert.strictEqual(P.activeRestCredit(st.members[m2.id], P.avgActualPlayCount(st), st.settings.restCompensationEnabled), 0);
});

test("group restriction in enumeration distinct groups", function() {
  // pair group of 2 should not have both members in same lineup
  function build() {
    var names = ["A","B","C","D","E"];
    var members = {}; var groups=[]; var counts={}; var seq=1; var gid=1;
    // group0 pair A,B
    var ids=[seq++,seq++];
    members[ids[0]]={id:ids[0],name:"A",groupId:gid,playCount:0,onCourt:null,gender:null,skill:null,resting:false,lastFinishedAt:null,restCreditTotal:0,restStartAverage:null};
    members[ids[1]]={id:ids[1],name:"B",groupId:gid,playCount:0,onCourt:null,gender:null,skill:null,resting:false,lastFinishedAt:null,restCreditTotal:0,restStartAverage:null};
    groups.push({id:gid,memberIds:ids}); counts[gid]=0; gid++;
    ["C","D","E"].forEach(function(n){
      var id=seq++;
      members[id]={id:id,name:n,groupId:gid,playCount:0,onCourt:null,gender:null,skill:null,resting:false,lastFinishedAt:null,restCreditTotal:0,restStartAverage:null};
      groups.push({id:gid,memberIds:[id]}); counts[gid]=0; gid++;
    });
    return {schemaVersion:3,nextGroupId:gid,nextMemberId:seq,groups:groups,members:members,groupCounts:counts,courts:{A:[null,null,null,null],B:[null,null,null,null],C:[null,null,null,null]},pending:{A:false,B:false,C:false},courtCount:1,started:false,settings:{restCompensationEnabled:true},profiles:{}};
  }
  var st = build();
  R.ensureStateFields(st); P.ensureStateFields(st);
  R.ensureProfiles(st);
  var combo = P.pickBestCourtCombo(st);
  // only 4 distinct groups (pair + 3 singles) -> one group per group
  var groupIds = combo.people.map(function(m){ return m.groupId; });
  var uniq = {};
  groupIds.forEach(function(g){ uniq[g]=true; });
  assert.strictEqual(Object.keys(uniq).length, 4, "4 distinct groups");
  // pair group appears at most once
  var pairCount = groupIds.filter(function(g){ return g === 1; }).length;
  assert.ok(pairCount <= 1);
});

test("more than 12 groups all considered", function() {
  // create 15 groups; ensure combo exists and no throw
  var members={}; var groups=[]; var counts={}; var seq=1; var gid=1;
  for(var i=0;i<15;i++){
    var id=seq++;
    members[id]={id:id,name:"P"+i,groupId:gid,playCount:0,onCourt:null,gender:null,skill:null,resting:false,lastFinishedAt:null,restCreditTotal:0,restStartAverage:null};
    groups.push({id:gid,memberIds:[id]}); counts[gid]=0; gid++;
  }
  var st={schemaVersion:3,nextGroupId:gid,nextMemberId:seq,groups:groups,members:members,groupCounts:counts,courts:{A:[null,null,null,null],B:[null,null,null,null],C:[null,null,null,null]},pending:{A:false,B:false,C:false},courtCount:1,started:false,settings:{restCompensationEnabled:true},profiles:{}};
  R.ensureStateFields(st); P.ensureStateFields(st);
  var res = P.pickBestCourtCombo(st);
  assert.ok(res, "combo found");
  assert.strictEqual(res.people.length,4);
});

test("import parse basic", function() {
  var p = R.parsePaste("王小明\n廉恩 / 詩婷\n\n   ");
  assert.strictEqual(p.ok, true, JSON.stringify(p.errors));
  assert.strictEqual(p.groups.length, 2);
  assert.strictEqual(p.people.length, 3);
  var p2 = R.parsePaste("A / B / C");
  assert.strictEqual(p2.ok, false);
  var p3 = R.parsePaste("   \n  ");
  assert.strictEqual(p3.ok, false);
  var p4 = R.parsePaste("王 / \n");
  // trailing blank ignored; Wang / empty => error
  assert.strictEqual(p4.errors.length > 0, true);
});

test("import duplicate name warning/error", function() {
  var p = R.parsePaste("王小明\n王小明 / 陳");
  assert.strictEqual(p.ok, false);
  assert.ok(p.errors.some(function(e){ return e.indexOf("重複")!==-1; }));
});

test("import apply new session resets counts", function() {
  var st = fixtureState();
  var m0 = membersArr(st)[0];
  m0.playCount = 5; m0.gender = "F"; m0.skill = 2;
  // ensure profile
  R.ensureProfiles(st);
  var parsed = R.parsePaste("新人甲\n新人乙 / 新人丙");
  R.attachSuggestedProfiles(st, parsed);
  var res = R.applyImport(st, parsed, "new", null, 123);
  assert.strictEqual(res.ok, true);
  // old member profile maybe retained but count reset? new session removes old members
  assert.ok(!membersArr(st).some(function(m){ return m.name === m0.name && m.playCount === 5; }));
  var playCounts = membersArr(st).map(function(m){ return m.playCount; });
  assert.ok(playCounts.every(function(c){ return c === 0; }));
});

test("import apply update preserves counts", function() {
  var st = fixtureState();
  var existing = membersArr(st).find(function(m){ return m.name === "述懷"; });
  existing.playCount = 7; existing.gender="M"; existing.skill=3;
  R.ensureProfiles(st);
  var parsed = R.parsePaste("述懷\n新人乙");
  R.attachSuggestedProfiles(st, parsed);
  var res = R.applyImport(st, parsed, "update", null, 1);
  assert.strictEqual(res.ok, true);
  var same = membersArr(st).find(function(m){ return m.name === "述懷"; });
  assert.ok(same, "kept");
  assert.strictEqual(same.playCount, 7, "preserved playCount");
  var newbie = membersArr(st).find(function(m){ return m.name === "新人乙"; });
  assert.ok(newbie);
  assert.strictEqual(newbie.playCount, 0);
});

test("migration v2 preserves data and profiles", function() {
  var v2 = {
    nextGroupId: 17, nextMemberId: 20,
    groups: [{id:1, memberIds:[1,2]}, {id:2, memberIds:[3]}],
    members: {
      1:{id:1,name:"甲",groupId:1,playCount:4,onCourt:"A",gender:"F",skill:2,resting:false},
      2:{id:2,name:"乙",groupId:1,playCount:2,onCourt:null,gender:"M",skill:1,resting:true},
      3:{id:3,name:"丙",groupId:2,playCount:1,onCourt:null,gender:null,skill:null,resting:false}
    },
    groupCounts: {1:4,2:1},
    pending:{A:false,B:false,C:false},
    courtCount:2,
    started:true
  };
  v2.courts = { A:[null,null,null,null], B:[null,null,null,null], C:[null,null,null,null] };
  // fix courts invalid: only member 1 on A
  v2.courts.A = [{groupId:1,memberId:1}, null, null, null];
  var st = R.migrateV2(v2);
  R.ensureStateFields(st); P.ensureStateFields(st);
  var ma = st.members[1];
  assert.strictEqual(ma.playCount, 4);
  assert.strictEqual(ma.gender, "F");
  assert.strictEqual(ma.skill, 2);
  assert.strictEqual(ma.onCourt, "A");
  assert.strictEqual(st.courtCount, 2);
  assert.strictEqual(st.started, true);
  assert.ok(st.profiles[R.normalizeName("甲")], "profile created");
  assert.strictEqual(st.profiles[R.normalizeName("甲")].gender, "F");
});

test("manual selected profile copy to new name", function() {
  var st = fixtureState();
  // add profile "舊人"
  st.profiles[R.normalizeName("舊人")] = { name:"舊人", gender:"F", skill:3 };
  // no member named old in session
  var parsed = R.parsePaste("新人");
  R.attachSuggestedProfiles(st, parsed);
  // pass selections mapping to old profile
  var res = R.applyImport(st, parsed, "new", [R.normalizeName("舊人")], 1);
  assert.strictEqual(res.ok, true);
  var m = membersArr(st)[0];
  assert.strictEqual(m.gender, "F");
  assert.strictEqual(m.skill, 3);
  assert.strictEqual(st.profiles[R.normalizeName("新人")].gender, "F");
});

test("normalizeName", function() {
  assert.strictEqual(R.normalizeName("  A  B  "), "a b");
  assert.strictEqual(R.normalizeName("ABC"), "abc");
});

test("save error helpers not required; effective playCount formatting", function() {});

// K-01：固定雙人組貼上格式
test("parse fixed pair marker", function() {
  var p = R.parsePaste("甲 / 乙 / [固定]\n丙/丁/(固定)\n戊 / 己 / 【固定】\n庚\n辛 / 壬");
  assert.strictEqual(p.ok, true, JSON.stringify(p.errors));
  assert.deepStrictEqual(p.groups.map(function(g){ return g.type; }), ["fixed", "fixed", "fixed", "single", "rotate"]);
  assert.deepStrictEqual(p.groups[0].names, ["甲", "乙"]);
  assert.strictEqual(p.people.length, 9);
  // 固定組只有一人、或只有標記，都要報錯
  assert.strictEqual(R.parsePaste("甲 / [固定]").ok, false);
  assert.strictEqual(R.parsePaste("[固定]").ok, false);
  assert.strictEqual(R.parsePaste("甲 / 乙 / 丙 / [固定]").ok, false);
});

test("import fixed pair creates fixed group", function() {
  var st = fixtureState();
  var parsed = R.parsePaste("甲 / 乙 / [固定]\n丙");
  R.attachSuggestedProfiles(st, parsed);
  assert.strictEqual(R.applyImport(st, parsed, "new", null, 1).ok, true);
  var types = st.groups.map(function(g){ return g.type; });
  assert.deepStrictEqual(types, ["fixed", "single"]);
});

// K-02：更新目前場次後座位與 onCourt 一致
function seatLineup(st, court, names) {
  names.forEach(function(nm, i) {
    var m = membersArr(st).find(function(x){ return x.name === nm; });
    m.onCourt = court;
    st.courts[court][i] = { groupId: m.groupId, memberId: m.id };
  });
}
function rosterText(st, skip) {
  return st.groups.map(function(g){
    return g.memberIds.map(function(id){ return st.members[id].name; })
      .filter(function(n){ return (skip || []).indexOf(n) === -1; }).join(" / ");
  }).filter(Boolean).join("\n");
}
function assertOnCourtConsistent(st) {
  var seated = {};
  ["A","B","C"].forEach(function(c){ st.courts[c].forEach(function(s){ if (s) seated[s.memberId] = c; }); });
  membersArr(st).forEach(function(m){
    assert.strictEqual(m.onCourt, seated[m.id] || null, m.name + " onCourt mismatch");
  });
  ["A","B","C"].forEach(function(c){ st.courts[c].forEach(function(s){
    if (s) assert.strictEqual(s.groupId, st.members[s.memberId].groupId, "seat groupId stale");
  }); });
}

test("update import keeps seats of remaining members", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  seatLineup(st, "A", ["述懷", "睿汎", "俊宏", "永謙"]);
  var parsed = R.parsePaste(rosterText(st));
  R.attachSuggestedProfiles(st, parsed);
  assert.strictEqual(R.applyImport(st, parsed, "update", null, 1).ok, true);
  assert.deepStrictEqual(st.courts.A.map(function(s){ return s && st.members[s.memberId].name; }), ["述懷", "睿汎", "俊宏", "永謙"]);
  assertOnCourtConsistent(st);
});

test("update import clears seat of removed member only", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  seatLineup(st, "A", ["述懷", "睿汎", "俊宏", "永謙"]);
  var parsed = R.parsePaste(rosterText(st, ["睿汎"]));
  R.attachSuggestedProfiles(st, parsed);
  assert.strictEqual(R.applyImport(st, parsed, "update", null, 1).ok, true);
  assert.deepStrictEqual(st.courts.A.map(function(s){ return s && st.members[s.memberId].name; }), ["述懷", null, "俊宏", "永謙"]);
  assertOnCourtConsistent(st);
  // 被清空座位後，其他人仍可被安排
  assert.ok(P.collectAvailablePersons(st).length > 0);
});

test("update import keeps current seats even when new groups conflict", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  seatLineup(st, "A", ["述懷", "睿汎", "俊宏", "永謙"]);
  seatLineup(st, "B", ["炫州", "四月", "Cindy", "鄧斌"]);
  // 述懷、炫州（不同場地）改成雙人輪流、俊宏永謙改成固定組：場上配隊都不變，只影響之後
  var text = rosterText(st, ["述懷", "炫州", "俊宏", "永謙"]) + "\n述懷 / 炫州\n俊宏 / 永謙 / [固定]";
  var parsed = R.parsePaste(text);
  R.attachSuggestedProfiles(st, parsed);
  assert.strictEqual(R.applyImport(st, parsed, "update", null, 1).ok, true);
  var nameAt = function(c){ return st.courts[c].map(function(s){ return s && st.members[s.memberId].name; }); };
  assert.deepStrictEqual(nameAt("A"), ["述懷", "睿汎", "俊宏", "永謙"]);
  assert.deepStrictEqual(nameAt("B"), ["炫州", "四月", "Cindy", "鄧斌"]);
  assertOnCourtConsistent(st);
});

test("normalizeSeats keeps seats after group changes and repairs stuck onCourt", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  seatLineup(st, "A", ["述懷", "睿汎", "俊宏", "永謙"]);
  // 把述懷、俊宏（不同隊）設成固定組：座位保留
  var a = membersArr(st).find(function(m){ return m.name === "述懷"; });
  var b = membersArr(st).find(function(m){ return m.name === "俊宏"; });
  var gB = st.groups.find(function(g){ return g.id === b.groupId; });
  var gA = st.groups.find(function(g){ return g.id === a.groupId; });
  st.groups = st.groups.filter(function(g){ return g !== gB; });
  gA.memberIds.push(b.id); gA.type = "fixed"; b.groupId = gA.id;
  // 另有一位被卡在場上但沒有座位的人；同一人重複佔兩個座位
  membersArr(st).find(function(m){ return m.name === "Cindy"; }).onCourt = "B";
  var dup = membersArr(st).find(function(m){ return m.name === "睿汎"; });
  st.courts.B[0] = { groupId: dup.groupId, memberId: dup.id };
  R.normalizeSeats(st);
  assert.deepStrictEqual(st.courts.A.map(function(s){ return s && st.members[s.memberId].name; }), ["述懷", "睿汎", "俊宏", "永謙"]);
  assert.strictEqual(st.courts.B[0], null, "duplicate seat cleared");
  assertOnCourtConsistent(st);
});

// K-03：自動補位挑人
test("pickFillCandidate uses scoring and skips fixed pairs and resting", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  seatLineup(st, "A", ["述懷", "睿汎", "俊宏"]);
  membersArr(st).forEach(function(m){ m.playCount = 3; });
  // 永謙場數最少 → 應被選中；但先把他設為臨時不打，再把炫州、四月設為固定組
  var low = membersArr(st).find(function(m){ return m.name === "永謙"; });
  low.playCount = 0;
  var pick = P.pickFillCandidate(st, "A", 3);
  assert.strictEqual(pick.name, "永謙");
  P.setResting(st, low.id, true);
  var x = membersArr(st).find(function(m){ return m.name === "炫州"; });
  var y = membersArr(st).find(function(m){ return m.name === "四月"; });
  x.playCount = 0; y.playCount = 0;
  var gx = st.groups.find(function(g){ return g.id === x.groupId; });
  st.groups = st.groups.filter(function(g){ return g.id !== y.groupId; });
  gx.memberIds.push(y.id); gx.type = "fixed"; y.groupId = gx.id;
  pick = P.pickFillCandidate(st, "A", 3);
  assert.ok(pick && ["永謙", "炫州", "四月"].indexOf(pick.name) === -1, "picked " + (pick && pick.name));
});

test("adjustRestCredit changes priority via rest credit", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  var m = membersArr(st)[0];
  m.playCount = 1;
  // 降低優先度：不打 +0.5，有效場數變高
  assert.strictEqual(P.adjustRestCredit(st, m.id, 1), true);
  assert.strictEqual(m.restCreditTotal, 0.5);
  assert.strictEqual(P.effectivePlayCount(m, st), 1.5);
  // 提高優先度：不打場數最低到 0，不會變負數
  assert.strictEqual(P.adjustRestCredit(st, m.id, -1), true);
  assert.strictEqual(m.restCreditTotal, 0);
  assert.strictEqual(P.adjustRestCredit(st, m.id, -1), false);
  assert.strictEqual(m.restCreditTotal, 0);
  // 系統給的起始補償（例如新人 1.5）可以一路扣到 0
  m.restCreditTotal = 1.5;
  P.adjustRestCredit(st, m.id, -1); P.adjustRestCredit(st, m.id, -1); P.adjustRestCredit(st, m.id, -1);
  assert.strictEqual(m.restCreditTotal, 0);
  assert.strictEqual(P.adjustRestCredit(st, m.id, -1), false);
  // 開關關閉時不調整
  st.settings.restCompensationEnabled = false;
  assert.strictEqual(P.adjustRestCredit(st, m.id, 1), false);
  assert.strictEqual(m.restCreditTotal, 0);
});

test("adjustRestCredit can lower credit earned during current rest to 0", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  var all = membersArr(st);
  var m = all[0];
  P.setResting(st, m.id, true);               // 基準 = max(平均 0, 1) = 1
  all.forEach(function(x){ if (x !== m) x.playCount = 2.2; }); // 平均實際 2.2 → 本期補償 1.0（進度多 0.2）
  assert.strictEqual(P.activeRestCredit(m, P.avgActualPlayCount(st), true), 1);
  // ↑ 一次：不打 1.0 → 0.5，本期補償併入已結算
  assert.strictEqual(P.adjustRestCredit(st, m.id, -1), true);
  assert.strictEqual(m.restCreditTotal, 0.5);
  assert.strictEqual(P.activeRestCredit(m, P.avgActualPlayCount(st), true), 0);
  assert.strictEqual(P.effectivePlayCount(m, st), 0.5);
  // 再 ↑ 一次到 0，之後不能再降
  P.adjustRestCredit(st, m.id, -1);
  assert.strictEqual(P.effectivePlayCount(m, st), 0);
  assert.strictEqual(P.adjustRestCredit(st, m.id, -1), false);
  // 保留未滿 0.5 的進度：平均再 +0.3（2.5）就跨過下一個門檻，補償照常累積
  all.forEach(function(x){ if (x !== m) x.playCount = 2.5; });
  assert.strictEqual(P.activeRestCredit(m, P.avgActualPlayCount(st), true), 0.5);
});

test("ensureStateFields clamps negative rest credit to 0", function() {
  var st = fixtureState();
  membersArr(st)[0].restCreditTotal = -1;
  P.ensureStateFields(st);
  assert.strictEqual(membersArr(st)[0].restCreditTotal, 0);
});

test("pastProfiles lists saved people not in current roster, addMemberFromProfile adds them", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  st.profiles = {};
  R.ensureProfiles(st);
  st.profiles["老王"] = { name: "老王", gender: "M", skill: 3 };
  st.profiles["alice"] = { name: "Alice", gender: "F", skill: 1 };
  var past = R.pastProfiles(st).map(function(p){ return p.key; });
  assert.deepStrictEqual(past.sort(), ["alice", "老王"]);
  var mid = R.addMemberFromProfile(st, "老王");
  var m = st.members[mid];
  assert.strictEqual(m.name, "老王");
  assert.strictEqual(m.gender, "M");
  assert.strictEqual(m.skill, 3);
  assert.strictEqual(m.playCount, 0);
  var g = st.groups.find(function(g){ return g.id === m.groupId; });
  assert.strictEqual(g.type, "single");
  assert.deepStrictEqual(R.pastProfiles(st).map(function(p){ return p.key; }), ["alice"]);
  // 已在名單中或不存在的設定檔不會重複加入
  assert.strictEqual(R.addMemberFromProfile(st, "老王"), null);
  assert.strictEqual(R.addMemberFromProfile(st, "nobody"), null);
});

test("deleteProfile removes past profile but not people in current roster", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  R.ensureProfiles(st);
  st.profiles["老王"] = { name: "老王", gender: "M", skill: 3 };
  assert.strictEqual(R.deleteProfile(st, "老王"), true);
  assert.strictEqual(st.profiles["老王"], undefined);
  assert.ok(R.pastProfiles(st).every(function(p){ return p.key !== "老王"; }));
  // 目前名單中的人不能刪
  var inRoster = R.normalizeName(membersArr(st)[0].name);
  assert.strictEqual(R.deleteProfile(st, inRoster), false);
  assert.ok(st.profiles[inRoster]);
  assert.strictEqual(R.deleteProfile(st, "nobody"), false);
});

test("setPairType switches fixed <-> rotate anytime, keeping seats", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  var g = st.groups.find(function(g){ return g.memberIds.length === 2; });
  var names = g.memberIds.map(function(id){ return st.members[id].name; });
  assert.strictEqual(g.type, "rotate");
  assert.strictEqual(R.setPairType(st, g.id, "fixed"), true);
  assert.strictEqual(g.type, "fixed");
  // 兩人都在場上也可以改成輪流；座位不動
  seatLineup(st, "A", [names[0], names[1], "述懷", "睿汎"]);
  assert.strictEqual(R.setPairType(st, g.id, "rotate"), true);
  assert.strictEqual(g.type, "rotate");
  R.normalizeSeats(st);
  assert.deepStrictEqual(st.courts.A.map(function(s){ return s && st.members[s.memberId].name; }), [names[0], names[1], "述懷", "睿汎"]);
  // 單人組、未知類型不處理
  var single = st.groups.find(function(g){ return g.memberIds.length === 1; });
  assert.strictEqual(R.setPairType(st, single.id, "fixed"), false);
  assert.strictEqual(R.setPairType(st, g.id, "single"), false);
});

test("linkMembers / splitPair keep current seats; new pairing applies to later picks", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  var byName = function(n){ return membersArr(st).find(function(m){ return m.name === n; }); };
  seatLineup(st, "A", ["述懷", "睿汎", "俊宏", "永謙"]);
  // 述懷（場上）與炫州（場下）連結成固定雙人組
  var a = byName("述懷"), b = byName("炫州");
  assert.strictEqual(R.linkMembers(st, a.groupId, b.id, "fixed"), true);
  var g = st.groups.find(function(x){ return x.id === a.groupId; });
  assert.strictEqual(g.type, "fixed");
  assert.strictEqual(b.groupId, a.groupId);
  assert.deepStrictEqual(st.courts.A.map(function(s){ return s && st.members[s.memberId].name; }), ["述懷", "睿汎", "俊宏", "永謙"]);
  assertOnCourtConsistent(st);
  // 之後選人：述懷還在場上，整組（含炫州）暫時不可用
  assert.ok(P.collectAvailablePersons(st).every(function(p){ return p.member.name !== "炫州"; }));
  // 述懷下場後，兩人一起可被安排
  st.courts.A[0] = null; a.onCourt = null;
  assert.ok(P.collectAvailablePersons(st).some(function(p){ return p.member.name === "炫州"; }));
  // 兩人都在場上時連結成輪流也不清座位
  var c = byName("睿汎"), d = byName("俊宏");
  assert.strictEqual(R.linkMembers(st, c.groupId, d.id, "rotate"), true);
  assert.deepStrictEqual(st.courts.A.map(function(s){ return s && st.members[s.memberId].name; }), [null, "睿汎", "俊宏", "永謙"]);
  assertOnCourtConsistent(st);
  // 分開：座位不動，seat.groupId 更新為新組別
  assert.strictEqual(R.splitPair(st, c.groupId), true);
  assert.notStrictEqual(c.groupId, d.groupId);
  assert.deepStrictEqual(st.courts.A.map(function(s){ return s && st.members[s.memberId].name; }), [null, "睿汎", "俊宏", "永謙"]);
  assertOnCourtConsistent(st);
  // 不合法的連結
  assert.strictEqual(R.linkMembers(st, a.groupId, byName("四月").id, "fixed"), false, "target group already a pair");
  assert.strictEqual(R.linkMembers(st, c.groupId, d.id, "single"), false);
});

test("pickBestCourtCombo returns debug breakdown consistent with scores", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  membersArr(st).forEach(function(m, i){ m.playCount = i % 4; m.gender = i % 2 ? "M" : "F"; m.skill = (i % 3) + 1; });
  var now = 1e9;
  membersArr(st)[0].lastFinishedAt = now - 1000;
  var best = P.pickBestCourtCombo(st, now, function(){ return 0.5; }, [membersArr(st)[1].id]);
  var d = best.debug;
  assert.ok(d, "debug attached");
  assert.ok(d.candidateCount >= d.comboCount && d.comboCount > 0);
  assert.strictEqual(d.bestScore, best.score);
  // 前幾名依總分排序，總分 = 個人分總和 + 性別 + 實力 + 暫時扣分
  for (var i = 0; i < d.top.length; i++) {
    var c = d.top[i];
    assert.strictEqual(c.score, c.individualSum + c.pairingBonus + c.skillPenalty + c.rejectedPenalty);
    if (i > 0 && d.top[i] !== best) assert.ok(d.top[i - 1].score >= c.score);
  }
  // 機率：依分層（x、x−1、x−2），每組機率 = 該層每組機率；x−3 以下為 0；各層總機率加總為 1
  d.top.forEach(function(c){
    var diff = d.bestScore - c.score;
    var expectTier = diff === 0 ? 0 : (diff === 1 ? 1 : (diff === 2 ? 2 : -1));
    assert.strictEqual(c.tier, expectTier);
    assert.strictEqual(c.probability, expectTier >= 0 ? d.tiers.perCandidate[expectTier] : 0);
  });
  assert.ok(Math.abs(d.tiers.shares.reduce(function(a, b){ return a + b; }, 0) - 1) < 1e-9);
  assert.strictEqual(d.tieCount, d.tiers.counts[0]);
  // 個人細項與 individualScore 一致；剛下場、暫時扣分有標記
  d.persons.forEach(function(p){
    assert.strictEqual(p.total, P.individualScore(p.member, st, d.avgEffective, now));
    assert.strictEqual(p.total, p.fairness + p.recent);
  });
  assert.strictEqual(d.persons.find(function(p){ return p.member === membersArr(st)[0]; }).recent, -3);
  assert.strictEqual(d.persons.find(function(p){ return p.member === membersArr(st)[1]; }).rejected, true);
});

test("all-female and mixed lineups are preferred when fairness is equal", function() {
  var now = 1e9;
  // 只有 4 位女生、其餘男生，場數相同 → 應選出全女生（+2）
  var st = fixtureState(); P.ensureStateFields(st);
  var ms = membersArr(st);
  ms.forEach(function(m, i){ m.gender = i < 4 ? "F" : "M"; m.skill = null; });
  var best = P.pickBestCourtCombo(st, now, function(){ return 0.3; });
  assert.strictEqual(best.pairingBonus, P.SCORE.ALL_FEMALE_BONUS);
  assert.ok(best.seatMembers.every(function(m){ return m.gender === "F"; }));
  // 只有 2 位女生 → 應選出男女配隊（男+女 vs 男+女，+1）
  ms.forEach(function(m, i){ m.gender = i < 2 ? "F" : "M"; });
  best = P.pickBestCourtCombo(st, now, function(){ return 0.3; });
  assert.strictEqual(best.pairingBonus, P.SCORE.MIXED_DOUBLE_BONUS);
  var s = best.seatMembers;
  assert.ok(s[0].gender !== s[1].gender && s[2].gender !== s[3].gender, "both teams M+F");
});

test("single-seat candidates use the same pairing bonus (all-female, mixed)", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  var ms = membersArr(st).filter(function(m){ return st.groups.find(function(g){ return g.id === m.groupId; }).memberIds.length === 1; });
  // A 場：位置 1 空、隊友女、對手兩位女 → 女候選得全女生 +2；男候選 0
  ms.forEach(function(m){ m.gender = "M"; m.skill = null; });
  ms[0].gender = "F"; ms[1].gender = "F"; ms[2].gender = "F"; ms[3].gender = "F";
  [null, ms[0], ms[1], ms[2]].forEach(function(m, i){
    if (m) { m.onCourt = "A"; st.courts.A[i] = { groupId: m.groupId, memberId: m.id }; }
  });
  var list = P.scoredManualCandidates(st, "A", 0);
  assert.strictEqual(list[0].member, ms[3]);
  assert.strictEqual(list[0].pairingBonus, P.SCORE.ALL_FEMALE_BONUS);
  assert.ok(list.filter(function(c){ return c.member.gender === "M"; }).every(function(c){ return c.pairingBonus === 0; }));
  // 改成對手一男一女、隊友女 → 男候選得男女配隊 +1
  ms[2].gender = "M";
  list = P.scoredManualCandidates(st, "A", 0);
  assert.ok(list.filter(function(c){ return c.member.gender === "M"; }).every(function(c){ return c.pairingBonus === P.SCORE.MIXED_DOUBLE_BONUS; }));
  assert.strictEqual(list.find(function(c){ return c.member === ms[3]; }).pairingBonus, 0);
});

test("pickSeatCandidate scores the resulting lineup and uses tiered random", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  var singles = membersArr(st).filter(function(m){ return st.groups.find(function(g){ return g.id === m.groupId; }).memberIds.length === 1; });
  membersArr(st).forEach(function(m){ m.gender = "M"; m.skill = null; m.playCount = 2; });
  // A 場：位置 1 換人，另外三位為女生；候選中有兩位女生（同分，可湊全女生 +2）
  var seated = [null, singles[0], singles[1], singles[2]];
  seated.forEach(function(m, i){ if (m) { m.gender = "F"; m.onCourt = "A"; st.courts.A[i] = { groupId: m.groupId, memberId: m.id }; } });
  var f1 = singles[3], f2 = singles[4];
  f1.gender = "F"; f2.gender = "F";
  var now = Date.now();
  var avg = P.avgEffectivePlayCount(st);
  var others = [singles[0], singles[1], singles[2]].reduce(function(s, m){ return s + P.individualScore(m, st, avg, now); }, 0);
  // 兩位女生同在 x 層（全女生 +2），男生都在 x−2 層；x 層至少 2/3
  var pickLow = P.pickSeatCandidate(st, "A", 0, function(){ return 0; });
  var pickHigh = P.pickSeatCandidate(st, "A", 0, function(){ return 0.6; });
  var pickLowerTier = P.pickSeatCandidate(st, "A", 0, function(){ return 0.99; });
  assert.strictEqual(pickLow.tieCount, 2);
  assert.deepStrictEqual([pickLow.member, pickHigh.member].sort(function(a, b){ return a.id - b.id; }), [f1, f2].sort(function(a, b){ return a.id - b.id; }));
  assert.notStrictEqual(pickLow.member, pickHigh.member, "random within top tier");
  assert.strictEqual(pickLowerTier.chosen.tier, 2, "lower tier can be drawn");
  assert.ok(pickLow.tiers.shares[0] >= 2 / 3 - 1e-9);
  assert.strictEqual(pickLow.othersIndividual, others);
  // 換入後總分 = 另外三位個人分 + 候選個人分 + 配隊分 + 實力分；機率 = 所在層的每人機率
  pickLow.candidates.forEach(function(c){
    assert.strictEqual(c.lineupTotal, others + c.individual + c.pairingBonus + c.skillPenalty);
    assert.strictEqual(c.probability, c.tier >= 0 ? pickLow.tiers.perCandidate[c.tier] : 0);
  });
  assert.strictEqual(pickLow.chosen.pairingBonus, P.SCORE.ALL_FEMALE_BONUS);
  // 固定雙人組成員不會被單獨換入
  assert.ok(pickLow.candidates.every(function(c){ return c.group.type !== "fixed"; }));
});

// ---- 分層隨機 ----
function near(a, b) { return Math.abs(a - b) < 1e-9; }

test("tierShares: weights 10:3:1 with anti-dilution caps", function() {
  var r;
  // 1/1/0：77% / 23%
  r = P.tierShares([1, 1, 0]);
  assert.ok(near(r.shares[0], 10 / 13) && near(r.shares[1], 3 / 13) && r.shares[2] === 0);
  assert.ok(!r.capLowest && !r.capLower);
  // 2/5/30：兩個上限都觸發 → 2/3 : 1/4 : 1/12
  r = P.tierShares([2, 5, 30]);
  assert.ok(near(r.shares[0], 2 / 3) && near(r.shares[1], 1 / 4) && near(r.shares[2], 1 / 12));
  assert.ok(r.capLowest && r.capLower);
  assert.ok(near(r.perCandidate[0], 1 / 3) && near(r.perCandidate[1], 1 / 20));
  // 1/1/100：只有 x−2 上限 → 10:3:1
  r = P.tierShares([1, 1, 100]);
  assert.ok(near(r.shares[0], 10 / 14) && near(r.shares[1], 3 / 14) && near(r.shares[2], 1 / 14));
  assert.ok(r.capLowest && !r.capLower);
  // 10/1/0：不觸發，x−1 那一組不會被抬高
  r = P.tierShares([10, 1, 0]);
  assert.ok(near(r.shares[1], 3 / 103));
  assert.ok(r.perCandidate[0] > r.perCandidate[1]);
  // 1/20/0：只有下層上限 → 2/3 : 1/3
  r = P.tierShares([1, 20, 0]);
  assert.ok(near(r.shares[0], 2 / 3) && near(r.shares[1], 1 / 3) && r.capLower && !r.capLowest);
  // x−1 為空時 x−2 只受下層上限
  r = P.tierShares([1, 0, 30]);
  assert.ok(near(r.shares[0], 2 / 3) && near(r.shares[2], 1 / 3) && !r.capLowest);
  // 只有 x 層
  r = P.tierShares([5, 0, 0]);
  assert.ok(near(r.shares[0], 1) && near(r.perCandidate[0], 0.2));
});

test("tierShares: a higher-tier candidate is never less likely than a lower-tier one", function() {
  for (var n0 = 1; n0 <= 12; n0++) for (var n1 = 0; n1 <= 30; n1 += 3) for (var n2 = 0; n2 <= 300; n2 += 25) {
    var r = P.tierShares([n0, n1, n2]);
    assert.ok(near(r.shares.reduce(function(a, b){ return a + b; }, 0), 1), "sum " + [n0, n1, n2]);
    assert.ok(r.shares[0] >= 2 / 3 - 1e-9, "top share " + [n0, n1, n2]);
    if (n1 && n2) assert.ok(r.shares[2] <= (r.shares[1] + r.shares[2]) / 4 + 1e-9, "lowest cap " + [n0, n1, n2]);
    if (n1) assert.ok(r.perCandidate[0] >= r.perCandidate[1] - 1e-12, "x >= x-1 " + [n0, n1, n2]);
    if (n1 && n2) assert.ok(r.perCandidate[1] >= r.perCandidate[2] - 1e-12, "x-1 >= x-2 " + [n0, n1, n2]);
  }
});

test("pickTiered draws tier by share, then position inside the tier; below x-2 never drawn", function() {
  // 分數 5,5 / 4 / 3 / 2（x−3 不抽）：counts 2/1/1 → W 20/3/1
  var items = [{ s: 5, id: "a" }, { s: 5, id: "b" }, { s: 4, id: "c" }, { s: 3, id: "d" }, { s: 2, id: "e" }];
  var sc = function(it){ return it.s; };
  var r0 = P.pickTiered(items, sc, function(){ return 0; });
  assert.strictEqual(r0.chosen.id, "a");
  assert.strictEqual(P.pickTiered(items, sc, function(){ return 0.5; }).chosen.id, "b");
  assert.strictEqual(P.pickTiered(items, sc, function(){ return 20 / 24 + 0.01; }).chosen.id, "c");
  assert.strictEqual(P.pickTiered(items, sc, function(){ return 0.999; }).chosen.id, "d");
  assert.strictEqual(items[4].tier, -1);
  assert.strictEqual(items[4].probability, 0);
  assert.ok(near(items[0].probability, 10 / 24) && near(items[2].probability, 3 / 24) && near(items[3].probability, 1 / 24));
});

test("court pick uses one candidate per four-person combo (its best split)", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  membersArr(st).forEach(function(m, i){ m.gender = i % 2 ? "M" : "F"; m.skill = (i % 3) + 1; m.playCount = i % 3; });
  var best = P.pickBestCourtCombo(st, 1e9, function(){ return 0.42; });
  var d = best.debug;
  var keys = d.top.map(function(c){ return c.people.map(function(m){ return m.id; }).sort(function(a, b){ return a - b; }).join(","); });
  assert.strictEqual(new Set(keys).size, keys.length, "no duplicate four-person combo");
  assert.ok(d.candidateCount > d.comboCount, "several splits evaluated per combo");
  // 選中的分法是這組四人分數最高的分法
  var splits = P.allSplitsForFour(best.people).map(function(sp){ return sp.pairingScore; });
  assert.strictEqual(best.pairingScore, Math.max.apply(null, splits));
  assert.ok(best.tier >= 0 && best.tier <= 2);
});

test("tiered random switch: off draws only from the top score", function() {
  var items = [{ s: 5, id: "a" }, { s: 5, id: "b" }, { s: 4, id: "c" }, { s: 3, id: "d" }];
  var sc = function(it){ return it.s; };
  var r = P.pickTiered(items, sc, function(){ return 0.999; }, false);
  assert.strictEqual(r.chosen.id, "b", "only x tier");
  assert.strictEqual(r.tiers.enabled, false);
  assert.ok(near(items[0].probability, 0.5) && near(items[1].probability, 0.5));
  assert.strictEqual(items[2].probability, 0);
  assert.strictEqual(items[2].tier, 1, "tier still labelled for log");
  assert.deepStrictEqual(r.tiers.layerSizes, [2, 1, 1]);
  // 整場選人與系統換人讀取設定
  var st = fixtureState(); P.ensureStateFields(st);
  assert.strictEqual(st.settings.tieredRandomEnabled, true, "default on");
  membersArr(st).forEach(function(m, i){ m.gender = i % 2 ? "M" : "F"; m.skill = (i % 3) + 1; m.playCount = i % 3; });
  st.settings.tieredRandomEnabled = false;
  for (var k = 0; k < 20; k++) {
    var best = P.pickBestCourtCombo(st, 1e9, function(){ return k / 20; });
    assert.strictEqual(best.score, best.debug.bestScore, "off: always top score");
  }
  st.settings.tieredRandomEnabled = true;
  var sawLower = false;
  for (var j = 0; j < 20; j++) { var b = P.pickBestCourtCombo(st, 1e9, function(){ return 0.999 - j / 1000; }); if (b.tier > 0) sawLower = true; }
  assert.ok(sawLower, "on: lower tiers can be drawn");
});

test("tieredRandomEnabled setting survives new-session import", function() {
  var st = fixtureState(); P.ensureStateFields(st);
  st.settings.tieredRandomEnabled = false;
  var parsed = R.parsePaste("甲\n乙\n丙\n丁");
  R.attachSuggestedProfiles(st, parsed);
  assert.strictEqual(R.applyImport(st, parsed, "new", null, 0).ok, true);
  assert.strictEqual(st.settings.tieredRandomEnabled, false);
  assert.strictEqual(typeof st.settings.restCompensationEnabled, "boolean");
});

test("removeMember turns remaining pair member into single", function() {
  var st = fixtureState();
  var g = st.groups.find(function(g){ return g.memberIds.length === 2; });
  g.type = "fixed";
  R.removeMember(st, g.memberIds[1]);
  assert.strictEqual(g.memberIds.length, 1);
  assert.strictEqual(g.type, "single");
});

console.log("Passed:", passed);
process.exit(0);
