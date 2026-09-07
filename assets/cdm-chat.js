/* CDM site chat widget.
 *
 * Self contained: injects its own styles and DOM, talks to /api/chat on the same
 * origin. Ported from the live D&M Kai widget, trimmed to what CDM needs (no
 * photo upload, no WhatsApp handoff, no live agent takeover) and rebranded to
 * the CDM tokens already in the site's own CSS.
 *
 * Embed with:  <script src="/assets/cdm-chat.js" defer></script>
 *
 * Notes that matter:
 *  - the session id lives in localStorage so the thread follows them across pages
 *  - it boots on requestIdleCallback so it cannot cost the site its 100 score
 *  - one proactive nudge per session, never more
 *  - the details form is rendered here, and its values are posted straight
 *    through to the server rather than typed back into the conversation, so a
 *    name never round trips through the model
 */
(function () {
  if (window.__cdmChat) return; window.__cdmChat = true;

  var API = '/api/chat';
  var NAME = 'Remi';
  var GREETING = "Hi, I'm " + NAME + " from Carpe DM Strategies. Tell me what your business does and I'll show you where you stand in AI search.";
  var IDLE_RESET_MS = 6 * 60 * 60 * 1000;
  var MAX_TURNS = 24;

  /* ---- session ---------------------------------------------------------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  var SID = null;
  try {
    var lastSeen = parseInt(localStorage.getItem('cdm_last_seen') || '0', 10) || 0;
    if (lastSeen && (Date.now() - lastSeen) < IDLE_RESET_MS) SID = localStorage.getItem('cdm_sid');
  } catch (e) {}
  if (!SID) { SID = uuid(); try { localStorage.setItem('cdm_sid', SID); } catch (e) {} }
  function touchSeen() { try { localStorage.setItem('cdm_last_seen', String(Date.now())); } catch (e) {} }

  /* ---- per page opener -------------------------------------------------- */
  function pageKind() {
    var p = location.pathname.toLowerCase();
    if (/ai-search|visibility/.test(p)) return 'ai';
    if (/autopilot/.test(p)) return 'autopilot';
    if (/case-study/.test(p)) return 'proof';
    if (/faq/.test(p)) return 'faq';
    return 'home';
  }
  function nudgeText() {
    switch (pageKind()) {
      case 'ai': return 'Want to see if AI names your business yet?';
      case 'autopilot': return 'Want to see what it would write for you?';
      case 'proof': return 'Want the same tracker run on your site?';
      case 'faq': return 'Anything I can answer for you?';
      default: return 'Want to see where you stand in AI search?';
    }
  }
  function yesMessage() {
    switch (pageKind()) {
      case 'autopilot': return "Yes please, I'd like to see what it would write for my business.";
      case 'proof': return "Yes please, I'd like that run on my site.";
      default: return "Yes please, I'd like to know if AI is naming my business.";
    }
  }

  /* ---- styles ----------------------------------------------------------- */
  var CSS = [
    '.cdmc-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;',
    'gap:9px;padding:12px 18px;border:0;border-radius:999px;cursor:pointer;',
    'background:linear-gradient(135deg,#00C4F0,#6C47FF);color:#fff;font:600 14px/1 "DM Sans",system-ui,sans-serif;',
    'box-shadow:0 8px 26px rgba(0,0,0,.24);transition:transform .18s ease}',
    '.cdmc-btn:hover{transform:translateY(-2px)}',
    '.cdmc-btn svg{width:17px;height:17px;flex:none}',
    '.cdmc-badge{position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;border-radius:99px;',
    'background:#E5484D;color:#fff;font:700 11px/19px "DM Sans",system-ui,sans-serif;text-align:center}',
    '@keyframes cdmc-wig{0%,100%{transform:rotate(0)}25%{transform:rotate(-7deg)}75%{transform:rotate(7deg)}}',
    '.cdmc-wiggle{animation:cdmc-wig .55s ease 2}',
    '.cdmc-card{position:fixed;right:20px;bottom:78px;z-index:2147483000;max-width:270px;',
    'background:#fff;color:#16140F;border:1px solid #E4E2DC;border-radius:14px;padding:14px 15px;',
    'box-shadow:0 14px 40px rgba(0,0,0,.16);font:14px/1.45 "DM Sans",system-ui,sans-serif}',
    '.cdmc-card p{margin:0 0 10px}',
    '.cdmc-card button{border:0;border-radius:999px;padding:7px 13px;margin-right:7px;cursor:pointer;',
    'font:600 13px "DM Sans",system-ui,sans-serif}',
    '.cdmc-yes{background:#007B9B;color:#fff}.cdmc-no{background:#F0EFEb;color:#4A4840}',
    '.cdmc-panel{position:fixed;right:20px;bottom:20px;z-index:2147483001;width:372px;max-width:calc(100vw - 32px);',
    'height:560px;max-height:calc(100vh - 40px);display:none;flex-direction:column;background:#fff;',
    'border-radius:18px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.3);',
    'font:15px/1.5 "DM Sans",system-ui,sans-serif;color:#16140F}',
    '.cdmc-panel.open{display:flex}',
    '.cdmc-head{display:flex;align-items:center;gap:11px;padding:14px 16px;',
    'background:linear-gradient(135deg,#007B9B,#6C47FF);color:#fff}',
    '.cdmc-av{width:33px;height:33px;border-radius:50%;background:rgba(255,255,255,.2);',
    'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex:none}',
    '.cdmc-head h3{margin:0;font-size:15px;font-weight:600}',
    '.cdmc-head span{display:block;font-size:12px;opacity:.85}',
    '.cdmc-x{margin-left:auto;background:none;border:0;color:#fff;font-size:21px;cursor:pointer;line-height:1;padding:2px 4px}',
    '.cdmc-body{flex:1;overflow-y:auto;padding:16px;background:#F8F7F4}',
    '.cdmc-m{max-width:84%;margin:0 0 11px;padding:10px 13px;border-radius:15px;white-space:pre-wrap;word-wrap:break-word}',
    '.cdmc-them{background:#fff;border:1px solid #E4E2DC;border-bottom-left-radius:5px}',
    '.cdmc-me{background:#007B9B;color:#fff;margin-left:auto;border-bottom-right-radius:5px}',
    '.cdmc-m a{color:inherit}',
    '.cdmc-typing{display:flex;gap:4px;padding:11px 14px;background:#fff;border:1px solid #E4E2DC;',
    'border-radius:15px;width:fit-content;margin-bottom:11px}',
    '.cdmc-typing i{width:6px;height:6px;border-radius:50%;background:#B9B6AE;animation:cdmc-b 1.3s infinite}',
    '.cdmc-typing i:nth-child(2){animation-delay:.2s}.cdmc-typing i:nth-child(3){animation-delay:.4s}',
    '@keyframes cdmc-b{0%,60%,100%{opacity:.3}30%{opacity:1}}',
    '.cdmc-chips{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 12px}',
    '.cdmc-chips button{border:1px solid #007B9B;background:#fff;color:#007B9B;border-radius:999px;',
    'padding:7px 13px;font:500 13px "DM Sans",system-ui,sans-serif;cursor:pointer}',
    '.cdmc-chips button:hover{background:#007B9B;color:#fff}',
    '.cdmc-form{background:#fff;border:1px solid #E4E2DC;border-radius:15px;padding:14px;margin:0 0 12px}',
    '.cdmc-form h4{margin:0 0 3px;font-size:14px}',
    '.cdmc-form p{margin:0 0 10px;font-size:12.5px;color:#73706A}',
    '.cdmc-form label{display:block;font-size:12px;color:#4A4840;margin:0 0 3px}',
    '.cdmc-form input{width:100%;box-sizing:border-box;padding:9px 11px;margin:0 0 9px;',
    'border:1px solid #E0DED8;border-radius:9px;font:14px "DM Sans",system-ui,sans-serif;background:#fff;color:#16140F}',
    '.cdmc-form input:focus{outline:2px solid #00C4F0;outline-offset:-1px}',
    '.cdmc-form button{width:100%;border:0;border-radius:9px;padding:11px;cursor:pointer;',
    'background:#007B9B;color:#fff;font:600 14px "DM Sans",system-ui,sans-serif}',
    '.cdmc-err{color:#C42B2B;font-size:12px;margin:-5px 0 8px}',
    '.cdmc-foot{display:flex;gap:8px;padding:11px;border-top:1px solid #E4E2DC;background:#fff}',
    /* Two things fight us here, and both were seen live on the site.
       min-width:0 because a text input carries an intrinsic width of about 20
       characters, so without it the input refuses to shrink and shoves the send
       button onto its own line inside a 372px panel. box-sizing and an explicit
       flex basis because the host page styles bare input and button elements,
       and its padding was making the send button 56px wide inside a 41px box. */
    '.cdmc-foot input{flex:1 1 auto;min-width:0;box-sizing:border-box;padding:11px 13px;',
    'border:1px solid #E0DED8;border-radius:999px;',
    'font:14px "DM Sans",system-ui,sans-serif;background:#fff;color:#16140F}',
    '.cdmc-foot input:focus{outline:2px solid #00C4F0;outline-offset:-1px}',
    '.cdmc-send{border:0;border-radius:50%;flex:0 0 41px;width:41px;height:41px;padding:0;',
    'box-sizing:border-box;cursor:pointer;background:#007B9B;color:#fff;font-size:16px;line-height:1}',
    '.cdmc-send:disabled{opacity:.45;cursor:default}',
    '@media(max-width:480px){.cdmc-panel{right:0;bottom:0;width:100%;max-width:100%;height:100%;',
    'max-height:100%;border-radius:0}.cdmc-card{max-width:calc(100vw - 40px)}}'
  ].join('');

  /* ---- DOM -------------------------------------------------------------- */
  /* Everything below is built inside boot(), which runs on an idle callback.
     The CDM site scores 100 on every page and the widget is not allowed to be
     the thing that costs it a point, so nothing touches the DOM until the
     browser says it has finished the work that matters. */
  var style = document.createElement('style'); style.textContent = CSS;
  var launcher = document.createElement('button');
  launcher.className = 'cdmc-btn';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open the chat');
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-4.1A8.4 8.4 0 0 1 4 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8 8.4z"/></svg>' +
    '<span>Chat</span>';

  var panel = document.createElement('div');
  panel.className = 'cdmc-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat with Carpe DM Strategies');
  panel.innerHTML =
    '<div class="cdmc-head"><div class="cdmc-av">' + NAME.charAt(0) + '</div>' +
    '<div><h3>' + NAME + '</h3><span>Carpe DM Strategies</span></div>' +
    '<button class="cdmc-x" type="button" aria-label="Close the chat">&times;</button></div>' +
    '<div class="cdmc-body" id="cdmcBody"></div>' +
    '<form class="cdmc-foot" id="cdmcFoot" autocomplete="off">' +
    '<input id="cdmcIn" type="text" placeholder="Type your message" aria-label="Your message" maxlength="1000">' +
    '<button class="cdmc-send" type="submit" aria-label="Send">&#8593;</button></form>';

  var body = panel.querySelector('#cdmcBody');
  var input = panel.querySelector('#cdmcIn');
  var foot = panel.querySelector('#cdmcFoot');
  var sendBtn = panel.querySelector('.cdmc-send');

  var history = [];
  var opened = false;
  var busy = false;
  var nudged = false;
  var card = null;

  function scroll() { body.scrollTop = body.scrollHeight; }

  var URL_SPLIT = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  function addMsg(text, who) {
    var d = document.createElement('div');
    d.className = 'cdmc-m ' + (who === 'me' ? 'cdmc-me' : 'cdmc-them');
    String(text || '').split(URL_SPLIT).forEach(function (part) {
      if (URL_SPLIT.test(part)) {
        var a = document.createElement('a');
        a.href = part.indexOf('http') === 0 ? part : 'https://' + part;
        a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = part;
        d.appendChild(a);
      } else if (part) {
        d.appendChild(document.createTextNode(part));
      }
      URL_SPLIT.lastIndex = 0;
    });
    body.appendChild(d); scroll();
  }
  function typingOn() {
    var t = document.createElement('div');
    t.className = 'cdmc-typing';
    t.innerHTML = '<i></i><i></i><i></i>';
    body.appendChild(t); scroll();
    return t;
  }
  function clearExtras() {
    var c = body.querySelector('.cdmc-chips'); if (c) c.remove();
    var f = body.querySelector('.cdmc-form'); if (f) f.remove();
  }

  function renderChips(chips) {
    if (!chips || !chips.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'cdmc-chips';
    chips.slice(0, 4).forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = c.label;
      b.addEventListener('click', function () { wrap.remove(); send(c.message); });
      wrap.appendChild(b);
    });
    body.appendChild(wrap); scroll();
  }

  /* The details form. Values go straight to the server as `details`, never back
     through the conversation, so the spelling the visitor typed is the spelling
     that gets stored. */
  function renderForm(form) {
    if (!form || !form.fields || !form.fields.length) return;
    var wrap = document.createElement('form');
    wrap.className = 'cdmc-form';
    var html = '<h4>' + esc(form.title || 'Your details') + '</h4>';
    if (form.note) html += '<p>' + esc(form.note) + '</p>';
    form.fields.forEach(function (f) {
      var id = 'cdmc_' + f.name;
      html += '<label for="' + id + '">' + esc(f.label) + (f.required ? '' : ' (optional)') + '</label>' +
        '<input id="' + id + '" name="' + esc(f.name) + '" type="' + esc(f.type || 'text') + '"' +
        ' autocomplete="' + esc(f.auto || 'on') + '"' +
        (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') +
        (f.value ? ' value="' + esc(f.value) + '"' : '') +
        (f.required ? ' required' : '') + '>';
    });
    html += '<div class="cdmc-err" hidden></div><button type="submit">Send my details</button>';
    wrap.innerHTML = html;
    wrap.addEventListener('submit', function (e) {
      e.preventDefault();
      var details = {}, missing = [];
      form.fields.forEach(function (f) {
        var el = wrap.querySelector('[name="' + f.name + '"]');
        var v = (el && el.value || '').trim();
        if (f.required && !v) missing.push(f.label);
        if (v) details[f.name] = v;
      });
      var err = wrap.querySelector('.cdmc-err');
      if (missing.length) {
        err.hidden = false; err.textContent = 'Still needed: ' + missing.join(', ');
        return;
      }
      if (details.email && !/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(details.email)) {
        err.hidden = false; err.textContent = 'That email does not look quite right.';
        return;
      }
      wrap.remove();
      addMsg('Details sent', 'me');
      send('Here are my details.', details);
    });
    body.appendChild(wrap); scroll();
    var first = wrap.querySelector('input');
    if (first && window.innerWidth > 480) first.focus();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- network ---------------------------------------------------------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function post(payload, tries) {
    tries = tries || 3;
    var lastErr = null;
    for (var i = 0; i < tries; i++) {
      try {
        var res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) return await res.json();
        if (res.status === 429) return { reply: 'One moment, that was a lot at once. Try again in a minute.' };
        lastErr = new Error('http ' + res.status);
      } catch (e) { lastErr = e; }
      if (i < tries - 1) await sleep(700 * (i + 1));
    }
    throw lastErr || new Error('failed');
  }

  async function send(text, details) {
    if (busy) return;
    var trimmed = (text || '').trim();
    if (!trimmed) return;
    clearExtras();
    if (!details) addMsg(trimmed, 'me');
    history.push({ role: 'user', content: trimmed });
    if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
    busy = true; sendBtn.disabled = true; touchSeen();
    var dots = typingOn();
    try {
      var out = await post({
        session_id: SID,
        messages: history,
        details: details || null,
        landing_page: location.href.slice(0, 500),
        referrer: (document.referrer || '').slice(0, 500)
      });
      dots.remove();
      var reply = (out && out.reply) || "Sorry, that did not come through. Could you send it again?";
      addMsg(reply, 'them');
      history.push({ role: 'assistant', content: reply });
      if (out && out.form) renderForm(out.form);
      else if (out && out.chips) renderChips(out.chips);
    } catch (e) {
      dots.remove();
      addMsg("Something went wrong at my end. Email us at info@carpedmstrategies.co.uk and we will pick it up.", 'them');
    } finally {
      busy = false; sendBtn.disabled = false;
      if (window.innerWidth > 480) input.focus();
    }
  }

  /* ---- open / close ----------------------------------------------------- */
  function dismissCard() { if (card) { card.remove(); card = null; } }

  function open(opener) {
    dismissCard();
    launcher.classList.remove('cdmc-wiggle');
    var badge = launcher.querySelector('.cdmc-badge'); if (badge) badge.remove();
    panel.classList.add('open');
    launcher.style.display = 'none';
    if (!opened) {
      opened = true;
      addMsg(GREETING, 'them');
      history.push({ role: 'assistant', content: GREETING });
    }
    touchSeen();
    if (opener) send(opener);
    else if (window.innerWidth > 480) input.focus();
  }
  function close() {
    panel.classList.remove('open');
    launcher.style.display = '';
  }

  /* ---- one nudge, once -------------------------------------------------- */
  function nudge() {
    if (nudged || opened || panel.classList.contains('open')) return;
    try { if (sessionStorage.getItem('cdm_nudged') === '1') return; } catch (e) {}
    nudged = true;
    try { sessionStorage.setItem('cdm_nudged', '1'); } catch (e) {}

    launcher.classList.add('cdmc-wiggle');
    var b = document.createElement('span');
    b.className = 'cdmc-badge'; b.textContent = '1';
    launcher.appendChild(b);

    card = document.createElement('div');
    card.className = 'cdmc-card';
    card.innerHTML = '<p>' + esc(nudgeText()) + '</p>' +
      '<button class="cdmc-yes" type="button">Yes please</button>' +
      '<button class="cdmc-no" type="button">Not now</button>';
    card.querySelector('.cdmc-yes').addEventListener('click', function () { open(yesMessage()); });
    card.querySelector('.cdmc-no').addEventListener('click', dismissCard);
    document.body.appendChild(card);
  }

  /* ---- boot ------------------------------------------------------------- */
  function boot() {
    document.head.appendChild(style);
    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    launcher.addEventListener('click', function () { open(); });
    panel.querySelector('.cdmc-x').addEventListener('click', close);
    foot.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value; input.value = '';
      send(v);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.classList.contains('open')) close();
    });
    document.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget && e.clientY <= 0) nudge();
    });
    setTimeout(nudge, (pageKind() === 'home') ? 25000 : 15000);
  }

  if (window.requestIdleCallback) requestIdleCallback(boot, { timeout: 3000 });
  else setTimeout(boot, 1200);
})();
