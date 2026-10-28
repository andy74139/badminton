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
    MIN_REST_AVERAGE_BASELINE: 1,
    // 統計區「優先↑／優先↓」每按一次調整的不打場數
    MANUAL_PRIORITY_STEP: 0.5,
    // 分層隨機（整場選人、系統換人、補位共用）：x = 最高分
    //  每組候選的權重依「與最高分的差距」：x、x−1、x−2 分別 10、3、1（陣列長度即範圍，x−3 以下不抽）
    //  範圍 2 分 < 剛下場扣分 3 分：剛下場的人不會因隨機勝過條件相同、沒剛下場的人；加大範圍時要一起檢查。
    RANDOM_TIER_WEIGHTS: [10, 3, 1],
    // 防稀釋上限：x−2 層最多佔下兩層（x−1 + x−2）的 1/4；下兩層合計最多 1/3（即 x 層至少 2/3）
    RANDOM_LOWEST_MAX_SHARE_OF_LOWER: 1 / 4,
    RANDOM_LOWER_MAX_SHARE: 1 / 3
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
    return individualScoreDetail(member, state, avgEff, now).total;
  }

  // 個人分數細項（配隊 log 也用這份，確保顯示與實際評分一致）：
  // { effective 有效場數, diff 與平均差, fairness 公平分, recent 剛下場扣分, sinceFinishMs 距下場毫秒, total }
  function individualScoreDetail(member, state, avgEff, now) {
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
    var since = member.lastFinishedAt != null ? t - member.lastFinishedAt : null;
    var recentlyFinished = since != null && since >= 0 && since < SCORE.RECENT_FINISH_MS;
    var recent = recentlyFinished ? SCORE.RECENT_FINISH_PENALTY : 0;
    return { effective: count, diff: count - avg, fairness: fairnessScore, recent: recent, sinceFinishMs: since, total: fairnessScore + recent };
  }

  var PAIRINGS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];

  // 配隊分（依 split）：優先安排這兩種組合
  //  - 全女生（四人都是女）：+ALL_FEMALE_BONUS，任何分隊方式都成立
  //  - 男女配隊（男+女 vs 男+女）：+MIXED_DOUBLE_BONUS，必須兩隊各一男一女
  //  任何一人性別未設定 → 0。整場選人與單一位置選人都用這個函式。
  function pairingBonusForSplit(people, split) {
    // people: 4 members; split: [[i,i],[i,i]]
    var allKnown = people.every(function (p) { return p.gender === "M" || p.gender === "F"; });
    if (!allKnown) return 0;
    if (people.every(function (p) { return p.gender === "F"; })) return SCORE.ALL_FEMALE_BONUS;
    var fCount = people.filter(function (p) { return p.gender === "F"; }).length;
    var mCount = people.filter(function (p) { return p.gender === "M"; }).length;
    if (!(mCount === 2 && fCount === 2)) return 0;
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

  // 分隊分數 = 配隊分 + 實力分
  function pairingScoreForSplit(people, split) {
    return pairingBonusForSplit(people, split) + skillPenaltyForSplit(people, split);
  }

  // 所有分組：回傳所有合規的分組及分數
  function allSplitsForFour(people) {
    var out = [];
    PAIRINGS.forEach(function (split) {
      var s = pairingScoreForSplit(people, split);
      var orderIndices = split[0].concat(split[1]);
      var seatMembers = orderIndices.map(function (i) { return people[i]; });
      out.push({ split: split, pairingScore: s, seatMembers: seatMembers });
    });
    return out;
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

  // ---- 分層隨機 ----
  // 依與最高分 x 的差距分層：差距 0 → 第 0 層（x）、(0, 1] → 第 1 層（x−1）、(1, 2] → 第 2 層（x−2），更低不抽。
  function tierOfScore(score, best) {
    var diff = best - score;
    var maxTier = SCORE.RANDOM_TIER_WEIGHTS.length - 1;
    for (var k = 0; k <= maxTier; k++) { if (diff <= k + 1e-9) return k; }
    return -1;
  }

  // 各層總機率。counts[k] = 第 k 層的候選數（第 0 層至少 1 個）。
  //  1. 原始權重 W_k = counts[k] × RANDOM_TIER_WEIGHTS[k]
  //  2. 第 1 層有候選時，第 2 層最多佔第 1、2 層合計的 RANDOM_LOWEST_MAX_SHARE_OF_LOWER（1/4）
  //  3. 第 1、2 層合計最多佔全部的 RANDOM_LOWER_MAX_SHARE（1/3），超過時兩層等比例縮小
  //  只會壓低下層、不會抬高，所以任何一個高分層候選的機率都 ≥ 任何一個低分層候選。
  // 回傳 { counts, shares（各層總機率）, perCandidate（各層每個候選的機率）, capLowest, capLower }
  function tierShares(counts) {
    var w = SCORE.RANDOM_TIER_WEIGHTS;
    var W = w.map(function (wk, k) { return (counts[k] || 0) * wk; });
    var capLowest = false, capLower = false;
    if (W.length > 2 && (counts[1] || 0) > 0) {
      var q = SCORE.RANDOM_LOWEST_MAX_SHARE_OF_LOWER;
      var maxW2 = W[1] * q / (1 - q);
      if (W[2] > maxW2 + 1e-12) { W[2] = maxW2; capLowest = true; }
    }
    var lower = W.slice(1).reduce(function (a, b) { return a + b; }, 0);
    var p = SCORE.RANDOM_LOWER_MAX_SHARE;
    var maxLower = W[0] * p / (1 - p);
    if (lower > maxLower + 1e-12) {
      var f = maxLower / lower;
      for (var k = 1; k < W.length; k++) W[k] *= f;
      capLower = true;
    }
    var sum = W.reduce(function (a, b) { return a + b; }, 0);
    var shares = W.map(function (x) { return sum > 0 ? x / sum : 0; });
    var perCandidate = shares.map(function (s, k) { return counts[k] ? s / counts[k] : 0; });
    return { counts: w.map(function (_, k) { return counts[k] || 0; }), shares: shares, perCandidate: perCandidate, capLowest: capLowest, capLower: capLower };
  }

  // 分層抽籤：items 為候選陣列，scoreOf(item) 取總分。每個 item 會被寫入 tier（−1 表示不抽）與 probability。
  // 只用一次 rng()：先依層總機率選層，再把同一個隨機數換算成層內位置（層內均分）。
  // enabled === false（設定「分層隨機」關閉）時只在最高分 x 中均分隨機，x−1、x−2 機率為 0（tier 仍標示，方便 log 對照）。
  // 回傳 { chosen, best, tiers（tierShares 結果，加 enabled）, draw }
  function pickTiered(items, scoreOf, rng, enabled) {
    if (typeof rng !== "function") rng = Math.random;
    var best = -Infinity;
    items.forEach(function (it) { var s = scoreOf(it); if (s > best) best = s; });
    var layers = SCORE.RANDOM_TIER_WEIGHTS.map(function () { return []; });
    items.forEach(function (it) {
      it.tier = tierOfScore(scoreOf(it), best);
      if (it.tier >= 0) layers[it.tier].push(it);
    });
    var on = enabled !== false;
    var tiers = tierShares(layers.map(function (l, k) { return (on || k === 0) ? l.length : 0; }));
    tiers.enabled = on;
    tiers.layerSizes = layers.map(function (l) { return l.length; });
    items.forEach(function (it) { it.probability = it.tier >= 0 ? tiers.perCandidate[it.tier] : 0; });
    var draw = rng();
    var acc = 0, chosen = null;
    for (var k = 0; k < layers.length && !chosen; k++) {
      var share = tiers.shares[k];
      if (!layers[k].length || share <= 0) continue;
      if (draw < acc + share || k === layers.length - 1) {
        var u = Math.min(Math.max((draw - acc) / share, 0), 0.999999999);
        chosen = layers[k][Math.floor(u * layers[k].length)];
      }
      acc += share;
    }
    if (!chosen) chosen = layers[0][layers[0].length - 1];
    return { chosen: chosen, best: best, tiers: tiers, draw: draw };
  }

  // 設定「分層隨機」是否開啟（預設開啟）
  function tieredRandomEnabled(state) {
    return !(state && state.settings && state.settings.tieredRandomEnabled === false);
  }

  function pickBestCourtCombo(state, now, rng, rejectedIds) {
    if (typeof rng !== "function") rng = Math.random;
    if (!Array.isArray(rejectedIds)) rejectedIds = [];
    var persons = collectAvailablePersons(state);
    if (persons.length < 4) return null;

    var avgEff = avgEffectivePlayCount(state);
    var t = (now === undefined || now === null) ? nowMs() : now;
    var combos = combinationsIndices(persons.length, 4);
    // 抽籤單位是「四人組合」：每組四人只用自己總分最高的分法；同分的分法留在 tiedSplits，選中後再均分抽一種。
    var comboCandidates = [];
    var splitsEvaluated = 0;
    for (var comboIdx = 0; comboIdx < combos.length; comboIdx++) {
      var ci = combos[comboIdx];
      var four = ci.map(function (i) { return persons[i]; });
      // 統計這四人來自哪些 group，並檢查：
      //  (1) 非固定組：同一組（例如 rotate 的兩人）不可同時上場
      //  (2) 固定組：只要有人在這四人中，兩人就必須「都」在
      var groupCountInCombo = {};
      var fixedGroupIds = [];
      var distinct = true;
      for (var gchk = 0; gchk < four.length; gchk++) {
        var pchk = four[gchk];
        groupCountInCombo[pchk.groupId] = (groupCountInCombo[pchk.groupId] || 0) + 1;
        if (pchk.groupType === "fixed") {
          if (fixedGroupIds.indexOf(pchk.groupId) === -1) fixedGroupIds.push(pchk.groupId);
        } else if (groupCountInCombo[pchk.groupId] > 1) {
          distinct = false;
        }
      }
      if (!distinct) continue;
      var fixedComplete = true;
      for (var fg = 0; fg < fixedGroupIds.length; fg++) {
        if (groupCountInCombo[fixedGroupIds[fg]] !== 2) { fixedComplete = false; break; }
      }
      if (!fixedComplete) continue;
      // 每組固定雙人組的兩個 member id，供下面檢查「同隊」使用
      var fixedPairMemberIds = fixedGroupIds.map(function (gid) {
        return four.filter(function (p) { return p.groupId === gid; })
                   .map(function (p) { return p.member.id; });
      });
      var fixedPairCountInCombo = fixedPairMemberIds.length;
      var people = four.map(function (p) { return p.member; });
      var sumInd = people.reduce(function (s, m) { return s + individualScore(m, state, avgEff, t); }, 0);
      var allSplits = allSplitsForFour(people);
      if(!allSplits.length) continue;
      var comboBest = null;
      for(var spIdx=0;spIdx<allSplits.length;spIdx++){
        var sp = allSplits[spIdx];
        // 固定雙人組必須在同一隊（seatMembers 的前兩位是一隊、後兩位是另一隊）。
        // 注意：seatMembers 裡是 member 物件，識別欄位是 .id（不是 .memberId）。
        if (fixedPairCountInCombo > 0) {
          var teamOfMember = {};
          for (var sif = 0; sif < sp.seatMembers.length; sif++) {
            teamOfMember[sp.seatMembers[sif].id] = (sif < 2) ? 0 : 1;
          }
          var allFixedSameTeam = true;
          for (var fpi = 0; fpi < fixedPairMemberIds.length; fpi++) {
            if (teamOfMember[fixedPairMemberIds[fpi][0]] !== teamOfMember[fixedPairMemberIds[fpi][1]]) {
              allFixedSameTeam = false;
              break;
            }
          }
          if (!allFixedSameTeam) continue;
        }
        var rp = 0;
        for(var rpi=0;rpi<people.length;rpi++){ if(rejectedIds.indexOf(people[rpi].id) !== -1) rp += SCORE.REJECTED_PERSON_PENALTY; }
        var total = sumInd + sp.pairingScore + rp;
        var rec = {
          persons: four, people: people, seatMembers: sp.seatMembers, pairingScore: sp.pairingScore, split: sp.split, score: total,
          // 細項（給配隊 log）
          individualSum: sumInd, pairingBonus: pairingBonusForSplit(people, sp.split), skillPenalty: skillPenaltyForSplit(people, sp.split), rejectedPenalty: rp
        };
        splitsEvaluated++;
        if (!comboBest || total > comboBest.score) {
          comboBest = rec;
          rec.tiedSplits = [rec];
        } else if (total === comboBest.score) {
          comboBest.tiedSplits.push(rec);
        }
      }
      if (comboBest) comboCandidates.push(comboBest);
    }
    if (!comboCandidates.length) return null;
    var pick = pickTiered(comboCandidates, function (c) { return c.score; }, rng, tieredRandomEnabled(state));
    var comboRec = pick.chosen;
    // 這組四人有多種同分最佳分法時，均分抽一種
    var ties = comboRec.tiedSplits;
    var chosen = ties.length > 1 ? ties[Math.min(ties.length - 1, Math.floor(rng() * ties.length))] : comboRec;
    if (chosen !== comboRec) {
      chosen.tier = comboRec.tier;
      chosen.probability = comboRec.probability;
      chosen.tiedSplits = ties;
      comboCandidates[comboCandidates.indexOf(comboRec)] = chosen;
    }
    chosen.splitProbability = 1 / ties.length;
    chosen.debug = buildPickDebug(state, persons, comboCandidates, splitsEvaluated, pick, chosen, avgEff, t, rejectedIds);
    return chosen;
  }

  // 配隊 log 顯示前幾名候選
  var DEBUG_TOP_N = 30;

  // 整理這次選人的說明資料：可用球友的個人分數細項、前 DEBUG_TOP_N 名四人組合（含層與機率）、各層摘要、統計數字。
  function buildPickDebug(state, persons, comboCandidates, splitsEvaluated, pick, chosen, avgEff, now, rejectedIds) {
    var ranked = comboCandidates.slice().sort(function (a, b) { return b.score - a.score; });
    var top = ranked.slice(0, DEBUG_TOP_N);
    if (top.indexOf(chosen) === -1) top.push(chosen);
    return {
      avgEffective: avgEff,
      avgActual: avgActualPlayCount(state),
      restCompensationEnabled: !!(state.settings && state.settings.restCompensationEnabled),
      candidateCount: splitsEvaluated,
      comboCount: comboCandidates.length,
      bestScore: pick.best,
      tieCount: pick.tiers.counts[0],
      tiers: pick.tiers,
      draw: pick.draw,
      chosen: chosen,
      top: top,
      persons: persons.map(function (p) {
        var d = individualScoreDetail(p.member, state, avgEff, now);
        d.member = p.member;
        d.groupType = p.groupType;
        d.rejected = rejectedIds.indexOf(p.member.id) !== -1;
        return d;
      }).sort(function (a, b) { return b.total - a.total; })
    };
  }

  function collectAvailablePersons(state) {
    var availGroups = (global.Roster && global.Roster.availableGroups) ? global.Roster.availableGroups(state) : [];
    var persons = [];
    availGroups.forEach(function (g) {
      (g.memberIds || []).forEach(function (mid) {
        var m = state.members[mid];
        if (!m) return;
        if (String(m.name || "").trim() === "") return;
        if (m.resting) return;
        if (m.onCourt !== null && m.onCourt !== undefined) return;
        persons.push({
          member: m,
          groupId: g.id,
          groupType: g.type,
          isFixedPair: g.type === "fixed"
        });
      });
    });
    return persons;
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

  // 手動調整優先度：加減「不打場數」（已結算＋目前休息期間已達成的補償）。
  //  steps > 0 → 不打場數增加 → 有效場數變高 → 優先度降低
  //  steps < 0 → 不打場數減少 → 有效場數變低 → 優先度提高
  // 不打場數不低於 0；系統自動給的不打場數（臨時不打補償、新人起始補償）也可以一路扣到 0。
  // 開關關閉時不打場數不計入有效場數，因此不調整。
  function adjustRestCredit(state, memberId, steps) {
    var m = state.members[memberId];
    if (!m || !(state.settings && state.settings.restCompensationEnabled)) return false;
    var active = activeRestCredit(m, avgActualPlayCount(state), true);
    var before = (m.restCreditTotal || 0) + active;
    var next = Math.max(0, before + steps * SCORE.MANUAL_PRIORITY_STEP);
    if (next === before) return false;
    if (active > 0) {
      // 休息中：先把本期已達成的補償結算進已結算不打場數，並把基準往後移同樣的門檻數，
      // 本期補償歸零但保留尚未滿 0.5 的進度，之後照常累積。
      m.restStartAverage = Math.max(m.restStartAverage, SCORE.MIN_REST_AVERAGE_BASELINE)
        + (active / SCORE.REST_CREDIT_PER_STEP) * SCORE.REST_CREDIT_STEP;
    }
    m.restCreditTotal = next;
    return true;
  }

  function ensureStateFields(state) {
    if (!state) return state;
    if (!state.settings) state.settings = { restCompensationEnabled: true };
    if (typeof state.settings.restCompensationEnabled !== "boolean") state.settings.restCompensationEnabled = true;
    if (typeof state.settings.tieredRandomEnabled !== "boolean") state.settings.tieredRandomEnabled = true;
    Object.keys(state.members || {}).forEach(function (id) {
      var m = state.members[id];
      if (!m) return;
      if (m.gender === undefined) m.gender = null;
      if (m.skill === undefined) m.skill = null;
      if (m.resting !== true) m.resting = false;
      if (m.playCount === undefined || m.playCount === null) m.playCount = 0;
      if (m.lastFinishedAt === undefined) m.lastFinishedAt = null;
      if (m.restCreditTotal === undefined || m.restCreditTotal === null) m.restCreditTotal = 0;
      // 不打場數不可為負（舊版手動調整可能存成負數）
      if (m.restCreditTotal < 0) m.restCreditTotal = 0;
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
        var pBonus = 0;
        var sPen = 0;
        if (teammate && opp1 && opp2) {
          // 分隊固定：隊友＋候選 vs 兩位對手，與整場選人用同一套配隊分／實力分
          var four = [teammate, candidate, opp1, opp2];
          var split = [[0, 1], [2, 3]];
          pBonus = pairingBonusForSplit(four, split);
          sPen = skillPenaltyForSplit(four, split);
        }
        var score = pBonus + sPen;
        var detail = individualScoreDetail(candidate, state, avgEffectivePlayCount(state), nowMs());
        var ind = detail.total;
        var total = ind + score;
        list.push({ member: candidate, group: g, individual: ind, pairing: score, total: total,
          detail: detail, pairingBonus: pBonus, skillPenalty: sPen });
      });
    });
    // sort total desc, tie by name
    list.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return a.member.name.localeCompare(b.member.name, "zh-Hant");
    });
    return list;
  }

  // 單一位置選人（「系統換人」、部分空位補位）：用與整場選人相同的配隊演算法評分。
  //  換入後四人總分 = 另外三位的個人分 + 候選的個人分 + 配隊分 + 實力分
  //  （另外三位與分隊固定不動，只換這個位置；有空位時配隊分、實力分為 0）。
  //  與整場選人一樣分層隨機（pickTiered）：換入後總分 x、x−1、x−2 的候選依 10:3:1 加權，並套用防稀釋上限。
  //  排除固定雙人組成員：只換一個位置無法讓固定組兩人一起上場。
  // 回傳 { member, chosen, candidates（依換入後總分排序，含 lineupTotal、tier、probability）, bestScore, tieCount, tiers, draw, othersIndividual }；
  // 沒有人選時回傳 null。
  function pickSeatCandidate(state, court, seatIndex, rng) {
    if (typeof rng !== "function") rng = Math.random;
    var now = nowMs();
    var avgEff = avgEffectivePlayCount(state);
    var othersIndividual = 0;
    (state.courts[court] || []).forEach(function (seat, i) {
      if (i === seatIndex || !seat) return;
      var m = state.members[seat.memberId];
      if (m) othersIndividual += individualScore(m, state, avgEff, now);
    });
    var list = scoredManualCandidates(state, court, seatIndex).filter(function (c) {
      return c.group.type !== "fixed";
    });
    if (!list.length) return null;
    list.forEach(function (c) { c.lineupTotal = othersIndividual + c.total; });
    list.sort(function (a, b) {
      if (b.lineupTotal !== a.lineupTotal) return b.lineupTotal - a.lineupTotal;
      return a.member.name.localeCompare(b.member.name, "zh-Hant");
    });
    var pick = pickTiered(list, function (c) { return c.lineupTotal; }, rng, tieredRandomEnabled(state));
    return {
      member: pick.chosen.member, chosen: pick.chosen, candidates: list, bestScore: pick.best,
      tieCount: pick.tiers.counts[0], tiers: pick.tiers, draw: pick.draw, othersIndividual: othersIndividual
    };
  }

  // 自動補單一空位（刪除人員、匯入後）：與「系統換人」相同，見 pickSeatCandidate。
  function pickFillCandidate(state, court, seatIndex, rng) {
    var pick = pickSeatCandidate(state, court, seatIndex, rng);
    return pick ? pick.member : null;
  }

  var api = {
    SCORE: SCORE,
    avgActualPlayCount: avgActualPlayCount,
    activeRestCredit: activeRestCredit,
    effectivePlayCount: effectivePlayCount,
    avgEffectivePlayCount: avgEffectivePlayCount,
    individualScore: individualScore,
    individualScoreDetail: individualScoreDetail,
    DEBUG_TOP_N: DEBUG_TOP_N,
    PAIRINGS: PAIRINGS,
    pairingBonusForSplit: pairingBonusForSplit,
    skillPenaltyForSplit: skillPenaltyForSplit,
    pairingScoreForSplit: pairingScoreForSplit,
    allSplitsForFour: allSplitsForFour,
    collectAvailablePersons: collectAvailablePersons,
    combinationsIndices: combinationsIndices,
    pickBestCourtCombo: pickBestCourtCombo,
    scoredManualCandidates: scoredManualCandidates,
    pickSeatCandidate: pickSeatCandidate,
    tierOfScore: tierOfScore,
    tierShares: tierShares,
    pickTiered: pickTiered,
    tieredRandomEnabled: tieredRandomEnabled,
    pickFillCandidate: pickFillCandidate,
    toggleResting: toggleResting,
    setResting: setResting,
    setRestCompensationEnabled: setRestCompensationEnabled,
    adjustRestCredit: adjustRestCredit,
    ensureStateFields: ensureStateFields,
    displayStats: displayStats,
    memberHasName: memberHasName
  };

  global.Pairing = api;
  // 調整固定配對座位：確保兩人在同一隊
  global.Pairing = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);