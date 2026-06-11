// Runs inside Chrome's active tab via AppleScript. Returns JSON with page info.
(function () {
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }
  function findLabel(el) {
    if (el.labels && el.labels[0]) return el.labels[0].innerText;
    var aria = el.getAttribute('aria-label');
    if (aria) return aria;
    if (el.id) {
      var lbl = document.querySelector('label[for="' + el.id + '"]');
      if (lbl) return lbl.innerText;
    }
    var wrap = el.closest('label');
    if (wrap) return wrap.innerText;
    var next = el.nextElementSibling;
    if (next && next.tagName !== 'INPUT') return next.innerText || '';
    return el.placeholder || '';
  }

  var inputs = [].slice.call(document.querySelectorAll(
    'input[type="text"],input[type="number"],input[type="search"],input:not([type]),textarea,[contenteditable="true"],[contenteditable=""]'
  )).filter(visible).slice(0, 30).map(function (el, i) {
    var id = 'hwb-i-' + i;
    el.setAttribute('data-hwb-id', id);
    return { id: id, label: clean(findLabel(el)).slice(0, 200), currentValue: clean(el.value || el.innerText || '').slice(0, 100) };
  });

  // Dropdowns (<select>)
  var placeholderRe = /^\(?\s*(select|choose|pick|please choose|please select|--|\.\.\.)\s*\)?$/i;
  var selects = [].slice.call(document.querySelectorAll('select'))
    .filter(visible).slice(0, 30).map(function (el, i) {
      var id = 'hwb-s-' + i;
      el.setAttribute('data-hwb-id', id);
      var opts = [].slice.call(el.options).slice(0, 40).map(function (o) {
        return { value: o.value || '', text: (o.textContent || '').trim().slice(0, 200) };
      });
      var sel = el.options[el.selectedIndex];
      var cur = sel ? (sel.textContent || '').trim() : '';
      var isPlaceholder = !cur || placeholderRe.test(cur) || (sel && !sel.value && el.selectedIndex === 0);
      return { id: id, label: clean(findLabel(el)).slice(0, 200), currentValue: isPlaceholder ? '' : cur.slice(0, 100), options: opts };
    });

  var radios = [].slice.call(document.querySelectorAll('input[type="radio"]')).filter(visible);
  var groupMap = {};
  radios.slice(0, 60).forEach(function (el, i) {
    var id = 'hwb-r-' + i;
    el.setAttribute('data-hwb-id', id);
    var name = el.name || '(no-name-' + i + ')';
    if (!groupMap[name]) groupMap[name] = { name: name, options: [] };
    groupMap[name].options.push({ id: id, label: clean(findLabel(el)).slice(0, 200) });
  });
  var radioGroups = Object.keys(groupMap).slice(0, 25).map(function (k) { return groupMap[k]; });

  var checkboxes = [].slice.call(document.querySelectorAll('input[type="checkbox"]'))
    .filter(visible).slice(0, 30).map(function (el, i) {
      var id = 'hwb-c-' + i;
      el.setAttribute('data-hwb-id', id);
      return { id: id, label: clean(findLabel(el)).slice(0, 200), checked: el.checked };
    });

  var buttons = [].slice.call(document.querySelectorAll(
    'button, input[type="submit"], input[type="button"], [role="button"]'
  )).filter(visible).slice(0, 40).map(function (el, i) {
    var id = 'hwb-b-' + i;
    el.setAttribute('data-hwb-id', id);
    var label = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim();
    return { id: id, label: clean(label).slice(0, 100) };
  });

  var main = document.querySelector('main, [role="main"], article, .question, .problem') || document.body;
  var text = clean(main.innerText || '').slice(0, 8000);

  return JSON.stringify({
    url: location.href,
    title: document.title,
    text: text,
    inputs: inputs,
    selects: selects,
    radioGroups: radioGroups,
    checkboxes: checkboxes,
    buttons: buttons
  });
})();
