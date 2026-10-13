const $ = (sel) => document.querySelector(sel);
const STORE_KEY = "99l:entries";

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';
const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';

const state = {
  campaign: null,
  handle: "",
  selected: null,
  playing: null,
  turnstileToken: null,
};

const audio = new Audio();
audio.preload = "none";

// ---------- helpers ----------

function normalizeHandle(input) {
  let h = String(input || "").trim().toLowerCase();
  const url = h.match(/instagram\.com\/([^/?#]+)/);
  if (url) h = url[1];
  h = h.replace(/^@+/, "");
  if (!/^[a-z0-9._]{1,30}$/.test(h) || h.startsWith(".") || h.endsWith(".") || h.includes("..")) return null;
  return h;
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function writeStore(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function show(id) {
  for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== id;
  window.scrollTo(0, 0);
}

function isOpen(c) {
  return c.open && (!c.endsAt || Date.now() <= Date.parse(c.endsAt));
}

function snippetLength(song) {
  const max = state.campaign.snippetSeconds || 30;
  return isFinite(audio.duration) && audio.duration > 0 && state.playing === song.id ? Math.min(audio.duration, max) : max;
}

// ---------- step 1: follow + handle ----------

function initFollow() {
  const c = state.campaign;
  const ig = `https://instagram.com/${c.instagram}`;
  $("#follow-btn").href = ig;
  $("#follow-label").textContent = `Follow @${c.instagram}`;
  $("#closed-ig").href = ig;
  $("#closed-ig").textContent = `@${c.instagram}`;
  if (c.headline) $("#headline").textContent = c.headline;
  if (c.prize) {
    $("#prize-text").textContent = c.prize;
    $("#prize").hidden = false;
  }
  if (c.endsAt) {
    const d = new Date(c.endsAt);
    $("#ends").textContent = `Ends ${d.toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
  }

  $("#follow-btn").addEventListener("click", () => {
    const btn = $("#follow-btn");
    btn.classList.add("btn--done");
    $("#follow-label").textContent = `Followed? Add your username below`;
    setTimeout(() => $("#handle").focus({ preventScroll: true }), 600);
  });

  const input = $("#handle");
  const hint = $("#handle-hint");
  const next = $("#to-listen");
  const defaultHint = hint.textContent;

  const validate = (strict) => {
    const h = normalizeHandle(input.value);
    next.disabled = !h;
    if (!h && strict && input.value.trim()) {
      hint.textContent = "Usernames only use letters, numbers, . and _";
      hint.classList.add("is-error");
    } else {
      hint.textContent = defaultHint;
      hint.classList.remove("is-error");
    }
    return h;
  };

  input.addEventListener("input", () => validate(false));
  input.addEventListener("blur", () => validate(true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && validate(true)) next.click();
  });

  next.addEventListener("click", () => {
    const h = validate(true);
    if (!h) return;
    state.handle = h;
    input.value = h;
    $("#voting-as").textContent = `@${h}`;
    history.pushState({ step: "vote" }, "", "#vote");
    show("screen-vote");
  });

  window.addEventListener("popstate", () => {
    if (!$("#screen-vote").hidden) {
      audio.pause();
      show("screen-follow");
    }
  });

  $("#back").addEventListener("click", () => history.back());
}

// ---------- step 2: listen + vote ----------

function renderTracks() {
  const list = $("#tracks");
  list.innerHTML = "";
  for (const song of state.campaign.songs) {
    const li = document.createElement("li");
    li.innerHTML = `
      <button class="track" role="radio" aria-checked="false" data-id="${song.id}">
        <span class="track__play">${ICON_PLAY}</span>
        <span class="track__text">
          <span class="track__title"></span>
          <span class="track__meta">Tap to play · ${fmt(state.campaign.snippetSeconds || 30)}</span>
        </span>
        <span class="track__radio" aria-hidden="true"></span>
        <span class="track__bar" aria-hidden="true"></span>
      </button>`;
    li.querySelector(".track__title").textContent = song.title;
    li.querySelector(".track").addEventListener("click", () => onTrackTap(song));
    list.appendChild(li);
  }
}

function trackEl(id) {
  return document.querySelector(`.track[data-id="${CSS.escape(id)}"]`);
}

function onTrackTap(song) {
  select(song);
  if (state.playing === song.id && !audio.paused) {
    audio.pause();
  } else {
    play(song);
  }
}

function select(song) {
  state.selected = song.id;
  for (const el of document.querySelectorAll(".track")) {
    el.setAttribute("aria-checked", String(el.dataset.id === song.id));
  }
  const btn = $("#submit");
  btn.disabled = false;
  btn.textContent = `Vote for “${song.title}”`;
  $("#error").hidden = true;
}

function play(song) {
  if (state.playing !== song.id) {
    if (state.playing) resetTrack(state.playing);
    state.playing = song.id;
    audio.src = song.snippet;
    audio.currentTime = 0;
  }
  audio.play().catch(() => setMeta(song.id, "Couldn't play snippet"));
}

function setMeta(id, html) {
  const el = trackEl(id);
  if (el) el.querySelector(".track__meta").innerHTML = html;
}

function setIcon(id, playing) {
  const el = trackEl(id);
  if (el) el.querySelector(".track__play").innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
}

function resetTrack(id) {
  setIcon(id, false);
  const el = trackEl(id);
  if (el) el.querySelector(".track__bar").style.transform = "scaleX(0)";
  setMeta(id, `Played · tap to replay`);
}

let raf = 0;
function tick() {
  const song = state.campaign.songs.find((s) => s.id === state.playing);
  if (!song) return;
  const len = snippetLength(song);
  if (audio.currentTime >= len) {
    audio.pause();
    audio.currentTime = 0;
    resetTrack(song.id);
    return;
  }
  const el = trackEl(song.id);
  if (el) {
    el.querySelector(".track__bar").style.transform = `scaleX(${audio.currentTime / len})`;
    el.querySelector(".track__meta").innerHTML = `${EQ}&nbsp; ${fmt(audio.currentTime)} / ${fmt(len)}`;
  }
  if (!audio.paused) raf = requestAnimationFrame(tick);
}

audio.addEventListener("playing", () => {
  setIcon(state.playing, true);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
});
audio.addEventListener("waiting", () => setMeta(state.playing, "Loading…"));
audio.addEventListener("pause", () => {
  cancelAnimationFrame(raf);
  if (!state.playing) return;
  setIcon(state.playing, false);
  if (audio.currentTime > 0) setMeta(state.playing, `Paused · ${fmt(audio.currentTime)}`);
});
audio.addEventListener("ended", () => state.playing && resetTrack(state.playing));
audio.addEventListener("error", () => {
  if (!state.playing) return;
  setIcon(state.playing, false);
  setMeta(state.playing, "Snippet unavailable");
});

// ---------- turnstile (optional) ----------

function initTurnstile() {
  const siteKey = state.campaign.turnstileSiteKey;
  if (!siteKey) return;
  window.onTurnstileLoad = () => {
    window.turnstile.render("#turnstile", {
      sitekey: siteKey,
      appearance: "interaction-only",
      callback: (t) => (state.turnstileToken = t),
      "expired-callback": () => (state.turnstileToken = null),
    });
  };
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
  s.async = true;
  document.head.appendChild(s);
}

// ---------- submit ----------

async function submit() {
  const btn = $("#submit");
  const err = $("#error");
  if (!state.selected) return;
  if (state.campaign.turnstileSiteKey && !state.turnstileToken) {
    err.textContent = "One sec — checking you're human. Try again in a moment.";
    err.hidden = false;
    return;
  }

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Sending your vote…";
  err.hidden = true;

  try {
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: state.handle, song: state.selected, turnstile: state.turnstileToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");

    audio.pause();
    const entries = readStore();
    entries[state.campaign.id] = {
      handle: data.handle,
      song: data.alreadyVoted ? null : state.selected,
      alreadyVoted: Boolean(data.alreadyVoted),
    };
    writeStore(entries);
    showDone(entries[state.campaign.id]);
    history.replaceState(null, "", location.pathname);
  } catch (e) {
    err.textContent = e.message === "Failed to fetch" ? "No connection. Check your internet and try again." : e.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = label;
    if (window.turnstile) {
      window.turnstile.reset("#turnstile");
      state.turnstileToken = null;
    }
  }
}

// ---------- done ----------

function showDone(entry) {
  const song = state.campaign.songs.find((s) => s.id === entry.song);
  $("#r-handle").textContent = `@${entry.handle}`;
  if (song) {
    $("#r-song").textContent = song.title;
  } else {
    $("#r-song-row").hidden = true;
  }
  if (entry.alreadyVoted) {
    $("#done-lede").textContent = `@${entry.handle} has already voted — you're already entered. One vote per person.`;
  }
  $("#announce").textContent = state.campaign.announce || "";
  show("screen-done");
}

async function share() {
  const url = `${location.origin}/campaigns`;
  const text = `Vote for the next ${state.campaign.instagram} release and win`;
  if (navigator.share) {
    try { await navigator.share({ title: "99 Luciano", text, url }); } catch { /* cancelled */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    $("#share").textContent = "Link copied";
  } catch {
    $("#share").textContent = url;
  }
}

// ---------- boot ----------

async function boot() {
  try {
    const res = await fetch("/campaigns/campaign.json", { cache: "no-cache" });
    state.campaign = await res.json();
  } catch {
    document.body.innerHTML = '<div class="wrap" style="padding-top:40px"><p>Couldn\'t load the giveaway. Refresh to try again.</p></div>';
    return;
  }

  initFollow();
  $("#share").addEventListener("click", share);

  const existing = readStore()[state.campaign.id];
  if (existing) return showDone(existing);
  if (!isOpen(state.campaign)) return show("screen-closed");

  renderTracks();
  initTurnstile();
  $("#submit").addEventListener("click", submit);
  if (location.hash) history.replaceState(null, "", location.pathname);
  show("screen-follow");
}

boot();
