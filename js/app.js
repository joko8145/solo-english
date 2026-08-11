(function () {
  "use strict";

  var KEY = "solo-english.v2";
  var SYNC_KEY = "solo-english.sync.v1";
  var GIST_DESC = "solo-english-list-v1";
  var GIST_FILENAME = "solo-english.json";

  var PROGRAMS = [
    {
      id: "keun",
      name: "매일 10분 영어",
      desc: "이근철의 하루 딱! 한문장",
      listUrl:
        "https://home.ebse.co.kr/10mins_keun/replay/3/list?courseId=ER2017H0LGC01ZZ&stepId=ET2017H0LGC0101&lectId=20064419",
    },
  ];

  function $(sel) {
    return document.querySelector(sel);
  }

  function uid() {
    return window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random();
  }

  function defaultState() {
    return { items: [], lastId: null };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) {
        var old = localStorage.getItem("solo-english.v1");
        if (old) {
          var parsed = JSON.parse(old);
          var items = (parsed.episodes || []).map(function (ep) {
            return {
              id: ep.id || uid(),
              title: ep.title || "회차",
              url: ep.url,
              programId: ep.programId || "keun",
              note: ep.note || "",
              done: !!ep.done,
              createdAt: ep.createdAt || Date.now(),
              updatedAt: ep.updatedAt || ep.createdAt || Date.now(),
            };
          });
          var st = { items: items, lastId: parsed.lastEpisodeId || null };
          localStorage.setItem(KEY, JSON.stringify(st));
          return st;
        }
        return defaultState();
      }
      var data = JSON.parse(raw);
      return {
        items: Array.isArray(data.items) ? data.items : [],
        lastId: data.lastId || null,
      };
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(
      KEY,
      JSON.stringify({ items: state.items, lastId: state.lastId })
    );
  }

  function loadSyncMeta() {
    try {
      var raw = localStorage.getItem(SYNC_KEY);
      if (!raw) return { token: "", gistId: "" };
      var data = JSON.parse(raw);
      return { token: data.token || "", gistId: data.gistId || "" };
    } catch (e) {
      return { token: "", gistId: "" };
    }
  }

  function saveSyncMeta() {
    localStorage.setItem(
      SYNC_KEY,
      JSON.stringify({ token: syncMeta.token, gistId: syncMeta.gistId })
    );
  }

  function parseEbseUrl(raw) {
    try {
      var u = new URL(String(raw).trim());
      if (u.hostname.indexOf("ebse.co.kr") === -1) return null;
      return {
        href: u.href,
        lectId: u.searchParams.get("lectId") || "",
        pathKey: u.pathname.split("/").filter(Boolean)[0] || "",
      };
    } catch (e) {
      return null;
    }
  }

  function detectProgramId() {
    return "keun";
  }

  function programById(id) {
    return (
      PROGRAMS.find(function (p) {
        return p.id === id;
      }) || PROGRAMS[0]
    );
  }

  function defaultTitle(parsed, programId) {
    var name = programById(programId).name;
    return parsed.lectId ? name + " · " + parsed.lectId : name + " 회차";
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function touchItem(item, patch) {
    return Object.assign({}, item, patch || {}, { updatedAt: Date.now() });
  }

  function mergeItems(localItems, remoteItems) {
    var map = {};
    function upsert(item) {
      if (!item || !item.url) return;
      var key = item.url;
      var prev = map[key];
      if (!prev) {
        map[key] = Object.assign({}, item);
        return;
      }
      var prevT = prev.updatedAt || prev.createdAt || 0;
      var nextT = item.updatedAt || item.createdAt || 0;
      var newer = nextT >= prevT ? item : prev;
      var older = newer === item ? prev : item;
      map[key] = {
        id: newer.id || older.id || uid(),
        title: newer.title || older.title,
        url: key,
        programId: newer.programId || older.programId || "keun",
        note: (newer.note && newer.note.length >= (older.note || "").length
          ? newer.note
          : older.note) || "",
        done: !!(newer.done || older.done),
        createdAt: Math.min(newer.createdAt || nextT, older.createdAt || prevT) || Date.now(),
        updatedAt: Math.max(prevT, nextT) || Date.now(),
      };
    }
    (localItems || []).forEach(upsert);
    (remoteItems || []).forEach(upsert);
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }

  function exportPayload() {
    return JSON.stringify(
      { version: 1, updatedAt: Date.now(), items: state.items },
      null,
      2
    );
  }

  function applyRemotePayload(payload, mode) {
    var remoteItems = payload && Array.isArray(payload.items) ? payload.items : [];
    if (mode === "replace") {
      state.items = remoteItems;
    } else {
      state.items = mergeItems(state.items, remoteItems);
    }
    saveState();
    renderList();
  }

  function setSyncStatus(msg, kind) {
    ui.syncStatus.textContent = msg || "";
    ui.syncStatus.classList.remove("is-error", "is-ok");
    if (kind) ui.syncStatus.classList.add(kind);
  }

  function gistHeaders(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
  }

  function findSoloGist(token) {
    return fetch("https://api.github.com/gists?per_page=100", {
      headers: gistHeaders(token),
    }).then(function (res) {
      if (!res.ok) throw new Error("토큰을 확인하세요. (gist 권한 필요)");
      return res.json();
    }).then(function (list) {
      return (list || []).find(function (g) {
        return g.description === GIST_DESC;
      }) || null;
    });
  }

  function readGistItems(token, gistId) {
    return fetch("https://api.github.com/gists/" + gistId, {
      headers: gistHeaders(token),
    }).then(function (res) {
      if (!res.ok) throw new Error("Gist를 읽지 못했습니다.");
      return res.json();
    }).then(function (gist) {
      var file = gist.files && gist.files[GIST_FILENAME];
      if (!file || !file.content) return { items: [] };
      return JSON.parse(file.content);
    });
  }

  function rememberTokenFromInput() {
    var typed = (ui.syncToken.value || "").trim();
    if (typed) {
      syncMeta.token = typed;
      saveSyncMeta();
    }
    return (syncMeta.token || "").trim();
  }

  function refreshTokenUI() {
    var saved = !!(syncMeta.token && syncMeta.token.trim());
    ui.syncTokenLabel.hidden = saved;
    ui.syncTokenSaved.hidden = !saved;
    if (saved) ui.syncToken.value = "";
  }

  function pushToGist() {
    var token = rememberTokenFromInput();
    if (!token) {
      setSyncStatus("토큰을 입력해 주세요.", "is-error");
      refreshTokenUI();
      return;
    }
    setSyncStatus("올리는 중…");
    findSoloGist(token)
      .then(function (found) {
        var body = {
          description: GIST_DESC,
          public: false,
          files: {},
        };
        body.files[GIST_FILENAME] = { content: exportPayload() };
        if (found) {
          return fetch("https://api.github.com/gists/" + found.id, {
            method: "PATCH",
            headers: gistHeaders(token),
            body: JSON.stringify(body),
          }).then(function (res) {
            if (!res.ok) throw new Error("올리기에 실패했습니다.");
            return found.id;
          });
        }
        return fetch("https://api.github.com/gists", {
          method: "POST",
          headers: gistHeaders(token),
          body: JSON.stringify(body),
        }).then(function (res) {
          if (!res.ok) throw new Error("Gist 만들기에 실패했습니다.");
          return res.json().then(function (g) {
            return g.id;
          });
        });
      })
      .then(function (gistId) {
        syncMeta.gistId = gistId;
        saveSyncMeta();
        refreshTokenUI();
        setSyncStatus("올림 완료 · 다른 기기에서 「받기」하세요.", "is-ok");
      })
      .catch(function (err) {
        setSyncStatus(err.message || "올리기 실패", "is-error");
      });
  }

  function pullFromGist() {
    var token = rememberTokenFromInput();
    if (!token) {
      setSyncStatus("토큰을 입력해 주세요.", "is-error");
      refreshTokenUI();
      return;
    }
    setSyncStatus("받는 중…");
    var chain = syncMeta.gistId
      ? Promise.resolve({ id: syncMeta.gistId })
      : findSoloGist(token);
    chain
      .then(function (found) {
        if (!found) throw new Error("올린 목록이 없습니다. PC에서 먼저 「올리기」하세요.");
        syncMeta.gistId = found.id;
        saveSyncMeta();
        return readGistItems(token, found.id);
      })
      .then(function (payload) {
        applyRemotePayload(payload, "merge");
        refreshTokenUI();
        setSyncStatus(
          "받기 완료 · 목록 " + state.items.length + "개로 맞춤",
          "is-ok"
        );
      })
      .catch(function (err) {
        setSyncStatus(err.message || "받기 실패", "is-error");
      });
  }

  var ui = {
    viewList: $("#view-list"),
    viewDetail: $("#view-detail"),
    studyList: $("#study-list"),
    listEmpty: $("#list-empty"),
    listCount: $("#list-count"),
    addForm: $("#add-form"),
    itemUrl: $("#item-url"),
    itemTitle: $("#item-title"),
    itemNote: $("#item-note"),
    addDone: $("#add-done"),
    programRow: $("#program-row"),
    syncToken: $("#sync-token"),
    syncTokenLabel: $("#sync-token-label"),
    syncTokenSaved: $("#sync-token-saved"),
    btnTokenChange: $("#btn-token-change"),
    btnTokenClear: $("#btn-token-clear"),
    syncStatus: $("#sync-status"),
    btnSyncPush: $("#btn-sync-push"),
    btnSyncPull: $("#btn-sync-pull"),
    btnExport: $("#btn-export"),
    btnImport: $("#btn-import"),
    btnBack: $("#btn-back"),
    detailTitle: $("#detail-title"),
    detailMeta: $("#detail-meta"),
    detailNote: $("#detail-note"),
    detailLink: $("#detail-link"),
    btnOpenVideo: $("#btn-open-video"),
    editNote: $("#edit-note"),
    btnSaveNote: $("#btn-save-note"),
    btnStt: $("#btn-stt"),
    btnSttStop: $("#btn-stt-stop"),
    sttStatus: $("#stt-status"),
    btnDone: $("#btn-done"),
    btnNext: $("#btn-next"),
  };

  var state = loadState();
  var syncMeta = loadSyncMeta();
  var currentIndex = -1;
  var speechRec = null;
  var sttBaseNote = "";

  refreshTokenUI();
  wireToggleHints();
  maybeOpenSyncPanel();

  function wireToggleHints() {
    document.querySelectorAll(".toggle-panel").forEach(function (panel) {
      var hint = panel.querySelector(".toggle-hint");
      if (!hint) return;
      function syncHint() {
        hint.textContent = panel.open ? "접기" : "펼치기";
      }
      syncHint();
      panel.addEventListener("toggle", syncHint);
    });
  }

  function maybeOpenSyncPanel() {
    var syncPanel = $("#panel-sync");
    var addPanel = $("#panel-add");
    if (syncPanel && !syncMeta.token) syncPanel.open = true;
    if (addPanel && (!state.items || !state.items.length)) addPanel.open = true;
  }

  function currentItem() {
    return currentIndex >= 0 ? state.items[currentIndex] : null;
  }

  function setSttStatus(msg, cls) {
    ui.sttStatus.textContent = msg || "";
    ui.sttStatus.className = "stt-status" + (cls ? " " + cls : "");
  }

  function selectedSttLang() {
    var el = document.querySelector('input[name="stt-lang"]:checked');
    return el ? el.value : "en-US";
  }

  function saveNoteFromEditor() {
    var item = currentItem();
    if (!item) return;
    item = touchItem(item, { note: ui.editNote.value.trim() });
    state.items[currentIndex] = item;
    saveState();
    if (item.note) {
      ui.detailNote.hidden = false;
      ui.detailNote.textContent = item.note;
    } else {
      ui.detailNote.hidden = true;
    }
  }

  function stopStt(quiet) {
    if (speechRec) {
      try {
        speechRec.onend = null;
        speechRec.onerror = null;
        speechRec.onresult = null;
        speechRec.stop();
      } catch (e) {}
      speechRec = null;
    }
    ui.btnStt.disabled = false;
    ui.btnSttStop.disabled = true;
    if (!quiet) setSttStatus("말하기 끝 · 「메모 저장」을 눌러 주세요.", "is-ok");
  }

  function startStt() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSttStatus(
        "이 브라우저는 말로 메모를 지원하지 않습니다. Chrome·Edge를 쓰세요.",
        "is-error"
      );
      return;
    }
    stopStt(true);
    sttBaseNote = ui.editNote.value;
    speechRec = new SR();
    speechRec.lang = selectedSttLang();
    speechRec.continuous = true;
    speechRec.interimResults = true;
    speechRec.onresult = function (event) {
      var finalParts = [];
      var interim = "";
      for (var i = 0; i < event.results.length; i++) {
        var r = event.results[i];
        if (r.isFinal) finalParts.push(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      var finals = finalParts.filter(Boolean).join("\n");
      var next = sttBaseNote.trim();
      if (finals) next = next ? next + "\n" + finals : finals;
      if (interim.trim()) next = next ? next + "\n" + interim.trim() : interim.trim();
      ui.editNote.value = next;
      setSttStatus("듣는 중… " + (interim.trim() || finals || ""), "is-listening");
    };
    speechRec.onerror = function (event) {
      var code = event.error || "";
      if (code === "not-allowed") {
        setSttStatus("마이크 권한을 허용해 주세요.", "is-error");
      } else if (code === "no-speech") {
        setSttStatus("말이 감지되지 않았습니다. 다시 눌러 보세요.", "is-error");
      } else if (code !== "aborted") {
        setSttStatus("음성 인식 오류: " + code, "is-error");
      }
      stopStt(true);
    };
    speechRec.onend = function () {
      speechRec = null;
      ui.btnStt.disabled = false;
      ui.btnSttStop.disabled = true;
      if (ui.sttStatus.classList.contains("is-listening")) {
        setSttStatus("말하기 끝 · 「메모 저장」을 눌러 주세요.", "is-ok");
      }
    };
    try {
      speechRec.start();
      ui.btnStt.disabled = true;
      ui.btnSttStop.disabled = false;
      setSttStatus("듣는 중… 문장을 말해 보세요.", "is-listening");
    } catch (e) {
      setSttStatus("음성 인식을 시작하지 못했습니다.", "is-error");
      stopStt(true);
    }
  }

  function showList() {
    stopStt(true);
    ui.viewList.hidden = false;
    ui.viewDetail.hidden = true;
    currentIndex = -1;
    renderList();
  }

  function openItem(index) {
    if (!state.items[index]) return;
    stopStt(true);
    setSttStatus("");
    currentIndex = index;
    var item = state.items[index];
    state.lastId = item.id;
    saveState();
    ui.viewList.hidden = true;
    ui.viewDetail.hidden = false;
    ui.detailTitle.textContent = item.title;
    ui.detailMeta.textContent =
      programById(item.programId).name +
      (item.done ? " · 완료" : " · 공부 중") +
      (item.createdAt
        ? " · " + new Date(item.createdAt).toLocaleDateString("ko-KR")
        : "");
    if (item.note) {
      ui.detailNote.hidden = false;
      ui.detailNote.textContent = item.note;
    } else {
      ui.detailNote.hidden = true;
      ui.detailNote.textContent = "";
    }
    ui.editNote.value = item.note || "";
    ui.detailLink.href = item.url;
  }

  function renderList() {
    ui.listCount.textContent = state.items.length + "개";
    ui.listEmpty.hidden = state.items.length > 0;
    if (!state.items.length) {
      ui.studyList.innerHTML = "";
      return;
    }
    ui.studyList.innerHTML = state.items
      .map(function (item, i) {
        return (
          '<div class="tab' +
          (item.done ? " done" : "") +
          '">' +
          "<strong>" +
          (i + 1) +
          ". " +
          escapeHtml(item.title) +
          "</strong>" +
          '<span class="meta">' +
          escapeHtml(programById(item.programId).name) +
          (item.note ? " · " + escapeHtml(item.note) : "") +
          (item.done ? " · 완료" : "") +
          "</span>" +
          '<div class="tab-actions">' +
          '<button type="button" class="mini" data-open="' +
          i +
          '">열기</button>' +
          '<button type="button" class="mini" data-up="' +
          i +
          '"' +
          (i === 0 ? " disabled" : "") +
          ">↑</button>" +
          '<button type="button" class="mini" data-down="' +
          i +
          '"' +
          (i === state.items.length - 1 ? " disabled" : "") +
          ">↓</button>" +
          '<button type="button" class="mini danger" data-del="' +
          i +
          '">삭제</button>' +
          "</div></div>"
        );
      })
      .join("");
  }

  function renderPrograms() {
    ui.programRow.innerHTML = PROGRAMS.map(function (p) {
      return (
        '<a class="program-chip" href="' +
        p.listUrl +
        '" target="_blank" rel="noopener">' +
        escapeHtml(p.name) +
        "<small>" +
        escapeHtml(p.desc) +
        " · 목록 열기</small></a>"
      );
    }).join("");
  }

  function moveItem(index, dir) {
    var j = index + dir;
    if (j < 0 || j >= state.items.length) return;
    var list = state.items.slice();
    var item = list.splice(index, 1)[0];
    list.splice(j, 0, touchItem(item));
    state.items = list;
    saveState();
    renderList();
  }

  function openVideo() {
    var item = currentItem();
    if (!item) return;
    window.open(item.url, "ebse-video", "popup=yes,width=900,height=600");
  }

  ui.addForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var parsed = parseEbseUrl(ui.itemUrl.value);
    if (!parsed) {
      alert("EBSe 주소(home.ebse.co.kr)를 붙여 넣어 주세요.");
      return;
    }
    var programId = detectProgramId(parsed);
    var dup = state.items.some(function (it) {
      return it.url === parsed.href;
    });
    if (dup && !confirm("이미 목록에 있는 주소입니다. 그래도 추가할까요?")) {
      return;
    }
    var now = Date.now();
    state.items.push({
      id: uid(),
      title: ui.itemTitle.value.trim() || defaultTitle(parsed, programId),
      url: parsed.href,
      programId: programId,
      note: ui.itemNote.value.trim(),
      done: false,
      createdAt: now,
      updatedAt: now,
    });
    saveState();
    ui.addForm.reset();
    ui.addDone.hidden = false;
    setTimeout(function () {
      ui.addDone.hidden = true;
    }, 1000);
    renderList();
  });

  ui.studyList.addEventListener("click", function (e) {
    var open = e.target.closest("[data-open]");
    var up = e.target.closest("[data-up]");
    var down = e.target.closest("[data-down]");
    var del = e.target.closest("[data-del]");
    if (open) openItem(Number(open.getAttribute("data-open")));
    if (up) moveItem(Number(up.getAttribute("data-up")), -1);
    if (down) moveItem(Number(down.getAttribute("data-down")), 1);
    if (del) {
      if (confirm("이 회차를 목록에서 삭제할까요?")) {
        state.items.splice(Number(del.getAttribute("data-del")), 1);
        saveState();
        renderList();
      }
    }
  });

  ui.btnSyncPush.addEventListener("click", pushToGist);
  ui.btnSyncPull.addEventListener("click", pullFromGist);
  ui.btnTokenChange.addEventListener("click", function () {
    ui.syncTokenSaved.hidden = true;
    ui.syncTokenLabel.hidden = false;
    ui.syncToken.value = "";
    ui.syncToken.focus();
  });
  ui.btnTokenClear.addEventListener("click", function () {
    if (!confirm("이 기기에서 저장된 토큰을 지울까요?")) return;
    syncMeta.token = "";
    syncMeta.gistId = "";
    saveSyncMeta();
    ui.syncToken.value = "";
    refreshTokenUI();
    setSyncStatus("토큰을 지웠습니다.", "is-ok");
  });

  ui.btnExport.addEventListener("click", function () {
    var text = exportPayload();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          setSyncStatus("목록을 클립보드에 복사했습니다.", "is-ok");
        },
        function () {
          window.prompt("복사하세요:", text);
        }
      );
    } else {
      window.prompt("복사하세요:", text);
    }
  });

  ui.btnImport.addEventListener("click", function () {
    var raw = window.prompt("다른 기기에서 복사한 목록 JSON을 붙여 넣으세요.");
    if (!raw) return;
    try {
      var payload = JSON.parse(raw);
      applyRemotePayload(payload, "merge");
      setSyncStatus("붙여넣기 완료 · 목록 " + state.items.length + "개", "is-ok");
    } catch (e) {
      setSyncStatus("형식이 올바르지 않습니다.", "is-error");
    }
  });

  ui.btnBack.addEventListener("click", showList);
  ui.btnOpenVideo.addEventListener("click", openVideo);
  ui.btnSaveNote.addEventListener("click", function () {
    stopStt(true);
    saveNoteFromEditor();
    setSttStatus("메모를 저장했습니다.", "is-ok");
  });
  ui.btnStt.addEventListener("click", startStt);
  ui.btnSttStop.addEventListener("click", function () {
    stopStt(false);
  });
  ui.btnDone.addEventListener("click", function () {
    var item = currentItem();
    if (!item) return;
    state.items[currentIndex] = touchItem(item, { done: true });
    saveState();
    showList();
  });
  ui.btnNext.addEventListener("click", function () {
    var item = currentItem();
    if (item && !item.done) {
      state.items[currentIndex] = touchItem(item, { done: true });
      saveState();
    }
    if (currentIndex + 1 < state.items.length) openItem(currentIndex + 1);
    else showList();
  });

  renderPrograms();
  renderList();

  if (state.lastId) {
    var idx = state.items.findIndex(function (it) {
      return it.id === state.lastId;
    });
    if (idx >= 0) openItem(idx);
  }
})();
