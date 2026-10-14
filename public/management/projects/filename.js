// Reads a song's title, version and date from an audio file's name (the audio itself is never read).
//   "Natlys v3.wav"              → Natlys · v3
//   "natlys_master_2026-10-12.mp3" → natlys · Master · 12 Oct 2026
//   "Natlys (version 2).m4a"     → Natlys · v2
//   "Natlys - Mix 4 FINAL.aif"   → Natlys · Mix 4 Final
// No version in the name → the tracker gives it the next number (v1, v2, …).
// No date in the name → when the file was last saved.
(function (root) {
  var AUDIO = /\.(mp3|wav|wave|aif|aiff|aifc|flac|m4a|aac|alac|ogg|oga|opus|wma|caf|amr|midi?|webm|weba|mp4|3gp|m4r|dsf|dff|ape|wv|mka|ac3|au|snd)$/i;
  var TAGS = ['demo', 'rough', 'mix', 'master', 'mastered', 'final', 'instrumental', 'instr', 'acapella', 'a cappella',
    'clean', 'explicit', 'radio edit', 'edit', 'extended', 'remix', 'live', 'acoustic', 'stems', 'beat', 'ref', 'reference', 'bounce'];

  function cap(s) { return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function pad(n) { return ('0' + n).slice(-2); }

  function validDate(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d, 12));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
  }

  function parse(name, lastModified) {
    var ext = (name.match(/\.([a-z0-9]{1,5})$/i) || [])[1] || '';
    var s = name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^99\s*luciano\s*[-–]\s*/i, ''); // "99 LUCIANO - Natlys"

    var date = null, m;

    // Dates: 2026-10-12, 2026.10.12, 20261012, 12-10-2026, 12.10.26
    if ((m = s.match(/(?:^|[\s\-(\[])((20\d\d)[-.]?(\d\d)[-.]?(\d\d))(?=$|[\s\-)\]])/))) {
      date = validDate(+m[2], +m[3], +m[4]);
    } else if ((m = s.match(/(?:^|[\s\-(\[])((\d{1,2})[-.](\d{1,2})[-.](20\d\d|\d\d))(?=$|[\s\-)\]])/))) {
      var y = +m[4] < 100 ? 2000 + +m[4] : +m[4];
      date = validDate(y, +m[3], +m[2]);
    }
    if (date) s = s.replace(m[1], ' ');

    var label = null, cut = -1, parts = [];
    // Numbered versions: v3, V 3, ver3, version 2, vers. 2, take 4, mix 4, demo 2, master 2
    var re = /(?:^|[\s\-(\[])(v|ver|vers|version|versjon|take|mix|demo|master|bounce)\.?\s*(\d{1,3}(?:\.\d{1,2})?)(?=$|[\s\-)\]])/ig;
    var last = null;
    while ((m = re.exec(s))) last = m;
    if (last && last.index + last[0].length - last[0].replace(/^[\s\-(\[]/, '').length === 0) last = null; // "Demo 2.wav" is a title
    if (last) {
      var kw = last[1].toLowerCase();
      parts.push(/^v/.test(kw) ? 'v' + last[2] : cap(kw) + ' ' + last[2]);
      cut = last.index + (last[0].length - last[0].replace(/^[\s\-(\[]/, '').length);
    }
    // Words like master / demo / final, anywhere after the title
    var lower = s.toLowerCase();
    TAGS.forEach(function (t) {
      var r = new RegExp('(?:^|[\\s\\-(\\[])(' + t.replace(' ', '\\s') + ')(?=$|[\\s\\-)\\]\\d])', 'i');
      var mm = r.exec(lower);
      if (!mm) return;
      var at = mm.index + mm[0].length - mm[1].length;
      if (at === 0) return; // the whole name is the tag; keep it as the title
      if (last && at >= cut && at < cut + last[0].length) return; // already part of "Mix 4"
      // "edit" inside "radio edit" counts once
      if (parts.some(function (p) { return typeof p === 'object' && at < p.at + p.text.length && p.at < at + t.length; })) return;
      parts.push({ at: at, text: cap(t) });
      if (cut < 0 || at < cut) cut = at;
    });
    if (parts.length) {
      var numbered = typeof parts[0] === 'string' ? parts.shift() : null;
      parts.sort(function (a, b) { return a.at - b.at; });
      label = [numbered].concat(parts.map(function (p) { return p.text; })).filter(Boolean).join(' ');
    }

    var title = (cut >= 0 ? s.slice(0, cut) : s)
      .replace(/[\s\-–(\[]+$/g, '').replace(/^[\s\-–)\]]+/g, '').replace(/\(\s*\)|\[\s*\]/g, '').replace(/\s+/g, ' ').trim();
    if (!title) title = s.replace(/[()\[\]]/g, '').trim() || name;

    if (!date && lastModified) date = new Date(lastModified);
    return {
      title: title,
      label: label,
      date: date ? date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) : null,
      ext: ext.toLowerCase()
    };
  }

  function isAudio(file) {
    return /^audio\//.test(file.type || '') || AUDIO.test(file.name || '');
  }

  var api = { parse: parse, isAudio: isAudio };
  root.SongFile = api;
})(typeof window !== 'undefined' ? window : globalThis);
