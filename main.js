document.documentElement.classList.remove('no-js');
document.documentElement.classList.add('js');

(function () {
  // Reveal elements as they enter the viewport
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('is-in'); });
  }

  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('is-scrolled', window.scrollY > 24); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // Language switch. English text lives in the HTML; Danish is defined here.
  // Keys without an element (vote.*) are used by campaigns/campaign.js through window.t().
  var da = {
    'home.meta': 'Kunstner',
    'home.cta': 'Stem på næste single',
    'footer.part': ', en del af 99',

    'c.title': '99 LUCIANO | Stem og vind',
    'c.label': 'Giveaway',
    'c.headline': 'Vælg min <em>næste</em> single.',
    'c.intro': 'Hør klippene og stem på den, der skal udkomme. Én stemme er ét lod i giveawayen.',
    'c.prize': 'Præmie',
    'c.ends': 'Slutter',
    'c.s1': 'Følg på Instagram',
    'c.s1.go': 'Åbn',
    'c.s2': 'Dit brugernavn',
    'c.s2.note': 'Vi tjekker, at du følger, før vinderen bliver trukket.',
    'c.s3': 'Lyt og stem',
    'c.s3.note': 'Tryk på et nummer for at høre klippet. Du har én stemme.',
    'c.done.label': 'Du er med',
    'c.done.title': 'Tak. Du er <em>med</em>.',
    'c.done.k1': 'Instagram',
    'c.done.k2': 'Din stemme',
    'c.done.keep': 'Bliv ved med at følge. Hvis du stopper før lodtrækningen, er du ude.',
    'c.share': 'Del med en ven',
    'c.closed.label': 'Lukket',
    'c.closed.title': 'Giveawayen er <em>slut</em>.',
    'c.closed.p': 'Tak til alle, der stemte. Følg med på Instagram for vinderen og udgivelsen.',

    'vote.pick': 'Vælg et nummer',
    'vote.for': 'Stem på “{song}”',
    'vote.sending': 'Sender…',
    'vote.yours': 'Din stemme',
    'vote.tap': 'Tryk for at stemme',
    'vote.err.handle': 'Skriv dit Instagram-brugernavn ovenfor.',
    'vote.err.bad_handle': 'Det ligner ikke et Instagram-brugernavn.',
    'vote.err.bad_song': 'Vælg et af numrene.',
    'vote.err.closed': 'Giveawayen er lukket.',
    'vote.err.too_many': 'For mange stemmer fra dette netværk.',
    'vote.err.net': 'Ingen forbindelse. Prøv igen.',
    'vote.err.unavailable': 'Klippet kan ikke afspilles lige nu.',
    'vote.already': '@{handle} har allerede stemt, så du er allerede med. Én stemme per person.',
    'vote.announce': 'Vinderen bliver offentliggjort på Instagram, når giveawayen slutter.',
    'vote.copied': 'Link kopieret',
    'vote.ends': '{date}'
  };

  var en = { 'meta.title': document.title };
  var nodes = document.querySelectorAll('[data-i18n]');
  nodes.forEach(function (el) { en[el.dataset.i18n] = el.innerHTML; });
  var titleKey = document.documentElement.dataset.title;

  var btn = document.getElementById('lang');
  var current = 'en';

  window.lang = function () { return current; };
  // t('vote.for', { song: 'X' }) → Danish if chosen, otherwise the English fallback.
  window.t = function (key, fallback, vars) {
    var s = (current === 'da' && da[key]) || fallback;
    Object.keys(vars || {}).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  };

  function setLang(lang) {
    var dict = lang === 'da' ? da : en;
    nodes.forEach(function (el) {
      var v = dict[el.dataset.i18n];
      if (v != null) el.innerHTML = v;
    });
    document.title = lang === 'da' && titleKey && da[titleKey] ? da[titleKey] : en['meta.title'];
    document.documentElement.lang = lang;
    current = lang;
    if (btn) {
      btn.textContent = lang === 'da' ? 'EN' : 'DA';
      btn.setAttribute('aria-label', lang === 'da' ? 'Switch to English' : 'Skift til dansk');
    }
    try { localStorage.setItem('lang', lang); } catch (e) {}
    document.dispatchEvent(new CustomEvent('langchange'));
  }

  if (btn) btn.addEventListener('click', function () { setLang(current === 'da' ? 'en' : 'da'); });

  var saved = null;
  try { saved = localStorage.getItem('lang'); } catch (e) {}
  if (saved === 'da' || (!saved && /^da\b/.test(navigator.language || ''))) setLang('da');
})();
