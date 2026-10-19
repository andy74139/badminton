(function (global) {
  "use strict";

  // 所有分數常數集中在這裡，方便測試後調整。
  var SCORE = {
    MUCH_BELOW_AVERAGE: 4,
    BELOW_AVERAGE: 2,
    ABOVE_AVERAGE: -2,
    MUCH_ABOVE_AVERAGE: -4,
    RECENT_FINISH_PENALTY: -3,
    RECENT_FINISH_MS: 120000,
    REJECTED_PERSON_PENALTY: -100,
    ALL_FEMALE_BONUS: 2,
    MIXED_DOUBLE_BONUS: 1,
    SKILL_DIFF_0_OR_1: 0,
    SKILL_DIFF_2: -2,
    SKILL_DIFF_3_OR_MORE: -5,
    REST_CREDIT_STEP: 0.5,
    REST_CREDIT_PER_STEP: 0.5,
    MIN_REST_AVERAGE_BASELINE: 1
  };

  function nowMs() { return Date.now(); }

  function avgActualPlayCount(state) {
    var members = Object.keys(state.members || {}).map(function (id) { return state.members[id]; })
      .filter(function (m) { return m && String(m.name || "").trim() !== "" && !m.resting; });
    if (!members.length) return 0;
    var sum = members.reduce(function (s, m) { return s + (m.playCount || 0); }, 0);
    return sum / members.length;
  }

  function activeRestCredit(member, avgActual, enabled) {
    if (!enabled || !member || !member.resting || member.restStartAverage == null) return 0;
    var baseline = Math.max(member.restStartAverage, SCORE.MIN_REST_AVERAGE_BASELINE);
    var growth = Math.max(0, avgActual - baseline);
    var steps = Math.floor((growth + 1e-9) / SCORE.REST_CREDIT_STEP);
    return steps * SCORE.REST_CREDIT_PER_STEP;
  }

  function effectivePlayCount(member, state) {
    if (!member) return 0;
    var enabled = !!(state && state.settings && state.settings.restCompensationEnabled);
    // 只有在開啟不打場數時，才將不打場數次數計入個人有效場數。
    if (!enabled) return (member.playCount || 0);
    return (member.playCount || 0) + (member.restCreditTotal || 0)
      + activeRestCredit(member, avgActualPlayCount(state), enabled);
  }

  function avgEffectivePlayCount(state) {
    var members = Object.keys(state.members || {}).map(function (id) { return state.members[id]; })
      .filter(function (m) { return m && String(m.name || "").trim() !== "" && !m.resting; });
    if (!members.length) return 0;
    var sum = members.reduce(function (s, m) { return s + effectivePlayCount(m, state); }, 0);
    return sum / members.length;
  }

  // 個人公平分數
  function individualScore(member, state, avgEff, now) {
    var avg = (avgEff === undefined || avgEff === null) ? avgEffectivePlayCount(state) : avgEff;
    var count = effectivePlayCount(member, state);
    var fairnessScore;
    if (count < avg - 1) {
      fairnessScore = SCORE.MUCH_BELOW_AVERAGE;
    } else if (count < avg - 0.5) {
      fairnessScore = SCORE.BELOW_AVERAGE;
    } else if (count > avg + 1) {
      fairnessScore = SCORE.MUCH_ABOVE_AVERAGE;
    } else if (count > avg + 0.5) {
      fairnessScore = SCORE.ABOVE_AVERAGE;
    } else {
      fairnessScore = 0;
    }
    var t = (now === undefined || now === null) ? nowMs() : now;
    var recentlyFinished = member.lastFinishedAt != null
      && (t - member.lastFinishedAt >= 0)
      && (t - member.lastFinishedAt < SCORE.RECENT_FINISH_MS);
    return fairnessScore + (recentlyFinished ? SCORE.RECENT_FINISH_PENALTY : 0);
  }

  var PAIRINGS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];

  // 性別加分（依 split）
  function genderBonusForSplit(people, split) {
    // people: 4 members; split: [[i,i],[i,i]]
    var allKnown = people.every(function (p) { return p.gender === "M" || p.gender === "F"; });
    if (!allKnown) return 0;
    if (people.every(function (p) { return p.gender === "F"; })) return SCORE.ALL_FEMALE_BONUS;
    var fCount = people.filter(function (p) { return p.gender === "F"; }).length;
    var mCount = people.filter(function (p) { return p.gender === "M"; }).length;
    if (!(mCount === 2 && fCount === 2)) return 0;
    // 混雙：兩隊各自一男一女
    function mixed(teamIdx) {
      var a = people[split[teamIdx][0]], b = people[split[teamIdx][1]];
      return a.gender !== b.gender;
    }
    if (mixed(0) && mixed(1)) return SCORE.MIXED_DOUBLE_BONUS;
    return 0;
  }

  function skillPenaltyForSplit(people, split) {
    var allSkillKnown = people.every(function (p) { return p.skill === 1 || p.skill === 2 || p.skill === 3; });
    if (!allSkillKnown) return 0;
    var teamA = people[split[0][0]].skill + people[split[0][1]].skill;
    var teamB = people[split[1][0]].skill + people[split[1][1]].skill;
    var diff = Math.abs(teamA - teamB);
    if (diff <= 1) return SCORE.SKILL_DIFF_0_OR_1;
    if (diff === 2) return SCORE.SKILL_DIFF_2;
    return SCORE.SKILL_DIFF_3_OR_MORE;
  }

  function pairingScoreForSplit(people, split) {
    return genderBonusForSplit(people, split) + skillPenaltyForSplit(people, split);
  }

  // 最佳拆分：回傳 { split, pairingScore, seatMembers (依 teamA+teamB 順序) }
  function bestSplitForFour(people, rng) {
    rng = (typeof rng === "function") ? rng : Math.random;
    var bestScore = -Infinity;
    var candidates = [];
    PAIRINGS.forEach(function (split) {
      var s = pairingScoreForSplit(people, split);
      if (s > bestScore) {
        bestScore = s;
        candidates = [split];
      } else if (s === bestScore) {
        candidates.push(split);
      }
    });
    // 在所有 split 中取 max；上面只在 > 時重設，= 時累積；但需包含所有 max
    // 重新計算 robustly：
    var maxS = -Infinity;
    PAIRINGS.forEach(function (split) {
      var s = pairingScoreForSplit(people, split);
      if (s > maxS) maxS = s;
    });
    var maxCands = PAIRINGS.filter(function (split) { return pairingScoreForSplit(people, split) === maxS; });
    var chosen = maxCands[Math.floor(rng() * maxCands.length)];
    var orderIndices = chosen[0].concat(chosen[1]);
    var seatMembers = orderIndices.map(function (i) { return people[i]; });
    return { split: chosen, pairingScore: maxS, seatMembers: seatMembers };
  }

  // 組合列舉
  function collectAvailablePersons(state) {
    var availGroups = (global.Roster && global.Roster.availableGroups) ? global.Roster.availableGroups(state) : null;
    if (!availGroups) {
      // fallback 簡易
      availGroups = [];
    }
    var persons = [];
    availGroups.forEach(function (g) {
      (g.memberIds || []).forEach(function (mid) {
        var m = state.members[mid];
        if (!m) return;
        if (String(m.name || "").trim() === "") return;
        if (m.resting) return;
        if (m.onCourt !== null && m.onCourt !== undefined) return;
        persons.push({ member: m, groupId: g.id });
      });
    });
    return persons;
  }

  function combinationsIndices(n, k) {
    var out = [];
    var idx = [];
    function rec(start, depth) {
      if (depth === k) { out.push(idx.slice()); return; }
      for (var i = start; i < n; i++) {
        idx.push(i);
        rec(i + 1, depth + 1);
        idx.pop();
      }
    }
    rec(0, 0);
    return out;
  }

  function pickBestCourtCombo(state, now, rng, rejectedIds) {
    if (typeof rng !== "function") rng = Math.random;
    if (!Array.isArray(rejectedIds)) rejectedIds = [];
    var persons = collectAvailablePersons(state);
    // 至少 4 個不同組
    var groups = {};
    persons.forEach(function (p) { groups[p.groupId] = true; });
    if (Object.keys(groups).length < 4) return null;

    var avgEff = avgEffectivePlayCount(state);
    var t = (now === undefined || now === null) ? nowMs() : now;
    var combos = combinationsIndices(persons.length, 4);
    var bestScore = -Infinity;
    var bestCombos = [];
    combos.forEach(function (ci) {
      var four = ci.map(function (i) { return persons[i]; });
      // group distinct
      var gset = {};
      var distinct = true;
      four.forEach(function (p) {
        if (gset[p.groupId]) distinct = false;
        gset[p.groupId] = true;
      });
      if (!distinct) return;
      var people = four.map(function (p) { return p.member; });
      var sumInd = people.reduce(function (s, m) { return s + individualScore(m, state, avgEff, t); }, 0);
      var bsplit = bestSplitForFour(people, rng);
      var rejectedPenalty = people.reduce(function (s, m) { return s + (rejectedIds.indexOf(m.id) !== -1 ? SCORE.REJECTED_PERSON_PENALTY : 0); }, 0);
      var total = sumInd + bsplit.pairingScore + rejectedPenalty;
      var rec = { persons: four, people: people, seatMembers: bsplit.seatMembers, pairingScore: bsplit.pairingScore, split: bsplit.split, score: total, rand: rng() };
      if (total > bestScore) {
        bestScore = total;
        bestCombos = [rec];
      } else if (total === bestScore) {
        bestCombos.push(rec);
      }
    });
    if (!bestCombos.length) return null;
    var chosen = bestCombos[Math.floor(rng() * bestCombos.length)];
    return chosen;
  }

  // 切換臨時不打：處理補償結算／建立基準
  function ensureMemberFields(m) {
    if (!m) return m;
    if (m.gender === undefined) m.gender = null;
    if (m.skill === undefined) m.skill = null;
    if (m.resting !== true) m.resting = false;
    if (m.playCount === undefined || m.playCount === null) m.playCount = 0;
    if (m.lastFinishedAt === undefined) m.lastFinishedAt = null;
    if (m.restCreditTotal === undefined || m.restCreditTotal === null) m.restCreditTotal = 0;
    if (m.restStartAverage === undefined) m.restStartAverage = null;
    if (m.onCourt === undefined) m.onCourt = null;
    return m;
  }
  function setResting(state, memberId, resting, now) {
    var m = state.members[memberId];
    if (!m) return;
    ensureMemberFields(m);
    var enabled = !!(state.settings && state.settings.restCompensationEnabled);
    if (resting) {
      if (m.resting) return;
      m.resting = true;
      if (enabled) {
        m.restStartAverage = Math.max(avgActualPlayCount(state), SCORE.MIN_REST_AVERAGE_BASELINE);
      } else {
        m.restStartAverage = null;
      }
    } else {
      if (!m.resting) return;
      if (enabled && m.restStartAverage != null) {
        var credit = activeRestCredit(m, avgActualPlayCount(state), true);
        m.restCreditTotal = (m.restCreditTotal || 0) + credit;
      }
      m.restStartAverage = null;
      m.resting = false;
    }
  }

  function toggleResting(state, memberId) {
    var m = state.members[memberId];
    if (!m) return;
    setResting(state, memberId, !m.resting);
  }

  function setRestCompensationEnabled(state, enabled) {
    ensureStateFields(state);
    var was = state.settings.restCompensationEnabled;
    state.settings.restCompensationEnabled = !!enabled;
    if (was === enabled) return;
    var avg = avgActualPlayCount(state);
    if (!enabled) {
      // 關閉：結算目前 reached 補償到 restCreditTotal，清空基準
      Object.keys(state.members).forEach(function (id) {
        var m = state.members[id];
        if (!m || !m.resting || m.restStartAverage == null) return;
        var credit = activeRestCredit(m, avg, true);
        m.restCreditTotal = (m.restCreditTotal || 0) + credit;
        m.restStartAverage = null;
      });
    } else {
      // 開啟：為仍在休息且無基準者建立新基準
      Object.keys(state.members).forEach(function (id) {
        var m = state.members[id];
        if (!m || !m.resting) return;
        if (m.restStartAverage == null) {
          m.restStartAverage = Math.max(avgActualPlayCount(state), SCORE.MIN_REST_AVERAGE_BASELINE);
        }
      });
    }
  }

  function ensureStateFields(state) {
    if (!state) return state;
    if (!state.settings) state.settings = { restCompensationEnabled: true };
    if (typeof state.settings.restCompensationEnabled !== "boolean") state.settings.restCompensationEnabled = true;
    Object.keys(state.members || {}).forEach(function (id) {
      var m = state.members[id];
      if (!m) return;
      if (m.gender === undefined) m.gender = null;
      if (m.skill === undefined) m.skill = null;
      if (m.resting !== true) m.resting = false;
      if (m.playCount === undefined || m.playCount === null) m.playCount = 0;
      if (m.lastFinishedAt === undefined) m.lastFinishedAt = null;
      if (m.restCreditTotal === undefined || m.restCreditTotal === null) m.restCreditTotal = 0;
      if (m.restStartAverage === undefined) m.restStartAverage = null;
      if (m.onCourt === undefined) m.onCourt = null;
    });
    return state;
  }

  // 統計顯示輔助：有效場數
  function displayStats(state) {
    var enabled = !!(state.settings && state.settings.restCompensationEnabled);
    return Object.keys(state.members || {}).map(function (id) {
      var m = state.members[id];
      if (!m || String(m.name || "").trim() === "") return null;
      return {
        id: m.id, name: m.name,
        actual: m.playCount || 0,
        effective: effectivePlayCount(m, state),
        restCredit: (m.restCreditTotal || 0) + (enabled && m.resting ? activeRestCredit(m, avgActualPlayCount(state), true) : 0)
      };
    }).filter(Boolean);
  }

  function memberHasName(m) { return !!(m && String(m.name || "").trim() !== ""); }

  // 為了避免循環相依：Roster 可能在 pairing 之後載入，collectAvailablePersons 使用 global.Roster
  function scoredManualCandidates(state, court, seatIndex) {
    // 回傳候選 list：{member, group, score} 依總分排序
    var seat = state.courts[court][seatIndex];
    var outgoingGroupId = seat ? seat.groupId : null;
    var teammateIndex = seatIndex % 2 === 0 ? seatIndex + 1 : seatIndex - 1;
    var oppIndexes = seatIndex < 2 ? [2, 3] : [0, 1];
    var teammateSeat = state.courts[court][teammateIndex];
    var opp1Seat = state.courts[court][oppIndexes[0]];
    var opp2Seat = state.courts[court][oppIndexes[1]];
    var teammate = teammateSeat ? state.members[teammateSeat.memberId] : null;
    var opp1 = opp1Seat ? state.members[opp1Seat.memberId] : null;
    var opp2 = opp2Seat ? state.members[opp2Seat.memberId] : null;

    var availGroups = (global.Roster && global.Roster.availableGroups) ? global.Roster.availableGroups(state) : [];
    var list = [];
    availGroups.forEach(function (g) {
      if (g.id === outgoingGroupId) return;
      (g.memberIds || []).forEach(function (mid) {
        var candidate = state.members[mid];
        if (!candidate || candidate.resting) return;
        if (String(candidate.name || "").trim() === "") return;
        if (candidate.onCourt !== null && candidate.onCourt !== undefined) return;
        var score = 0;
        var reasons = [];
        if (teammate && opp1 && opp2) {
          var four = [teammate, candidate, opp1, opp2];
          var genderKnown = four.every(function (p) { return p.gender === "M" || p.gender === "F"; });
          var gBonus = 0;
          if (genderKnown) {
            if (four.every(function (p) { return p.gender === "F"; })) gBonus = SCORE.ALL_FEMALE_BONUS;
            else {
              var mC = four.filter(function (p) { return p.gender === "M"; }).length;
              var fC = four.filter(function (p) { return p.gender === "F"; }).length;
              if (mC === 2 && fC === 2) {
                var split = [[0, 1], [2, 3]]; // approximate original seats: teammate+candidate vs opps? 
                // Use actual: teamA = seats 0,1 (teammate,candidate) teamB = opp1,opp2
                var teamMixed = (teammate.gender !== candidate.gender) && (opp1.gender !== opp2.gender);
                if (teamMixed) gBonus = SCORE.MIXED_DOUBLE_BONUS;
              }
            }
          }
          var sPen = 0;
          var skillKnown = four.every(function (p) { return p.skill === 1 || p.skill === 2 || p.skill === 3; });
          if (skillKnown) {
            var diff = Math.abs((teammate.skill + candidate.skill) - (opp1.skill + opp2.skill));
            if (diff === 2) sPen = SCORE.SKILL_DIFF_2;
            else if (diff >= 3) sPen = SCORE.SKILL_DIFF_3_OR_MORE;
          }
          score = gBonus + sPen;
        }
        var ind = individualScore(candidate, state, avgEffectivePlayCount(state), nowMs());
        var total = ind + score;
        list.push({ member: candidate, group: g, individual: ind, pairing: score, total: total });
      });
    });
    // sort total desc, tie by name
    list.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return a.member.name.localeCompare(b.member.name, "zh-Hant");
    });
    return list;
  }

  var api = {
    SCORE: SCORE,
    avgActualPlayCount: avgActualPlayCount,
    activeRestCredit: activeRestCredit,
    effectivePlayCount: effectivePlayCount,
    avgEffectivePlayCount: avgEffectivePlayCount,
    individualScore: individualScore,
    PAIRINGS: PAIRINGS,
    genderBonusForSplit: genderBonusForSplit,
    skillPenaltyForSplit: skillPenaltyForSplit,
    pairingScoreForSplit: pairingScoreForSplit,
    bestSplitForFour: bestSplitForFour,
    collectAvailablePersons: collectAvailablePersons,
    combinationsIndices: combinationsIndices,
    pickBestCourtCombo: pickBestCourtCombo,
    scoredManualCandidates: scoredManualCandidates,
    toggleResting: toggleResting,
    setResting: setResting,
    setRestCompensationEnabled: setRestCompensationEnabled,
    ensureStateFields: ensureStateFields,
    displayStats: displayStats,
    memberHasName: memberHasName
  };

  global.Pairing = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);
