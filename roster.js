(function (global) {
  "use strict";

  var DEFAULT_GROUPS = [
    { id: 1, names: ["俊宏"], type: "single" },
    { id: 2, names: ["皓昕"], type: "single" },
    { id: 3, names: ["翊暄"], type: "single" },
    { id: 4, names: ["詩婷"], type: "single" },
    { id: 5, names: ["楷鵑"], type: "single" },
    { id: 6, names: ["沂蓁"], type: "single" },
    { id: 7, names: ["采音"], type: "single" },
    { id: 8, names: ["廉恩"], type: "single" },
    { id: 9, names: ["四月"], type: "single" },
    { id: 10, names: ["有軒"], type: "single" },
    { id: 11, names: ["永謙"], type: "single" },
    { id: 12, names: ["炫州"], type: "single" },
    { id: 13, names: ["Bebe"], type: "single" },
  ];

  // 姓名正規化：去除前後空白、合併中間多餘空白、英文字母轉小寫；必要時做 NFKC。
  function normalizeName(name) {
    if (name == null) return "";
    var s = String(name).trim();
    try { s = s.normalize("NFKC"); } catch (e) {}
    s = s.replace(/\s+/g, " ").trim();
    return s.toLowerCase();
  }

  function memberHasName(m) {
    return !!(m && String(m.name || "").trim() !== "");
  }

  function availableGroups(state) {
    if (!state || !state.groups) return [];
    return state.groups.filter(function (g) {
      if (!g || !g.memberIds) return false;
      // fixed type: both members must be playable (not resting, not on court, have names)
      if (g.type === "fixed") {
        for (var i = 0; i < g.memberIds.length; i++) {
          var m = state.members[g.memberIds[i]];
          if (!m) return false;
          if (m.onCourt !== null && m.onCourt !== undefined) return false;
          if (String(m.name || "").trim() === "") return false;
          if (m.resting) return false; // both must be non-resting
        }
        return true; // both members are playable
      }
      // single/rotate type: at least one member must be playable
      var hasPlayable = false;
      for (var i = 0; i < g.memberIds.length; i++) {
        var m = state.members[g.memberIds[i]];
        if (!m) return false;
        if (m.onCourt !== null && m.onCourt !== undefined) return false;
        if (String(m.name || "").trim() === "") return false;
        if (!m.resting) hasPlayable = true;
      }
      return hasPlayable;
    });
  }

  function groupAvailable(state, g) {
    return availableGroups(state).indexOf(g) !== -1;
  }

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

  function ensureStateFields(state) {
    if (!state) return state;
    if (!state.settings) state.settings = { restCompensationEnabled: true };
    if (typeof state.settings.restCompensationEnabled !== "boolean") state.settings.restCompensationEnabled = true;
    if (!state.profiles || typeof state.profiles !== "object") state.profiles = {};
    if (!state.pending) state.pending = { A: false, B: false, C: false };
    if (!state.courts) state.courts = { A: [null, null, null, null], B: [null, null, null, null], C: [null, null, null, null] };
    if (state.courtCount !== 1 && state.courtCount !== 2 && state.courtCount !== 3) state.courtCount = 3;
    if (state.nextGroupId === undefined) state.nextGroupId = state.groups ? state.groups.length + 1 : 1;
    if (state.nextMemberId === undefined) state.nextMemberId = 1;
    if (state.schemaVersion === undefined) state.schemaVersion = 3;
    // Ensure type field exists for each group
    if (state.groups) {
      state.groups.forEach(function (g) {
        if (!g.type) g.type = "single";
      });
    }
    Object.keys(state.members || {}).forEach(function (id) {
      ensureMemberFields(state.members[id]);
    });
    return state;
  }

  function createDefaultState() {
    var groups = [];
    var members = {};
    var groupCounts = {};
    var seq = 1;
    DEFAULT_GROUPS.forEach(function (g) {
      var memberIds = g.names.map(function (n) {
        var id = seq++;
        members[id] = {
          id: id, name: n, groupId: g.id, playCount: 0, onCourt: null,
          gender: null, skill: null, resting: false, lastFinishedAt: null,
          restCreditTotal: 0, restStartAverage: null
        };
        return id;
      });
      groups.push({ id: g.id, memberIds: memberIds, type: g.type || "single" });
      groupCounts[g.id] = 0;
    });
    return ensureStateFields({
      schemaVersion: 3,
      nextGroupId: 17,
      nextMemberId: seq,
      groups: groups,
      members: members,
      groupCounts: groupCounts,
      courts: { A: [null, null, null, null], B: [null, null, null, null], C: [null, null, null, null] },
      pending: { A: false, B: false, C: false },
      courtCount: 3,
      started: false,
      settings: { restCompensationEnabled: true },
      profiles: {}
    });
  }

  // 從現有 members 建立 profiles（唯讀副本，不覆蓋已存在的 profile）
  function buildProfilesFromMembers(state) {
    var profiles = state.profiles ? Object.assign({}, state.profiles) : {};
    Object.keys(state.members || {}).forEach(function (id) {
      var m = state.members[id];
      if (!memberHasName(m)) return;
      var key = normalizeName(m.name);
      if (!profiles[key]) {
        profiles[key] = { name: m.name.trim(), gender: m.gender, skill: m.skill };
      }
    });
    return profiles;
  }

  function ensureProfiles(state) {
    ensureStateFields(state);
    if (!state.profiles || Object.keys(state.profiles).length === 0) {
      state.profiles = buildProfilesFromMembers(state);
    } else {
      // 補上 members 裡有但 profiles 沒有的
      Object.keys(state.members || {}).forEach(function (id) {
        var m = state.members[id];
        if (!memberHasName(m)) return;
        var key = normalizeName(m.name);
        if (!state.profiles[key]) {
          state.profiles[key] = { name: m.name.trim(), gender: m.gender, skill: m.skill };
        }
      });
    }
    return state.profiles;
  }

  function syncProfile(state, member) {
    if (!member || !memberHasName(member)) return;
    ensureStateFields(state);
    ensureProfiles(state);
    var key = normalizeName(member.name);
    state.profiles[key] = { name: member.name.trim(), gender: member.gender, skill: member.skill };
  }

  function profileForName(state, name) {
    ensureStateFields(state);
    ensureProfiles(state);
    return state.profiles[normalizeName(name)] || null;
  }

  // 過去名單：瀏覽器中保存過、但目前不在本場名單裡的人員設定檔，依姓名排序。
  function pastProfiles(state) {
    ensureProfiles(state);
    var current = {};
    Object.keys(state.members || {}).forEach(function (id) {
      var m = state.members[id];
      if (memberHasName(m)) current[normalizeName(m.name)] = true;
    });
    return Object.keys(state.profiles)
      .filter(function (key) { return !current[key]; })
      .map(function (key) { return { key: key, profile: state.profiles[key] }; })
      .sort(function (a, b) { return a.profile.name.localeCompare(b.profile.name, "zh-Hant"); });
  }

  // 從過去名單加入一位單人：帶入設定檔的姓名、性別、實力；本場統計比照新增成員（含新人起始補償）。
  // 已在本場名單中或設定檔不存在時回傳 null。
  function addMemberFromProfile(state, profileKey) {
    var prof = state.profiles && state.profiles[profileKey];
    if (!prof) return null;
    var exists = Object.keys(state.members || {}).some(function (id) {
      var m = state.members[id];
      return memberHasName(m) && normalizeName(m.name) === profileKey;
    });
    if (exists) return null;
    var gid = addGroup(state, 1);
    var g = state.groups.filter(function (gg) { return gg.id === gid; })[0];
    var m = state.members[g.memberIds[0]];
    m.name = prof.name;
    m.gender = prof.gender;
    m.skill = prof.skill;
    return m.id;
  }

  // ---- 雙人組合變更（切換類型、連結、分開）----
  // 隨時都可以改，包括成員正在場上（含待確認名單）時：目前座位一律保留不動，
  // 新的組合只影響之後的選人（場上的人下場後才依新組合安排）。
  function findGroup(state, groupId) {
    return (state.groups || []).filter(function (gg) { return gg.id === groupId; })[0] || null;
  }

  // 切換雙人組類型：fixed（雙人組，同隊上場）⇄ rotate（雙人輪流，共用名額）。
  function setPairType(state, groupId, type) {
    if (type !== "fixed" && type !== "rotate") return false;
    var g = findGroup(state, groupId);
    if (!g || g.memberIds.length !== 2) return false;
    g.type = type;
    return true;
  }

  // 連結：把另一位單人組成員併入 groupId 這個單人組，成為 type 類型的雙人組；被併入者原本的組別刪除。
  function linkMembers(state, groupId, memberId, type) {
    if (type !== "fixed" && type !== "rotate") return false;
    var g = findGroup(state, groupId);
    var m = state.members[memberId];
    if (!g || g.memberIds.length !== 1 || !m || m.groupId === groupId) return false;
    var from = findGroup(state, m.groupId);
    if (!from || from.memberIds.length !== 1) return false;
    state.groups = state.groups.filter(function (gg) { return gg.id !== from.id; });
    if (state.groupCounts) delete state.groupCounts[from.id];
    m.groupId = g.id;
    g.memberIds.push(m.id);
    g.type = type;
    normalizeSeats(state);
    return true;
  }

  // 分開：雙人組拆成兩個單人組，第二位成員移到新組別（沿用原組別的組別輪替次數）。
  function splitPair(state, groupId) {
    var g = findGroup(state, groupId);
    if (!g || g.memberIds.length !== 2) return false;
    var mid2 = g.memberIds[1];
    var m2 = state.members[mid2];
    if (!m2) return false;
    var newGid = state.nextGroupId++;
    state.groups.push({ id: newGid, memberIds: [mid2], type: "single" });
    if (!state.groupCounts) state.groupCounts = {};
    state.groupCounts[newGid] = state.groupCounts[g.id] || 0;
    m2.groupId = newGid;
    g.memberIds = [g.memberIds[0]];
    g.type = "single";
    normalizeSeats(state);
    return true;
  }

  // 從過去名單刪除一位人員設定檔（使用者明確刪除時才會刪）。仍在目前名單中的人不能刪，回傳 false。
  function deleteProfile(state, profileKey) {
    if (!state.profiles || !state.profiles[profileKey]) return false;
    var inRoster = Object.keys(state.members || {}).some(function (id) {
      var m = state.members[id];
      return memberHasName(m) && normalizeName(m.name) === profileKey;
    });
    if (inRoster) return false;
    delete state.profiles[profileKey];
    return true;
  }

  // 貼上名單中標記固定雙人組的寫法，例如「王小明 / 陳小華 / [固定]」
  var FIXED_MARKERS = ["[固定]", "(固定)", "【固定】"];

  // 貼上名單解析
  function parsePaste(text) {
    var result = { ok: true, errors: [], warnings: [], people: [], groups: [], lines: [] };
    var rawLines = String(text == null ? "" : text).split(/\r?\n/);
    var meaningful = [];
    rawLines.forEach(function (line, idx) {
      if (line.trim() === "") return;
      meaningful.push({ lineNo: idx + 1, text: line });
    });

    if (meaningful.length === 0) {
      result.errors.push("請輸入名單");
      result.ok = false;
      return result;
    }

    meaningful.forEach(function (item) {
      var parts = item.text.split("/").map(function (s) { return s.trim(); });
      // 類型標記：最後一段為 [固定]、(固定)、【固定】 時視為固定雙人組；須先移除標記再檢查成員數。
      var type = null;
      if (FIXED_MARKERS.indexOf(parts[parts.length - 1]) !== -1) {
        type = "fixed";
        parts = parts.slice(0, -1);
      }
      if (parts.length > 2) {
        result.errors.push("第 " + item.lineNo + " 行超過兩個成員");
        result.ok = false;
        result.lines.push({ lineNo: item.lineNo, names: parts, error: "超過兩個成員" });
        return;
      }
      if (parts.length === 0 || parts.some(function (p) { return p === ""; })) {
        result.errors.push("第 " + item.lineNo + " 行有空姓名");
        result.ok = false;
        result.lines.push({ lineNo: item.lineNo, names: parts, error: "空姓名" });
        return;
      }
      if (type === "fixed" && parts.length !== 2) {
        result.errors.push("第 " + item.lineNo + " 行固定雙人組需要兩位成員");
        result.ok = false;
        result.lines.push({ lineNo: item.lineNo, names: parts, error: "固定雙人組需要兩位成員" });
        return;
      }
      if (!type) type = parts.length === 2 ? "rotate" : "single";
      result.lines.push({ lineNo: item.lineNo, names: parts, type: type });
    });

    // 收集 people / groups，只在無致命格式錯誤時繼續
    if (result.errors.length > 0) {
      result.ok = false;
      return result;
    }

    var groupCounter = 0;
    result.lines.forEach(function (l) {
      var names = l.names;
      var group = { index: groupCounter++, names: names.slice(), type: l.type, personIndexes: [] };
      names.forEach(function (nm, gi) {
        var person = { name: nm, normalizedName: normalizeName(nm) };
        person.index = result.people.length;
        group.personIndexes.push(person.index);
        result.people.push(person);
      });
      result.groups.push(group);
    });

    // 重複姓名檢查
    var seen = {};
    result.people.forEach(function (p) {
      if (seen[p.normalizedName] !== undefined) {
        result.warnings.push("重複姓名：" + p.name);
        result.errors.push("重複姓名：" + p.name);
        result.ok = false;
      } else {
        seen[p.normalizedName] = true;
      }
    });

    return result;
  }

  // 套用匯入設定時，為每位 person 補上 suggestedProfile key
  function attachSuggestedProfiles(state, parsed) {
    ensureStateFields(state);
    ensureProfiles(state);
    (parsed.people || []).forEach(function (p) {
      var key = normalizeName(p.name);
      p.suggestedProfile = state.profiles[key] ? key : null;
    });
    return parsed;
  }

  function clearSeatsFor(state, predicate) {
    ["A", "B", "C"].forEach(function (c) {
      if (!state.courts[c]) return;
      state.courts[c] = state.courts[c].map(function (seat) {
        return (seat && predicate(seat)) ? null : seat;
      });
    });
  }

  // 讓場上座位與名單一致：
  //  1. 成員或其組別已不存在 → 清空座位；座位的 groupId 一律改成成員目前的 groupId。
  //  2. 同一人同時佔兩個座位 → 只保留第一個（依 A、B、C 場地及座位順序）。
  //  3. 依座位重建每位成員的 onCourt，避免有人被標記在場上卻沒有座位而永遠排不到。
  // 組別關係改變（切換類型、連結、分開、匯入）造成的「同組多人在場上」「固定組不同隊」不清座位：
  // 目前場上的配隊保留不動，新組合只影響之後的選人。
  function normalizeSeats(state) {
    var groupMap = {};
    (state.groups || []).forEach(function (g) { groupMap[g.id] = g; });
    var courtLetters = ["A", "B", "C"];
    var seated = {};
    courtLetters.forEach(function (c) {
      if (!state.courts[c]) state.courts[c] = [null, null, null, null];
      state.courts[c] = state.courts[c].map(function (seat) {
        if (!seat) return null;
        var m = state.members[seat.memberId];
        if (!m || !groupMap[m.groupId] || seated[m.id]) return null;
        seated[m.id] = true;
        return { groupId: m.groupId, memberId: m.id };
      });
    });
    Object.keys(state.members || {}).forEach(function (id) {
      if (state.members[id]) state.members[id].onCourt = null;
    });
    courtLetters.forEach(function (c) {
      state.courts[c].forEach(function (seat) {
        if (seat) state.members[seat.memberId].onCourt = c;
      });
    });
    return state;
  }

  function removeMember(state, memberId) {
    var m = state.members[memberId];
    if (!m) return;
    var g = null;
    for (var i = 0; i < state.groups.length; i++) { if (state.groups[i].id === m.groupId) { g = state.groups[i]; break; } }
    if (!g) { delete state.members[memberId]; return; }
    if (g.memberIds.length <= 1) {
      clearSeatsFor(state, function (seat) { return seat.groupId === g.id; });
      g.memberIds.forEach(function (mid) { delete state.members[mid]; });
      state.groups = state.groups.filter(function (gg) { return gg.id !== g.id; });
      if (state.groupCounts) delete state.groupCounts[g.id];
      return;
    }
    clearSeatsFor(state, function (seat) { return seat.memberId === memberId; });
    g.memberIds = g.memberIds.filter(function (id) { return id !== memberId; });
    // 雙人組只剩一人時改為單人組（固定雙人組少一人就無法再被安排）
    if (g.memberIds.length === 1) g.type = "single";
    delete state.members[memberId];
  }

  function addGroup(state, count) {
    var id = state.nextGroupId++;
    // 新增人員時，先以目前平均實際上場次數給予不打場數，避免新成員因 0 場而被過度優先。
    var comp = 0;
    try {
      if (state.settings && state.settings.restCompensationEnabled && global.Pairing && typeof global.Pairing.avgEffectivePlayCount === "function") {
        comp = Math.round((global.Pairing.avgEffectivePlayCount(state) || 0) * 2) / 2;
      }
    } catch (e) {}
    var memberIds = [];
    for (var i = 0; i < count; i++) {
      var mid = state.nextMemberId++;
      state.members[mid] = {
        id: mid, name: "", groupId: id, playCount: 0, onCourt: null,
        gender: null, skill: null, resting: false, lastFinishedAt: null,
        restCreditTotal: comp, restStartAverage: null
      };
      memberIds.push(mid);
    }
    state.groups.push({ id: id, memberIds: memberIds, type: count === 1 ? "single" : "rotate" });
    if (!state.groupCounts) state.groupCounts = {};
    // 公平起始：取其他組的最小次數
    var others = state.groups.filter(function (g) { return g.id !== id; });
    var minC = 0;
    if (others.length) minC = Math.min.apply(null, others.map(function (g) { return state.groupCounts[g.id] || 0; }));
    state.groupCounts[id] = minC;
    return id;
  }

  function addMemberToGroup(state, groupId) {
    var g = null;
    for (var i = 0; i < state.groups.length; i++) { if (state.groups[i].id === groupId) { g = state.groups[i]; break; } }
    if (!g || g.memberIds.length >= 2) return null;
    var comp = 0;
    try {
      if (state.settings && state.settings.restCompensationEnabled && global.Pairing && typeof global.Pairing.avgEffectivePlayCount === "function") {
        comp = Math.round((global.Pairing.avgEffectivePlayCount(state) || 0) * 2) / 2;
      }
    } catch (e) {}
    var mid = state.nextMemberId++;
    state.members[mid] = {
      id: mid, name: "", groupId: groupId, playCount: 0, onCourt: null,
      gender: null, skill: null, resting: false, lastFinishedAt: null,
      restCreditTotal: comp, restStartAverage: null
    };
    g.memberIds.push(mid);
    // 如果群組原本是 single 且新增第2個成員，變為 rotate
    if (g.type === "single") g.type = "rotate";
    return mid;
  }

  // imports
  // selections: array aligned with parsed.people; each value is profile key string or null
  function applyImport(state, parsed, mode, selections, now) {
    ensureStateFields(state);
    ensureProfiles(state);
    if (!parsed || !parsed.ok) {
      return { ok: false, errors: (parsed && parsed.errors) || ["解析失敗"] };
    }
    selections = selections || [];
    var errors = [];
    if (mode !== "new" && mode !== "update") errors.push("未知的匯入模式");
    if (errors.length) return { ok: false, errors: errors };

    var selectedProfileKey = function (i) {
      if (selections[i] === undefined) return (parsed.people[i].suggestedProfile || null);
      if (selections[i] === "__none__") return null;
      return selections[i];
    };

    if (mode === "new") {
      // 保留 profiles，重建 profiles 套用設定
      var profiles = Object.assign({}, state.profiles);
      // application: create members
      var newState = createDefaultState();
      newState.profiles = profiles;
      newState.courtCount = state.courtCount;
      newState.settings = { restCompensationEnabled: state.settings.restCompensationEnabled };
      // ids continue
      newState.nextGroupId = state.nextGroupId;
      newState.nextMemberId = state.nextMemberId;

      // map profile info
      // build group
      var groups = [];
      var members = {};
      var groupCounts = {};
      var seqG = newState.nextGroupId;
      var seqM = newState.nextMemberId;
      parsed.groups.forEach(function (grp) {
        var gid = seqG++;
        var memberIds = [];
        grp.names.forEach(function (nm, gi) {
          var personIndex = grp.personIndexes[gi];
          var mid = seqM++;
          var key = selectedProfileKey(personIndex);
          var prof = key ? state.profiles[key] : null;
          // copy old profile if manual mapping to new name
          if (key && key !== normalizeName(nm) && state.profiles[key]) {
            var nk = normalizeName(nm);
            profiles[nk] = {
              name: nm.trim(),
              gender: state.profiles[key].gender,
              skill: state.profiles[key].skill
            };
            prof = profiles[nk];
          }
          if (!profiles[normalizeName(nm)]) {
            profiles[normalizeName(nm)] = { name: nm.trim(), gender: prof ? prof.gender : null, skill: prof ? prof.skill : null };
          }
          if (!prof) prof = profiles[normalizeName(nm)];
          // sync profile attributes
          profiles[normalizeName(nm)].gender = prof ? prof.gender : null;
          profiles[normalizeName(nm)].skill = prof ? prof.skill : null;

          var member = {
            id: mid, name: nm.trim(), groupId: gid, playCount: 0, onCourt: null,
            gender: prof ? prof.gender : null, skill: prof ? prof.skill : null,
            resting: false, lastFinishedAt: null, restCreditTotal: 0, restStartAverage: null
          };
          members[mid] = member;
          memberIds.push(mid);
          // update profile final
          profiles[normalizeName(nm)] = { name: nm.trim(), gender: member.gender, skill: member.skill };
        });
        groups.push({ id: gid, memberIds: memberIds, type: grp.type || "rotate" });
        groupCounts[gid] = 0;
      });

      newState.groups = groups;
      newState.members = members;
      newState.groupCounts = groupCounts;
      newState.nextGroupId = seqG;
      newState.nextMemberId = seqM;
      newState.profiles = profiles;
      newState.started = false;
      newState.courts = { A: [null, null, null, null], B: [null, null, null, null], C: [null, null, null, null] };
      newState.pending = { A: false, B: false, C: false };
      // apply state in place
      state.schemaVersion = newState.schemaVersion;
      state.nextGroupId = newState.nextGroupId;
      state.nextMemberId = newState.nextMemberId;
      state.groups = newState.groups;
      state.members = newState.members;
      state.groupCounts = newState.groupCounts;
      state.courts = newState.courts;
      state.pending = newState.pending;
      state.courtCount = newState.courtCount;
      state.started = newState.started;
      state.settings = newState.settings;
      state.profiles = newState.profiles;
      return { ok: true };
    }

    // update mode
    ensureStateFields(state);
    // index existing members by normalized name
    var existingByName = {};
    Object.keys(state.members || {}).forEach(function (id) {
      var m = state.members[id];
      if (!memberHasName(m)) return;
      var key = normalizeName(m.name);
      if (!existingByName[key]) existingByName[key] = [];
      existingByName[key].push(parseInt(id, 10));
    });

    // determine which existing member ids to keep
    var usedExistingIds = {};
    var newGroups = [];
    var newMembers = {}; // we'll reuse objects, but rebuild index
    // Start with shallow copy of state.members for reuse
    var membersMap = state.members;
    var seqG2 = state.nextGroupId;
    var seqM2 = state.nextMemberId;
    var profiles = Object.assign({}, state.profiles);

    var importedNormalizedSet = {};
    var importComp = 0;
    try {
      if (state.settings && state.settings.restCompensationEnabled && global.Pairing && typeof global.Pairing.avgEffectivePlayCount === "function") {
        importComp = Math.round((global.Pairing.avgEffectivePlayCount(state) || 0) * 2) / 2;
      }
    } catch (e) {}
    parsed.groups.forEach(function (grp) {
      var gid = seqG2++;
      var memberIds = [];
      grp.names.forEach(function (nm, gi) {
        var personIndex = grp.personIndexes[gi];
        var nkey = normalizeName(nm);
        importedNormalizedSet[nkey] = true;
        var key = selectedProfileKey(personIndex);
        // find existing member
        var existingId = null;
        if (existingByName[nkey] && existingByName[nkey].length) {
          // pick first unused
          for (var ei = 0; ei < existingByName[nkey].length; ei++) {
            var cand = existingByName[nkey][ei];
            if (!usedExistingIds[cand]) { existingId = cand; usedExistingIds[cand] = true; break; }
          }
        }
        var prof = key ? state.profiles[key] : null;
        // manual mapping copy profile to new name
        if (key && key !== nkey && state.profiles[key]) {
          profiles[nkey] = {
            name: nm.trim(),
            gender: state.profiles[key].gender,
            skill: state.profiles[key].skill
          };
          prof = profiles[nkey];
        }
        if (!profiles[nkey]) {
          profiles[nkey] = { name: nm.trim(), gender: prof ? prof.gender : null, skill: prof ? prof.skill : null };
        }
        if (!prof) prof = profiles[nkey];
        // ensure profile merge (update gender/skill if selected none? keep existing)
        if (!profiles[nkey].gender && prof && prof.gender) profiles[nkey].gender = prof.gender;
        if (profiles[nkey].skill == null && prof && prof.skill != null) profiles[nkey].skill = prof.skill;

        if (existingId != null) {
          var m = membersMap[existingId];
          m.name = nm.trim();
          m.groupId = gid;
          // apply profile gender/skill from selected profile if provided else keep?
          if (prof) { m.gender = prof.gender; m.skill = prof.skill; }
          else { /* keep */ }
          memberIds.push(existingId);
        } else {
          var mid = seqM2++;
          var nprof = profiles[nkey];
          var newM = {
            id: mid, name: nm.trim(), groupId: gid, playCount: 0, onCourt: null,
            gender: nprof ? nprof.gender : null, skill: nprof ? nprof.skill : null,
            resting: false, lastFinishedAt: null, restCreditTotal: importComp, restStartAverage: null
          };
          membersMap[mid] = newM;
          memberIds.push(mid);
        }
        profiles[nkey] = { name: nm.trim(), gender: membersMap[memberIds[memberIds.length - 1]].gender, skill: membersMap[memberIds[memberIds.length - 1]].skill };
      });
      newGroups.push({ id: gid, memberIds: memberIds, type: grp.type || "rotate" });
      state.groupCounts[gid] = 0;
    });

    // remove members not imported
    Object.keys(membersMap).forEach(function (id) {
      var m = membersMap[id];
      if (!memberHasName(m)) return;
      if (!importedNormalizedSet[normalizeName(m.name)]) {
        // remove from groups? already rebuilding; mark delete
        delete membersMap[id];
      }
    });
    // apply
    state.nextGroupId = seqG2;
    state.nextMemberId = seqM2;
    state.groups = newGroups;
    state.members = membersMap;
    // 組別已重新編號：保留仍在名單中的人的座位並改用新 groupId，清掉被移除者及組別關係變更後不合法的座位。
    normalizeSeats(state);
    state.profiles = profiles;
    state.groupCounts = state.groupCounts || {};
    // ensure groupCounts for new groups
    newGroups.forEach(function (g) { if (state.groupCounts[g.id] === undefined) state.groupCounts[g.id] = 0; });
    // remove groupCounts for removed groups
    Object.keys(state.groupCounts).forEach(function (gid) {
      if (!newGroups.some(function (g) { return g.id === parseInt(gid, 10); })) delete state.groupCounts[gid];
    });

    return { ok: true };
  }

  function memberByName(state, name) {
    var key = normalizeName(name);
    for (var i = 0; i < state.groups.length; i++) {
      var g = state.groups[i];
      for (var j = 0; j < g.memberIds.length; j++) {
        var m = state.members[g.memberIds[j]];
        if (m && normalizeName(m.name) === key) return m;
      }
    }
    return null;
  }

  function migrateV2(parsed) {
    if (!parsed || !parsed.groups || !parsed.members) return createDefaultState();
    var st = createDefaultState();
    if (parsed.courtCount === 1 || parsed.courtCount === 2 || parsed.courtCount === 3) st.courtCount = parsed.courtCount;
    if (parsed.nextGroupId) st.nextGroupId = parsed.nextGroupId;
    if (parsed.nextMemberId) st.nextMemberId = parsed.nextMemberId;
    st.groups = (parsed.groups || []).map(function (g) { 
      return { 
        id: g.id, 
        memberIds: (g.memberIds||[]).slice(), 
        type: g.type || "rotate" 
      }; 
    });
    st.members = {};
    var srcMembers = parsed.members || {};
    Object.keys(srcMembers).forEach(function (id) {
      var m = srcMembers[id];
      if (!m) return;
      st.members[id] = {
        id: m.id || Number(id),
        name: m.name || "",
        groupId: m.groupId,
        playCount: (typeof m.playCount === "number") ? m.playCount : 0,
        onCourt: (m.onCourt === "A" || m.onCourt === "B" || m.onCourt === "C") ? m.onCourt : null,
        gender: (m.gender === "M" || m.gender === "F") ? m.gender : null,
        skill: (m.skill === 1 || m.skill === 2 || m.skill === 3) ? m.skill : null,
        resting: m.resting === true,
        lastFinishedAt: null,
        restCreditTotal: 0,
        restStartAverage: m.resting === true ? 1 : null
      };
    });
    st.groupCounts = {};
    if (parsed.groupCounts && typeof parsed.groupCounts === "object") {
      Object.keys(parsed.groupCounts).forEach(function (k) { st.groupCounts[k] = parsed.groupCounts[k]; });
    } else {
      st.groups.forEach(function (g) { st.groupCounts[g.id] = 0; });
    }
    st.courts = { A: [null, null, null, null], B: [null, null, null, null], C: [null, null, null, null] };
    var srcCourts = parsed.courts || {};
    ["A", "B", "C"].forEach(function (c) {
      var oldSeats = srcCourts[c] || [null, null, null, null];
      st.courts[c] = oldSeats.map(function (seat) {
        if (!seat) return null;
        var mid = seat.memberId;
        if (!st.members[mid]) {
          var m = memberByName(st, seat.name);
          if (m) mid = m.id;
        }
        if (!st.members[mid]) return null;
        st.members[mid].onCourt = c;
        return { groupId: seat.groupId, memberId: mid };
      });
    });
    st.pending = parsed.pending || { A: false, B: false, C: false };
    ["A", "B", "C"].forEach(function (c) { if (typeof st.pending[c] !== "boolean") st.pending[c] = false; });
    st.started = !!parsed.started;
    st.settings = { restCompensationEnabled: true };
    st.profiles = {};
    ensureProfiles(st);
    ensureStateFields(st);
    st.schemaVersion = 3;
    return st;
  }

  function migrateV1(parsed) {
    var st = createDefaultState();
    if (!(parsed && parsed.members)) return st;
    st.started = !!parsed.started;
    if (parsed.courtCount === 1 || parsed.courtCount === 2 || parsed.courtCount === 3) st.courtCount = parsed.courtCount;
    st.groups.forEach(function (g) {
      g.memberIds.forEach(function (mid) {
        var m = st.members[mid];
        var old = parsed.members[m.name];
        if (old) {
          m.playCount = old.playCount || 0;
          if (old.gender === "M" || old.gender === "F") m.gender = old.gender;
          if (old.skill === 1 || old.skill === 2 || old.skill === 3) m.skill = old.skill;
          if (old.resting === true) m.resting = true;
        }
        if (parsed.groupCounts && typeof parsed.groupCounts[g.id] === "number") {
          st.groupCounts[g.id] = parsed.groupCounts[g.id];
        }
      });
    });
    ["A", "B", "C"].forEach(function (c) {
      var oldSeats = (parsed.courts && parsed.courts[c]) || [null, null, null, null];
      st.courts[c] = oldSeats.map(function (seat) {
        if (!seat) return null;
        var g = st.groups.filter(function (gg) { return gg.id === seat.groupId; })[0];
        if (!g) return null;
        var mid = g.memberIds.filter(function (id) { return st.members[id].name === seat.name; })[0];
        if (mid == null) return null;
        st.members[mid].onCourt = c;
        return { groupId: seat.groupId, memberId: mid };
      });
    });
    st.settings = { restCompensationEnabled: true };
    ensureProfiles(st);
    ensureStateFields(st);
    st.schemaVersion = 3;
    return st;
  }

  var api = {
    DEFAULT_GROUPS: DEFAULT_GROUPS,
    normalizeName: normalizeName,
    ensureStateFields: ensureStateFields,
    createDefaultState: createDefaultState,
    availableGroups: availableGroups,
    groupAvailable: groupAvailable,
    ensureProfiles: ensureProfiles,
    syncProfile: syncProfile,
    profileForName: profileForName,
    pastProfiles: pastProfiles,
    addMemberFromProfile: addMemberFromProfile,
    deleteProfile: deleteProfile,
    setPairType: setPairType,
    linkMembers: linkMembers,
    splitPair: splitPair,
    buildProfilesFromMembers: buildProfilesFromMembers,
    parsePaste: parsePaste,
    attachSuggestedProfiles: attachSuggestedProfiles,
    applyImport: applyImport,
    clearSeatsFor: clearSeatsFor,
    normalizeSeats: normalizeSeats,
    removeMember: removeMember,
    addGroup: addGroup,
    addMemberToGroup: addMemberToGroup,
    memberHasName: memberHasName,
    migrateV2: migrateV2,
    migrateV1: migrateV1
  };

  global.Roster = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);
