(function () {
  "use strict";

  var KEY = "solo-english.v2";

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
        // migrate v1 episodes if present
        var old = localStorage.getItem("solo-english.v1");
        if (old) {
          var parsed = JSON.parse(old);
          var items = (parsed.episodes || []).map(function (ep) {
            return {
              id: ep.id || uid(),
              title: ep.title || "회차",
              url: ep.url,
              programId: ep.programId || "other",
              note: ep.note || "",
              done: !!ep.done,
              createdAt: ep.createdAt || Date.now(),
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

  function detectProgramId(parsed) {
    var key = (parsed.pathKey || "").toLowerCase();
    if (key.indexOf("keun") !== -1 || key.indexOf("10mins") !== -1) return "keun";
    return "keun";
  }

  function programById(id) {
    return (
      PROGRAMS.find(function (p) {
        return p.id === id;
      }) || { id: "other", name: "EBSe", desc: "", listUrl: "#" }
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
    btnBack: $("#btn-back"),
    detailTitle: $("#detail-title"),
    detailMeta: $("#detail-meta"),
    detailNote: $("#detail-note"),
    detailLink: $("#detail-link"),
    btnOpenVideo: $("#btn-open-video"),
    editNote: $("#edit-note"),
    btnSaveNote: $("#btn-save-note"),
    btnRec: $("#btn-rec"),
    btnRecStop: $("#btn-rec-stop"),
    playback: $("#playback"),
    btnDone: $("#btn-done"),
    btnNext: $("#btn-next"),
  };

  var state = loadState();
  var currentIndex = -1;
  var mediaRecorder = null;
  var recordedChunks = [];
  var objectUrl = null;

  function currentItem() {
    return currentIndex >= 0 ? state.items[currentIndex] : null;
  }

  function showList() {
    ui.viewList.hidden = false;
    ui.viewDetail.hidden = true;
    currentIndex = -1;
    renderList();
  }

  function openItem(index) {
    if (!state.items[index]) return;
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
    ui.playback.hidden = true;
    ui.playback.removeAttribute("src");
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
    list.splice(j, 0, item);
    state.items = list;
    saveState();
    renderList();
  }

  function openVideo() {
    var item = currentItem();
    if (!item) return;
    window.open(item.url, "ebse-video", "popup=yes,width=900,height=600");
  }

  function startRec() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("이 브라우저에서는 녹음을 지원하지 않습니다.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = function (e) {
          if (e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.onstop = function () {
          stream.getTracks().forEach(function (t) {
            t.stop();
          });
          ui.btnRec.disabled = false;
          ui.btnRecStop.disabled = true;
          var blob = new Blob(recordedChunks, { type: "audio/webm" });
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = URL.createObjectURL(blob);
          ui.playback.src = objectUrl;
          ui.playback.hidden = false;
        };
        mediaRecorder.start();
        ui.btnRec.disabled = true;
        ui.btnRecStop.disabled = false;
      })
      .catch(function () {
        alert("마이크 권한을 허용해 주세요.");
      });
  }

  function stopRec() {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
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
    state.items.push({
      id: uid(),
      title: ui.itemTitle.value.trim() || defaultTitle(parsed, programId),
      url: parsed.href,
      programId: programId,
      note: ui.itemNote.value.trim(),
      done: false,
      createdAt: Date.now(),
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

  ui.btnBack.addEventListener("click", showList);
  ui.btnOpenVideo.addEventListener("click", openVideo);
  ui.btnSaveNote.addEventListener("click", function () {
    var item = currentItem();
    if (!item) return;
    item = Object.assign({}, item, { note: ui.editNote.value.trim() });
    state.items[currentIndex] = item;
    saveState();
    if (item.note) {
      ui.detailNote.hidden = false;
      ui.detailNote.textContent = item.note;
    } else {
      ui.detailNote.hidden = true;
    }
  });
  ui.btnRec.addEventListener("click", startRec);
  ui.btnRecStop.addEventListener("click", stopRec);
  ui.btnDone.addEventListener("click", function () {
    var item = currentItem();
    if (!item) return;
    state.items[currentIndex] = Object.assign({}, item, { done: true });
    saveState();
    showList();
  });
  ui.btnNext.addEventListener("click", function () {
    var item = currentItem();
    if (item && !item.done) {
      state.items[currentIndex] = Object.assign({}, item, { done: true });
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
