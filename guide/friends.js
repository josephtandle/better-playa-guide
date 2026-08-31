/* Friends: last-known-location sharing between explicitly paired devices.
 * Offline-first: the friend list and their last addresses are cached in
 * localStorage and rendered instantly; the network refresh happens only when
 * there is signal. Privacy: see /api/friend.js header. MIT.
 */
(function(){
  'use strict';
  var $ = function(id){ return document.getElementById(id); };
  var LS = { consent: 'bpg.f.consent', name: 'bpg.f.name', secret: 'bpg.f.secret', cache: 'bpg.f.cache', sharing: 'bpg.f.sharing' };

  function getCid(){
    /* a DEDICATED friend id, never the ping/submission id: bpg.cid travels
       with pings so it is semi-public, and a public id could be pre-registered
       by someone else to impersonate you. bpg.fid never leaves this feature. */
    var cid = null;
    try { cid = localStorage.getItem('bpg.fid'); } catch(e){}
    if (!cid) {
      var a = new Uint8Array(12);
      (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function(_, i){ a[i] = Math.floor(Math.random() * 256); });
      cid = Array.from(a).map(function(b){ return 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]; }).join('');
      try { localStorage.setItem('bpg.fid', cid); } catch(e){}
    }
    return cid;
  }
  function getSecret(){
    var s = null;
    try { s = localStorage.getItem(LS.secret); } catch(e){}
    if (!s) {
      var a = new Uint8Array(24);
      (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function(_, i){ a[i] = Math.floor(Math.random() * 256); });
      s = Array.from(a).map(function(b){ return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]; }).join('');
      try { localStorage.setItem(LS.secret, s); } catch(e){}
    }
    return s;
  }
  function api(payload){
    payload.id = getCid();
    payload.secret = getSecret();
    payload.name = (localStorage.getItem(LS.name) || undefined);
    return fetch('/api/friend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function(r){ return r.json().then(function(j){ j.__status = r.status; return j; }); });
  }
  function online(){ return typeof navigator === 'undefined' || navigator.onLine !== false; }
  function myAddr(){
    try { var p = JSON.parse(localStorage.getItem('bpg.prefs') || '{}'); if (p.loc) return p.loc; } catch(e){}
    return null;
  }
  function fmtAgo(iso){
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!(m >= 0)) return '';
    if (m < 2) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 36) return h + 'h ago';
    return Math.round(h / 24) + ' days ago';
  }
  function note(msg){ var el = $('friends-note'); if (el) el.textContent = msg; }

  function renderFriends(list, fromCache){
    var box = $('friend-list');
    if (!box) return;
    if (!list || !list.length) {
      if (!fromCache) {
        box.innerHTML = '<p style="font-size:.88rem;color:var(--smoke)">No friends yet. Tap Invite a friend and send them the link.</p>';
        try { localStorage.setItem(LS.cache, '[]'); } catch(e){}
      }
      return;
    }
    box.innerHTML = '';
    list.forEach(function(f){
      var row = document.createElement('div');
      row.className = 'friend';
      var loc = f.addr ? (f.addr + ' · ' + fmtAgo(f.at)) : (f.muted ? 'muted' : 'no location shared yet');
      row.innerHTML = '<div><div class="friend-name"></div><div class="friend-loc"></div></div>' +
        '<div class="friend-actions"><button class="btn f-mute"></button> <button class="btn f-unfriend">Remove</button></div>';
      row.querySelector('.friend-name').textContent = f.name || 'A burner';
      row.querySelector('.friend-loc').textContent = loc;
      var mb = row.querySelector('.f-mute');
      mb.textContent = f.muted ? 'Unmute' : 'Mute';
      mb.setAttribute('data-mute', String(f.cid));
      row.querySelector('.f-unfriend').setAttribute('data-unfriend', String(f.cid));
      box.appendChild(row);
    });
    var lr = $('last-refresh');
    if (lr) lr.textContent = fromCache ? 'Showing your last synced list; refreshes when you catch signal.' : 'Refreshed just now.';
  }

  function refresh(){
    try { var cached = JSON.parse(localStorage.getItem(LS.cache) || 'null'); if (cached) renderFriends(cached, true); } catch(e){}
    if (!online()) return;
    api({ op: 'list' }).then(function(j){
      if (j && j.ok) {
        try { localStorage.setItem(LS.cache, JSON.stringify(j.friends)); } catch(e){}
        renderFriends(j.friends, false);
      }
    }).catch(function(){});
  }

  function pushLoc(){
    if (!online()) {
      try { localStorage.setItem('bpg.f.pending', '1'); } catch(e){}
      note('No signal: your change is queued and will apply the moment you catch signal.');
      return;
    }
    try { localStorage.removeItem('bpg.f.pending'); } catch(e){}
    var sharing = localStorage.getItem(LS.sharing) === 'on';
    api({ op: 'loc', addr: myAddr(), sharing: sharing }).then(function(j){
      if (j && j.ok) note(sharing ? ('Location shared' + (myAddr() ? ': ' + myAddr() : ' (set your location on the Find page for a real address)')) : 'Sharing is OFF; your location was cleared.');
    }).catch(function(){ note('Could not reach the playa mothership. Try when you have better signal.'); });
  }

  function setShareUI(){
    var on = localStorage.getItem(LS.sharing) === 'on';
    var t = $('share-toggle'), s = $('share-status');
    if (t) t.textContent = on ? 'ON' : 'OFF';
    if (s) s.textContent = on ? 'Friends can see your last known address.' : 'Nothing is shared and your stored location is cleared.';
  }

  function boot(){
    var consent = null;
    try { consent = localStorage.getItem(LS.consent); } catch(e){}
    var addMatch = /[#?&]add=([A-Za-z0-9]{6,12})/.exec(location.hash || location.search || '');

    if (addMatch) {
      $('accept-box').style.display = '';
      $('consent').style.display = 'none';
      var nameEl = $('accept-name');
      try { nameEl.value = localStorage.getItem(LS.name) || ''; } catch(e){}
      if (online()) {
        api({ op: 'peek', code: addMatch[1] }).then(function(j){
          if (j && j.ok) $('accept-text').textContent = 'Add ' + j.name + ' as a friend?';
          if (j && j.error === 'no_such_code') { $('accept-text').textContent = 'That invite code does not exist (or was mistyped).'; $('accept-yes').style.display = 'none'; }
        }).catch(function(){});
      } else {
        $('accept-text').textContent = 'Adding a friend needs a moment of signal. Keep this page open and tap Add friend when you have bars.';
      }
      $('accept-yes').addEventListener('click', function(){
        var nm = (nameEl.value || '').trim().slice(0, 40);
        if (nm) try { localStorage.setItem(LS.name, nm); } catch(e){}
        try { localStorage.setItem(LS.consent, '1'); } catch(e){}
        api({ op: 'accept', code: addMatch[1] }).then(function(j){
          if (j && j.ok) {
            note('You and ' + j.name + ' are now playa friends. Sharing is OFF until you turn it on above.');
            location.hash = '';
            $('accept-box').style.display = 'none';
            $('friends-ui').style.display = '';
            setShareUI(); refresh();
          } else if (j && j.error === 'own_code') { $('accept-text').textContent = 'That is your own invite link. Send it to a friend instead.'; }
          else { $('accept-text').textContent = 'Could not add: ' + ((j && j.error) || 'no signal') + '. Try again with signal.'; }
        }).catch(function(){ $('accept-text').textContent = 'No signal. Keep this open and try again when you have bars.'; });
      });
      $('accept-no').addEventListener('click', function(){ location.href = '/guide/'; });
      return;
    }

    if (!consent) { $('consent').style.display = ''; }
    else { $('friends-ui').style.display = ''; setShareUI(); refresh(); }

    $('consent-yes').addEventListener('click', function(){
      var nm = ($('my-name').value || '').trim().slice(0, 40);
      if (!nm) { $('my-name').placeholder = 'Give them a name to find you by'; return; }
      try { localStorage.setItem(LS.name, nm); localStorage.setItem(LS.consent, '1'); localStorage.setItem(LS.sharing, 'on'); } catch(e){}
      $('consent').style.display = 'none';
      $('friends-ui').style.display = '';
      setShareUI(); pushLoc(); refresh();
    });

    $('share-toggle').addEventListener('click', function(){
      var on = localStorage.getItem(LS.sharing) === 'on';
      try { localStorage.setItem(LS.sharing, on ? 'off' : 'on'); } catch(e){}
      setShareUI(); pushLoc();
    });

    $('invite-btn').addEventListener('click', function(){
      if (!online()) { note('Creating an invite needs a moment of signal.'); return; }
      api({ op: 'invite' }).then(function(j){
        if (j && j.ok) {
          var link = 'https://playaguide.musecafe.vip/guide/friends#add=' + j.code;
          $('invite-out').textContent = link;
          note('Heads up: ANYONE who taps this link and accepts becomes a friend and can see your shared address. Send it only to people you want.');
          if (navigator.share) { navigator.share({ title: 'Find me on playa', text: 'Add me on the Playa Guide so we can find each other:', url: link }).catch(function(){}); }
          else if (navigator.clipboard) { navigator.clipboard.writeText(link).then(function(){ note('Invite link copied. Send it any way you like.'); }).catch(function(){ note('Invite link ready above: copy and send it.'); }); }
        } else note('Could not create an invite: ' + ((j && j.error) || 'try again with signal'));
      }).catch(function(){ note('No signal right now. Try again when you have bars.'); });
    });

    $('update-loc-btn').addEventListener('click', pushLoc);

    document.addEventListener('click', function(ev){
      var m = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-mute');
      var u = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-unfriend');
      if (m) {
        var wasMuted = ev.target.textContent === 'Unmute';
        api({ op: 'mute', friend: m, muted: !wasMuted }).then(refresh).catch(function(){ note('Needs signal.'); });
      }
      if (u && confirm('Remove this friend? They will no longer see you, and you will not see them.')) {
        api({ op: 'unfriend', friend: u }).then(function(){
          try { var c = JSON.parse(localStorage.getItem(LS.cache) || '[]'); localStorage.setItem(LS.cache, JSON.stringify(c.filter(function(f){ return f.cid !== u; }))); } catch(e){}
          refresh();
        }).catch(function(){ note('Needs signal.'); });
      }
    });

    /* auto-push my location whenever this page opens with signal and sharing on */
    if (online() && consent) pushLoc();
  }

  /* a sharing change made offline applies automatically at next signal */
  try {
    window.addEventListener('online', function(){
      if (localStorage.getItem('bpg.f.pending') === '1' && localStorage.getItem(LS.consent)) pushLoc();
    });
  } catch(e){}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
