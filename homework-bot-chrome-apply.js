// Runs inside Chrome's active tab. Fills answers and clicks the named button.
// Parameters substituted by Python:
//   __ANSWERS__ → JSON string literal of [{for, value}, ...]
//   __CLICK__   → JSON string literal of button id (or "")
(function () {
  var answers = JSON.parse(__ANSWERS__);
  var clickId = __CLICK__;

  function setValue(el, val) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, val);
    }
  }

  function flash(el) {
    var orig = el.style.boxShadow;
    el.style.transition = 'box-shadow .3s';
    el.style.boxShadow = '0 0 0 3px #00d4a0';
    setTimeout(function () { el.style.boxShadow = orig; }, 1000);
  }

  function clickReal(el) {
    var r = el.getBoundingClientRect();
    var init = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    try { el.focus(); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerType: 'mouse' }))); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerType: 'mouse' }))); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('click', init)); } catch (e) {}
    try { el.click(); } catch (e) {}
  }

  var applied = 0;
  for (var i = 0; i < answers.length; i++) {
    var ans = answers[i];
    var el = document.querySelector('[data-hwb-id="' + ans.for + '"]');
    if (!el) continue;
    try {
      el.scrollIntoView({ block: 'center' });
      if (el.tagName === 'SELECT') {
        var want = (ans.value || '').trim();
        var wantLow = want.toLowerCase();
        var chosen = -1;
        for (var j = 0; j < el.options.length; j++) {
          if (el.options[j].value === want) { chosen = j; break; }
        }
        if (chosen < 0) {
          for (var j = 0; j < el.options.length; j++) {
            var t = (el.options[j].textContent || '').trim();
            if (t === want || t.toLowerCase() === wantLow) { chosen = j; break; }
          }
        }
        if (chosen < 0) {
          for (var j = 0; j < el.options.length; j++) {
            var t2 = (el.options[j].textContent || '').trim().toLowerCase();
            if (t2.indexOf(wantLow) >= 0 || wantLow.indexOf(t2) >= 0) { chosen = j; break; }
          }
        }
        if (chosen >= 0) {
          try {
            var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
            setter.call(el, el.options[chosen].value);
          } catch (e) {}
          el.selectedIndex = chosen;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (el.type === 'radio' || el.type === 'checkbox') {
        if (!el.checked) clickReal(el);
      } else {
        el.focus();
        setValue(el, ans.value);
      }
      flash(el);
      applied++;
    } catch (e) { /* swallow */ }
  }

  if (clickId) {
    var btn = document.querySelector('[data-hwb-id="' + clickId + '"]');
    if (btn) {
      try { btn.scrollIntoView({ block: 'center' }); } catch (e) {}
      setTimeout(function () { clickReal(btn); }, 250);
      return 'OK:applied=' + applied + ',clicked=' + clickId;
    }
    return 'OK:applied=' + applied + ',no-btn=' + clickId;
  }
  return 'OK:applied=' + applied;
})();
