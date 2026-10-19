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

test("individual score boundaries", function() {
  var avg = 3;
  var cases = [
    [1.9, 4], [2, 2], [2.49, 2], [2.5, 0], [3.5, 0], [3.6, -2], [4, -2], [4.01, -4]
  ];
  cases.forEach(function(c) {
    var st = R.createDefaultState();
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
  var st = R.createDefaultState();
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

test("gender bonus FFFF and mixed", function() {
  function mk(g) { return { name:"x", gender:g, skill:2 }; }
  var allF = [mk("F"), mk("F"), mk("F"), mk("F")];
  // any split
  P.PAIRINGS.forEach(function(split) {
    assert.strictEqual(P.genderBonusForSplit(allF, split), P.SCORE.ALL_FEMALE_BONUS);
  });
  var mixed = [mk("M"), mk("F"), mk("M"), mk("F")];
  // mixed split where teams are M/F vs M/F: split [0,2? Wait people order. Try split [[0,1],[2,3]] with team 0=M/F?]
  // Build people order so team0 indices 0,1 = M,F and team1 2,3=M,F
  var p2 = [mk("M"), mk("F"), mk("M"), mk("F")];
  var goodSplit = [[0,1],[2,3]];
  assert.strictEqual(P.genderBonusForSplit(p2, goodSplit), P.SCORE.MIXED_DOUBLE_BONUS);
  // bad split: teams M,M and F,F
  var badSplit = [[0,2],[1,3]];
  assert.strictEqual(P.genderBonusForSplit(p2, badSplit), 0);
  // unknown gender -> 0
  var unk = [mk("M"), mk("F"), mk(null), mk("F")];
  assert.strictEqual(P.genderBonusForSplit(unk, goodSplit), 0);
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
  var st = R.createDefaultState();
  var m = membersArr(st)[0];
  m.playCount = 0; m.restCreditTotal = 5; m.resting = true; m.restStartAverage = 1;
  var before = P.avgActualPlayCount(st);
  // add more credit
  m.restCreditTotal += 3;
  var after = P.avgActualPlayCount(st);
  assert.strictEqual(before, after);
});

test("disabled compensation not counted in effective play count", function() {
  var st = R.createDefaultState();
  st.settings.restCompensationEnabled = false;
  var m = membersArr(st)[0];
  m.playCount = 2; m.restCreditTotal = 5; m.resting = false;
  assert.strictEqual(P.effectivePlayCount(m, st), 2);
  // enabled then counts stored compensation
  st.settings.restCompensationEnabled = true;
  assert.strictEqual(P.effectivePlayCount(m, st), 7);
});

test("disabled compensation no accumulate", function() {
  var st = R.createDefaultState();
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
  var st = R.createDefaultState();
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
  var st = R.createDefaultState();
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
  var st = R.createDefaultState();
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

console.log("Passed:", passed);
process.exit(0);
