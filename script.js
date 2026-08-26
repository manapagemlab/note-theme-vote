/* eslint-disable no-console */
(function () {
  "use strict";

  var STORAGE_KEY = "amecan-note-theme-vote-20260826";

  /**
   * Googleスプレッドシート＋GAS Web AppのURL（アキコさんが発行後にここへ貼り付ける）。
   * プレースホルダーのままの間は「準備中」表示にし、投票ボタンを無効化する。
   * 設定手順は setup-shared-vote.md を参照。
   */
  var SHEET_API_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

  /**
   * 投票候補データ。
   * votes は初期値0（テスト票は含めない）。実際の票数はSHEET_API_URLから取得する。
   * icon は装飾SVG（data-qa-svg-purpose="decorative-vector"）。テーマを象徴する図案であり、
   * 実写・商品写真の代用ではない。
   */
  var CANDIDATES = [
    {
      id: "monitor-voice",
      title: "初めて届いたモニターさんの声",
      desc: "モニターさんから、はじめての感想が届いたときの話。個人が特定される内容は書きません。",
      icon: "letter"
    },
    {
      id: "son-story-continued",
      title: "検査結果をもらった日から今までの息子の話（続編）",
      desc: "検査結果を受け取ったあの日から今日までの、息子との日々の続き。完璧やない親のありのままを。",
      icon: "path"
    },
    {
      id: "gpts-usage",
      title: "WISC結果分解GPTs、3体の使い分け方",
      desc: "3つのGPTs、それぞれどう使い分けたらええか。購入を考え中の人向けに実演しながら解説。",
      icon: "triad"
    },
    {
      id: "daily-ai-life",
      title: "介護も子育ても、AIとどう付き合ってる？",
      desc: "WISCに限らず、介護のお仕事や子育て、AmeCan.の運営で、アキコが毎日AIをどう使こてるか。良かったことも失敗も、そのまま見せる回。",
      icon: "daily"
    }
  ];

  var CANDIDATE_IDS = CANDIDATES.map(function (c) { return c.id; });

  var ICONS = {
    letter:
      '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" data-qa-svg-purpose="decorative-vector" aria-hidden="true">' +
      '<rect x="5" y="10" width="30" height="20" rx="3" fill="none" stroke="var(--palette-signal)" stroke-width="2.2"/>' +
      '<path d="M6 12 L20 23 L34 12" fill="none" stroke="var(--palette-signal)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>",
    path:
      '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" data-qa-svg-purpose="decorative-vector" aria-hidden="true">' +
      '<path d="M7 32 C 12 20, 18 28, 20 18 S 30 8, 33 8" fill="none" stroke="var(--palette-signal)" stroke-width="2.4" stroke-linecap="round"/>' +
      '<circle cx="7" cy="32" r="2.6" fill="var(--palette-signal)"/>' +
      '<circle cx="33" cy="8" r="2.6" fill="var(--palette-signal)"/>' +
      "</svg>",
    triad:
      '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" data-qa-svg-purpose="decorative-vector" aria-hidden="true">' +
      '<circle cx="20" cy="10" r="5" fill="none" stroke="var(--palette-signal)" stroke-width="2.2"/>' +
      '<circle cx="9" cy="29" r="5" fill="none" stroke="var(--palette-signal)" stroke-width="2.2"/>' +
      '<circle cx="31" cy="29" r="5" fill="none" stroke="var(--palette-signal)" stroke-width="2.2"/>' +
      '<path d="M17 14 L11 24 M23 14 L29 24 M14 29 L26 29" stroke="var(--palette-signal)" stroke-width="1.8" stroke-linecap="round"/>' +
      "</svg>",
    daily:
      '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" data-qa-svg-purpose="decorative-vector" aria-hidden="true">' +
      '<circle cx="20" cy="20" r="13" fill="none" stroke="var(--palette-signal)" stroke-width="2.1"/>' +
      '<path d="M20 20 L20 12 M20 20 L26 24" stroke="var(--palette-signal)" stroke-width="2.2" stroke-linecap="round"/>' +
      '<circle cx="20" cy="20" r="1.8" fill="var(--palette-signal)"/>' +
      "</svg>"
  };

  /* ---------------- SHEET_API_URL 設定判定 ---------------- */

  function isApiConfigured() {
    return (
      typeof SHEET_API_URL === "string" &&
      SHEET_API_URL.indexOf("PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE") === -1 &&
      /^https:\/\//.test(SHEET_API_URL)
    );
  }

  /* ---------------- 自分の投票先の保存（引き続きlocalStorage） ---------------- */

  function loadMyVoteFromStorage() {
    try {
      return window.localStorage.getItem(STORAGE_KEY + "-my-vote") || null;
    } catch (err) {
      return null;
    }
  }

  function saveMyVoteToStorage(candidateId) {
    try {
      window.localStorage.setItem(STORAGE_KEY + "-my-vote", candidateId);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------------- 票数の正規化 ---------------- */

  function normalizeVotes(raw) {
    var result = {};
    CANDIDATE_IDS.forEach(function (id) {
      var v = raw && typeof raw === "object" ? raw[id] : undefined;
      result[id] = typeof v === "number" && v >= 0 ? v : 0;
    });
    return result;
  }

  /* ---------------- 状態 ---------------- */

  var state = {
    votes: normalizeVotes({}),
    myVote: null,
    pendingCandidateId: null,
    // "not-configured" | "loading" | "loaded" | "error"
    loadStatus: "loading",
    voting: false
  };

  function getCount(id) {
    var v = state.votes[id];
    return typeof v === "number" && v >= 0 ? v : 0;
  }

  function sortedCandidates() {
    return CANDIDATES.slice().sort(function (a, b) {
      var diff = getCount(b.id) - getCount(a.id);
      if (diff !== 0) return diff;
      return CANDIDATES.indexOf(a) - CANDIDATES.indexOf(b);
    });
  }

  function isVotingAllowed() {
    return isApiConfigured() && state.loadStatus === "loaded" && !state.voting;
  }

  /* ---------------- 同期状態バナー ---------------- */

  function updateSyncBanner() {
    var banner = document.getElementById("syncStatus");
    var text = document.getElementById("syncStatusText");
    var reloadBtn = document.getElementById("syncReloadBtn");
    if (!banner || !text) return;

    if (state.loadStatus === "not-configured") {
      banner.hidden = false;
      banner.className = "sync-status sync-status--not-configured";
      text.textContent =
        "投票の準備中です（アキコさんへ：script.js内のSHEET_API_URLを設定してください）。準備が整うまで投票ボタンは押せません。";
      if (reloadBtn) reloadBtn.hidden = true;
    } else if (state.loadStatus === "loading") {
      banner.hidden = false;
      banner.className = "sync-status sync-status--loading";
      text.textContent = "みんなの投票を読み込み中…";
      if (reloadBtn) reloadBtn.hidden = true;
    } else if (state.loadStatus === "error") {
      banner.hidden = false;
      banner.className = "sync-status sync-status--error";
      text.textContent =
        "投票の読み込みに失敗しました。通信状態を確認して、下のボタンからもう一度お試しください。";
      if (reloadBtn) reloadBtn.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  /* ---------------- 描画 ---------------- */

  function renderQuicklist() {
    var list = document.getElementById("heroQuicklist");
    var tpl = document.getElementById("heroQuickItemTemplate");
    if (!list || !tpl) return;
    list.innerHTML = "";
    var ranked = sortedCandidates();
    ranked.forEach(function (candidate, index) {
      var node = tpl.content.cloneNode(true);
      var li = node.querySelector(".hero-quickitem");
      li.querySelector('[data-role="rank"]').textContent = String(index + 1);
      li.querySelector('[data-role="title"]').textContent = candidate.title;
      li.querySelector('[data-role="votes"]').textContent = getCount(candidate.id) + "票";
      list.appendChild(node);
    });
  }

  function renderCandidates() {
    var grid = document.getElementById("candidateGrid");
    var tpl = document.getElementById("candidateCardTemplate");
    if (!grid || !tpl) return;
    grid.innerHTML = "";
    var ranked = sortedCandidates();
    var votingAllowed = isVotingAllowed();
    ranked.forEach(function (candidate, index) {
      var node = tpl.content.cloneNode(true);
      var card = node.querySelector(".candidate-card");
      card.setAttribute("data-candidate-id", candidate.id);

      var iconWrap = card.querySelector(".candidate-icon");
      iconWrap.innerHTML = ICONS[candidate.icon] || "";

      card.querySelector('[data-role="rank"]').textContent = "第" + (index + 1) + "位";
      var votesEl = card.querySelector('[data-role="votes"]');
      votesEl.innerHTML = "<strong>" + getCount(candidate.id) + "</strong>票";
      card.querySelector('[data-role="title"]').textContent = candidate.title;
      card.querySelector('[data-role="desc"]').textContent = candidate.desc;

      var btn = card.querySelector('[data-role="vote-btn"]');
      if (state.myVote === candidate.id) {
        btn.textContent = "投票ずみ（変更する）";
        btn.setAttribute("data-voted", "true");
      } else {
        btn.textContent = "これに投票する";
        btn.removeAttribute("data-voted");
      }
      btn.disabled = !votingAllowed;
      btn.addEventListener("click", function () {
        if (!isVotingAllowed()) return;
        openVotePanel(candidate);
      });

      grid.appendChild(node);
    });
  }

  function renderAll() {
    renderQuicklist();
    renderCandidates();
  }

  /* ---------------- 投票パネル ---------------- */

  function openVotePanel(candidate) {
    state.pendingCandidateId = candidate.id;
    var panel = document.getElementById("votePanel");
    var target = document.getElementById("votePanelTarget");
    var status = document.getElementById("voteStatus");
    if (!panel || !target) return;
    target.textContent = candidate.title;
    if (status) status.textContent = "";
    setFormBusy(false);
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeVotePanel() {
    var panel = document.getElementById("votePanel");
    if (panel) panel.hidden = true;
    state.pendingCandidateId = null;
  }

  function setFormBusy(isBusy) {
    var submitBtn = document.getElementById("submitVoteBtn");
    var cancelBtn = document.getElementById("cancelVoteBtn");
    if (submitBtn) {
      submitBtn.disabled = isBusy;
      submitBtn.textContent = isBusy ? "送信中…" : "この内容で投票する";
    }
    if (cancelBtn) cancelBtn.disabled = isBusy;
  }

  /* ---------------- サーバー通信 ---------------- */

  function fetchVotes() {
    state.loadStatus = "loading";
    updateSyncBanner();

    fetch(SHEET_API_URL, { method: "GET" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.error) throw new Error(data.error);
        state.votes = normalizeVotes(data);
        state.loadStatus = "loaded";
        updateSyncBanner();
        renderAll();
      })
      .catch(function (err) {
        console.warn("投票データの取得に失敗しました。", err);
        state.loadStatus = "error";
        updateSyncBanner();
        renderAll();
      });
  }

  function submitVote(candidateId) {
    var status = document.getElementById("voteStatus");
    var previous = state.myVote;

    if (previous === candidateId) {
      // 同じテーマへの再投票（変更なし）。サーバーへは送らない。
      if (status) status.textContent = "この内容ですでに投票ずみです。";
      window.setTimeout(closeVotePanel, 900);
      return;
    }

    if (!isVotingAllowed()) {
      if (status) status.textContent = "只今投票を受け付けられません。しばらくしてからお試しください。";
      return;
    }

    var payload = { candidateId: candidateId };
    if (previous) payload.previousCandidateId = previous;

    state.voting = true;
    setFormBusy(true);
    renderCandidates(); // 投票中は候補一覧側のボタンも見た目上disabled化する
    if (status) status.textContent = "";

    fetch(SHEET_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.error) throw new Error(data.error);
        state.votes = normalizeVotes(data);
        state.myVote = candidateId;
        saveMyVoteToStorage(candidateId);
        state.voting = false;
        setFormBusy(false);
        renderAll();
        if (status) status.textContent = "投票ありがとう！反映されたよ。";
        window.setTimeout(closeVotePanel, 900);
      })
      .catch(function (err) {
        console.warn("投票の送信に失敗しました。", err);
        state.voting = false;
        setFormBusy(false);
        renderAll();
        if (status) {
          status.textContent = "投票の送信に失敗しました。通信状態を確認して、もう一度お試しください。";
        }
      });
  }

  /* ---------------- 初期化 ---------------- */

  function init() {
    state.myVote = loadMyVoteFromStorage();

    var form = document.getElementById("voteForm");
    var cancelBtn = document.getElementById("cancelVoteBtn");
    var reloadBtn = document.getElementById("syncReloadBtn");

    if (form) {
      form.addEventListener("submit", function (evt) {
        evt.preventDefault();
        if (!state.pendingCandidateId) return;
        submitVote(state.pendingCandidateId);
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", closeVotePanel);
    }

    if (reloadBtn) {
      reloadBtn.addEventListener("click", function () {
        window.location.reload();
      });
    }

    if (!isApiConfigured()) {
      state.loadStatus = "not-configured";
      updateSyncBanner();
      renderAll();
      return;
    }

    // 読み込み中も候補一覧（0票状態）を先に描画し、取得完了後に票数を反映する。
    renderAll();
    fetchVotes();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
