const $ = (s) => document.querySelector(s);
let token = sessionStorage.getItem("99l:admin") || "";

async function api(path, opts = {}) {
  const res = await fetch(`/api/admin/${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401) throw new Error("Wrong token.");
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function renderResults(r) {
  $("#totals").textContent = `${r.total} entries · ${r.verified} verified followers`;
  const max = Math.max(1, ...r.bySong.map((s) => s.votes));
  $("#results").innerHTML = "";
  for (const s of [...r.bySong].sort((a, b) => b.verified - a.verified || b.votes - a.votes)) {
    const div = document.createElement("div");
    div.className = "row";
    div.style.display = "block";
    div.innerHTML = `<div style="display:flex;justify-content:space-between"><b></b><span>${s.votes} votes · ${s.verified} verified</span></div>
      <div class="bar" style="width:${(s.votes / max) * 100}%"></div>`;
    div.querySelector("b").textContent = s.title;
    $("#results").appendChild(div);
  }
}

async function unlock() {
  try {
    renderResults(await api("results"));
    sessionStorage.setItem("99l:admin", token);
    $("#login").hidden = true;
    $("#panel").hidden = false;
  } catch (e) {
    $("#login-err").textContent = e.message;
  }
}

// Pull usernames out of Instagram's export (JSON or HTML) or a plain list.
function extractHandles(text) {
  const out = new Set();
  try {
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        if (typeof v.value === "string") out.add(v.value);
        if (typeof v.title === "string" && v.title) out.add(v.title);
        Object.values(v).forEach(walk);
      }
    };
    walk(JSON.parse(text));
    if (out.size) return [...out];
  } catch { /* not JSON */ }
  for (const m of text.matchAll(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]{1,30})/g)) out.add(m[1]);
  if (out.size) return [...out];
  return text.split(/[\s,;]+/).map((s) => s.replace(/^@/, "")).filter(Boolean);
}

$("#login-btn").addEventListener("click", () => { token = $("#token").value.trim(); unlock(); });
$("#token").addEventListener("keydown", (e) => e.key === "Enter" && $("#login-btn").click());
$("#refresh").addEventListener("click", async () => renderResults(await api("results")));

$("#export").addEventListener("click", async () => {
  const csv = await api("export");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "entries.csv";
  a.click();
});

$("#file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const handles = extractHandles(await file.text());
  $("#followers").value = handles.join("\n");
  $("#verify-msg").textContent = `${handles.length} usernames loaded from ${file.name}`;
});

$("#verify").addEventListener("click", async () => {
  const followers = extractHandles($("#followers").value);
  try {
    const r = await api("verify", { method: "POST", body: JSON.stringify({ followers }) });
    renderResults(r);
    $("#verify-msg").textContent = `Checked against ${followers.length} followers → ${r.verified} of ${r.total} entries verified.`;
  } catch (e) {
    $("#verify-msg").textContent = e.message;
  }
});

$("#draw").addEventListener("click", async () => {
  try {
    const r = await api("draw", { method: "POST" });
    $("#winner").textContent = `@${r.winner.handle}`;
    $("#winner-meta").textContent = `Picked from ${r.pool} verified entries · voted ${r.winner.song} · ${r.winner.created_at} UTC`;
  } catch (e) {
    $("#winner").textContent = "";
    $("#winner-meta").textContent = e.message;
  }
});

if (token) unlock();
