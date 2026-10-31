/* =========================================================================
   @docmd/template-summer  —  summer.js
   Runtime interactions for the Summer template. Vanilla JS, no deps.

   What it does (the rest is handled by docmd-main.js, already loaded
   by templates/layout.ejs — see packages/ui/assets/js/docmd-main.js for
   SPA routing, theme toggle, sidebar drawer, version/project/language
   switchers, code-block copy, page copy, banner, cookie consent and
   search-trigger event delegation):

   Everything is idempotent — per-page wires re-run after every
   docmd:page-mounted event (fired by docmd-main.js on SPA nav).
   ========================================================================= */
(function () {
  'use strict';

  // -------- Utilities ----------------------------------------------------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function debounce(fn, wait) {
    let timer;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }


  // -------- TOC: SVG path track (Fumadocs-style) -----------------------

  var _tocActiveIdx = -1;
  var _tocScrollDir = 1; // 1 = down, -1 = up
  var _tocLastScrollY = window.pageYOffset || 0;

  function buildTocSvgTrack() {
    var list = $('.summer-toc__list');
    if (!list) return;
    var items = $$('.summer-toc__item', list);
    if (!items.length) return;

    // === Tweakable layout ===
    var BASE_X = 5;              // x position of level-1 items (px from track left)
    var INDENT = 7;              // px indent per level step

    // === Tweakable bend shape ===
    // Cubic Bézier between consecutive items at different indent levels.
    //   BEND_HORIZ_MULT — scales with the horizontal |Δx| (typical Δx = INDENT).
    //                     Higher = more curve per indent step.
    //   BEND_VERT_FRAC  — caps the bend as a fraction of the actual vertical
    //                     gap between item centres. 1.0 = max smooth S-curve,
    //                     < 1.0 = subtler. Must stay ≤ 1.0 to avoid overshoot.
    var BEND_HORIZ_MULT = 2.0;
    var BEND_VERT_FRAC  = 1.0;

    // Measure each item's actual centre y from the DOM. The track is
    // position:absolute at top:0 of the list, so list-relative coords match
    // track-local coords and the path lines up with the items exactly.
    var positions = items.map(function (li) {
      var lvl = parseInt(li.dataset.level || li.className.match(/level-(\d)/)?.[1] || '1', 10);
      return {
        x: BASE_X + (lvl - 1) * INDENT,
        cy: li.offsetTop + li.offsetHeight / 2
      };
    });
    var xPositions = positions.map(function (p) { return p.x; });
    var yCentres = positions.map(function (p) { return p.cy; });
    // Track height = full list content (top of list to bottom of last item)
    var totalH = items[items.length - 1].offsetTop + items[items.length - 1].offsetHeight;

    // Build the SVG path d-string
    var d = '';
    for (var i = 0; i < positions.length; i++) {
      var x = positions[i].x;
      var y = yCentres[i];
      if (i === 0) {
        d += 'M ' + x + ' 0 L ' + x + ' ' + y;
      } else {
        var px = positions[i - 1].x;
        var py = yCentres[i - 1];
        if (px === x) {
          // same level — straight line
          d += ' L ' + x + ' ' + y;
        } else {
          // level change — cubic bezier bend, clamped so the curve never
          // overshoots past the destination
          var gap = y - py;
          var bend = Math.min(gap * BEND_VERT_FRAC, Math.abs(x - px) * BEND_HORIZ_MULT);
          d += ' C ' + px + ' ' + (py + bend) + ' ' + x + ' ' + (y - bend) + ' ' + x + ' ' + y;
        }
      }
    }
    // extend to bottom
    var lastX = positions[positions.length - 1].x;
    d += ' L ' + lastX + ' ' + totalH;

    var svgW = BASE_X + (4 - 1) * INDENT + 4; // max possible width

    // Create track container
    var track = document.createElement('div');
    track.className = 'summer-toc__track';
    track.style.width = svgW + 'px';
    track.style.height = totalH + 'px';

    var NS = 'http://www.w3.org/2000/svg';

    // Full (grey) path
    var svgFull = document.createElementNS(NS, 'svg');
    svgFull.setAttribute('class', 'summer-toc__track-full');
    svgFull.setAttribute('width', svgW);
    svgFull.setAttribute('height', totalH);
    svgFull.setAttribute('viewBox', '0 0 ' + svgW + ' ' + totalH);
    var pathFull = document.createElementNS(NS, 'path');
    pathFull.setAttribute('d', d);
    svgFull.appendChild(pathFull);
    track.appendChild(svgFull);

    // Active (accent) path — clipped
    var svgActive = document.createElementNS(NS, 'svg');
    svgActive.setAttribute('class', 'summer-toc__track-active');
    svgActive.setAttribute('width', svgW);
    svgActive.setAttribute('height', totalH);
    svgActive.setAttribute('viewBox', '0 0 ' + svgW + ' ' + totalH);
    svgActive.style.clipPath = 'polygon(0 0, ' + svgW + 'px 0, ' + svgW + 'px 0, 0 0)';
    var pathActive = document.createElementNS(NS, 'path');
    pathActive.setAttribute('d', d);
    svgActive.appendChild(pathActive);
    track.appendChild(svgActive);

    list.insertBefore(track, list.firstChild);

    return { track: track, svgActive: svgActive, xPositions: xPositions, yCentres: yCentres, d: d, totalH: totalH, svgW: svgW };
  }

  function wireTocScrollSpy() {
    var tocLinks = $$('.summer-toc__link');
    if (!tocLinks.length) return;

    var headings = tocLinks
      .map(function (link) {
        var id = (link.getAttribute('href') || '').replace(/^#/, '');
        if (!id) return null;
        return { id: id, el: document.getElementById(id), link: link };
      })
      .filter(function (x) { return x && x.el; });

    if (!headings.length) return;

    var track = buildTocSvgTrack();

    function setActive(idx) {
      if (idx === _tocActiveIdx) return;
      _tocActiveIdx = idx;

      tocLinks.forEach(function (l) { l.classList.remove('active'); });
      if (idx < 0 || idx >= tocLinks.length) return;

      tocLinks[idx].classList.add('active');

      if (!track) return;

      var totalH = track.totalH;
      var svgW = track.svgW;

      // Fill from top down to the active item's centre Y.
      // If the user has scrolled to the bottom of the page (footer visible),
      // fill all the way to the bottom of the track so it doesn't appear cut off.
      var docH = document.documentElement.scrollHeight;
      var winH = window.innerHeight;
      var atPageBottom = (window.pageYOffset + winH) >= (docH - 40);
      var activeY = (atPageBottom || idx === tocLinks.length - 1)
        ? totalH
        : track.yCentres[idx];

      track.svgActive.style.clipPath =
        'polygon(0 0, ' + svgW + 'px 0, ' +
                svgW + 'px ' + activeY + 'px, 0 ' + activeY + 'px)';
    }

    // Scroll-spy using IntersectionObserver — each heading fills the TOC
    // as soon as it enters the viewport (visible = active).
    var TOPBAR_H = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--summer-topbar-height') || '64', 10
    );
    var SUBNAV_H = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--summer-subnav-height') || '44', 10
    );
    var rootMarginTop = -(TOPBAR_H + SUBNAV_H + 8) + 'px';

    // Build a map from heading id → index
    var idxMap = {};
    headings.forEach(function (h, i) { idxMap[h.id] = i; });

    // Track which headings are currently intersecting
    var visibleSet = {};

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          visibleSet[entry.target.id] = true;
        } else {
          delete visibleSet[entry.target.id];
        }
      });
      // Activate the last visible heading (lowest on screen = most advanced)
      var bestIdx = -1;
      headings.forEach(function (h, i) {
        if (visibleSet[h.id] && i >= bestIdx) bestIdx = i;
      });
      // Fallback: if nothing visible, find last heading above viewport
      if (bestIdx === -1) {
        for (var i = headings.length - 1; i >= 0; i--) {
          var rect = headings[i].el.getBoundingClientRect();
          if (rect.bottom < TOPBAR_H + SUBNAV_H + 8) { bestIdx = i; break; }
        }
      }
      if (bestIdx === -1 && headings.length) bestIdx = 0;
      setActive(bestIdx);
    }, {
      rootMargin: rootMarginTop + ' 0px -10% 0px',
      threshold: 0
    });

    headings.forEach(function (h) { observer.observe(h.el); });
    // Initial state
    updateActiveOnce();

    function updateActiveOnce() {
      var bestIdx = -1;
      for (var i = headings.length - 1; i >= 0; i--) {
        var rect = headings[i].el.getBoundingClientRect();
        if (rect.top <= TOPBAR_H + SUBNAV_H + 80) { bestIdx = i; break; }
      }
      if (bestIdx === -1 && headings.length) bestIdx = 0;
      setActive(bestIdx);
    }
  }

  function wireTocSmoothScroll() {
    $$('.summer-toc__link').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var href = link.getAttribute('href') || '';
        if (!href.startsWith('#')) return;
        var target = document.getElementById(href.slice(1));
        if (!target) return;
        e.preventDefault();
        var top = target.getBoundingClientRect().top + window.pageYOffset - 130;
        window.scrollTo({ top: top, behavior: 'smooth' });
        history.pushState(null, '', href);
      });
    });
  }

  // -------- Scroll to top button -----------------------------------------

  function wireDrawer() {
    // Hamburger toggle: the button lives in the topbar and carries
    // data-summer-sidebar-toggle (it also has .sidebar-menu-button which
    // the shared docmd-main.js handler picks up for the default
    // template; here we just mirror the open state on <body>).
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-summer-sidebar-toggle]')) {
        document.body.classList.toggle('summer-sidebar-open');
      }
    });

    // Close button: the X inside the drawer (data-summer-sidebar-close).
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-summer-sidebar-close]')) {
        document.body.classList.remove('summer-sidebar-open');
      }
    });

    // Outside click: the backdrop is a body::after pseudo-element so it
    // can't be a real click target. Close the drawer for any click that
    // is outside the sidebar and not on the toggle button.
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('summer-sidebar-open')) return;
      if (e.target.closest('.summer-sidebar')) return;
      if (e.target.closest('[data-summer-sidebar-toggle]')) return;
      document.body.classList.remove('summer-sidebar-open');
    });

    // Escape key closes the drawer.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('summer-sidebar-open')) {
        document.body.classList.remove('summer-sidebar-open');
      }
    });
  }

  function wireSearchToggle() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-summer-search-toggle]')) {
        var open = document.body.classList.toggle('summer-search-open');
        if (open) {
          var input = $('.summer-search-input');
          if (input) input.focus();
        }
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('summer-search-open')) {
        document.body.classList.remove('summer-search-open');
      }
    });
  }

  function wireScrollToTop() {
    var btn = $('.summer-totop');
    if (!btn) return;
    var onScroll = debounce(function () {
      var y = window.pageYOffset || document.documentElement.scrollTop;
      btn.classList.toggle('is-visible', y > 480);
    }, 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // -------- Inline Header Search & Dropdown ----------------------------

  function wireHeaderSearch() {
    var headerInput = $('.summer-search-input');
    if (!headerInput) return;

    var dropdown = $('.summer-search-dropdown');
    var resultsWrapper = $('.summer-search-results-wrapper');

    var indexInitialized = false;
    function initSearchIndex() {
      if (indexInitialized) return;
      indexInitialized = true;
      // Use programmatic click WITHOUT triggering focus shifts that would
      // scroll the page. We also restore our scroll position afterwards.
      var scrollY = window.pageYOffset;
      var trigger = $('.docmd-search-trigger, [data-docmd-search-trigger]');
      if (trigger) {
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      } else {
        var dummy = document.createElement('div');
        dummy.className = 'docmd-search-trigger';
        dummy.style.position = 'fixed';
        dummy.style.top = '0';
        dummy.style.left = '0';
        dummy.style.width = '1px';
        dummy.style.height = '1px';
        dummy.style.opacity = '0';
        dummy.style.pointerEvents = 'none';
        document.body.appendChild(dummy);
        dummy.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        // Don't remove — the plugin's listener may capture bubbles asynchronously
      }

      var modal = $('#docmd-search-modal');
      if (modal) {
        modal.style.setProperty('display', 'none', 'important');
      }

      // Restore scroll & refocus our header input (NOT the plugin's input)
      requestAnimationFrame(function () {
        window.scrollTo(0, scrollY);
        headerInput.focus({ preventScroll: true });
      });
    }

    function tryInitPluginSearch() {
      var searchModal = $('#docmd-search-modal');
      var pluginInput = $('#docmd-search-input');
      var pluginResults = $('#docmd-search-results');

      if (!searchModal || !pluginInput || !pluginResults) {
        setTimeout(tryInitPluginSearch, 100);
        return;
      }

      if (resultsWrapper && pluginResults.parentNode !== resultsWrapper) {
        resultsWrapper.appendChild(pluginResults);
      }

      // Force the modal off-screen and hidden permanently.
      searchModal.style.setProperty('position', 'fixed', 'important');
      searchModal.style.setProperty('top', '-9999px', 'important');
      searchModal.style.setProperty('left', '-9999px', 'important');
      searchModal.style.setProperty('display', 'none', 'important');
      searchModal.style.setProperty('opacity', '0', 'important');
      searchModal.style.setProperty('visibility', 'hidden', 'important');
      searchModal.style.setProperty('pointer-events', 'none', 'important');

      // Intercept any style mutation by search plugin trying to show the modal
      if (window.MutationObserver && !searchModal.__summerObserved) {
        searchModal.__summerObserved = true;
        var modalObserver = new MutationObserver(function () {
          if (searchModal.style.display !== 'none') {
            searchModal.style.setProperty('display', 'none', 'important');
          }
        });
        modalObserver.observe(searchModal, { attributes: true, attributeFilter: ['style', 'class'] });
      }

      // Make the plugin input also off-screen so it cannot grab focus
      pluginInput.tabIndex = -1;
      pluginInput.setAttribute('inert', '');
    }

    tryInitPluginSearch();

    headerInput.addEventListener('focus', function () {
      initSearchIndex();
      dropdown.style.display = 'block';
    });

    headerInput.addEventListener('input', function () {
      initSearchIndex();
      var pluginInput = $('#docmd-search-input');
      if (pluginInput) {
        pluginInput.value = headerInput.value;
        pluginInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      dropdown.style.display = 'block';
    });

    headerInput.addEventListener('keydown', function (e) {
      var pluginInput = $('#docmd-search-input');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        if (pluginInput) {
          var clone = new KeyboardEvent('keydown', {
            key: e.key,
            code: e.code,
            keyCode: e.keyCode,
            bubbles: true,
            cancelable: true
          });
          pluginInput.dispatchEvent(clone);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
          }
        }
      } else if (e.key === 'Escape') {
        headerInput.value = '';
        if (pluginInput) {
          pluginInput.value = '';
          pluginInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        headerInput.blur();
        dropdown.style.display = 'none';
      }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.summer-search-container')) {
        dropdown.style.display = 'none';
      }
    });

    document.addEventListener('keydown', function (e) {
      var isK = e.key === 'k' || e.key === 'K';
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        document.body.classList.add('summer-search-open');
        headerInput.focus();
      }
      if (e.key === '/' && !/^(input|textarea|select)$/i.test(e.target.tagName) && !e.target.isContentEditable) {
        e.preventDefault();
        document.body.classList.add('summer-search-open');
        headerInput.focus();
      }
    });
  }

  // -------- Git last-updated popover toggle (keyboard) ---------------
  // Hover is handled in CSS; this adds click + keyboard support so the
  // popover is reachable without a mouse.

  function wireGitPopover() {
    $$('.summer-pagefooter__time.has-commits').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var open = el.classList.toggle('open');
        el.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        } else if (e.key === 'Escape') {
          el.classList.remove('open');
          el.setAttribute('aria-expanded', 'false');
          el.blur();
        }
      });
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.summer-pagefooter__time.has-commits')) {
        $$('.summer-pagefooter__time.has-commits.open').forEach(function (el) {
          el.classList.remove('open');
          el.setAttribute('aria-expanded', 'false');
        });
      }
    });
  }

  // -------- Relative date rendering (lightweight) --------------------
  // Renders any [data-timestamp] as a human-readable relative date.
  // We avoid pulling in a date library for this tiny feature.

  function formatRelative(ts) {
    var now = Date.now();
    var diff = Math.max(0, now - ts);
    var sec = Math.floor(diff / 1000);
    if (sec < 45) return 'just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + ' min ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' hr ago';
    var day = Math.floor(hr / 24);
    if (day < 7) return day + ' day' + (day === 1 ? '' : 's') + ' ago';
    if (day < 30) {
      var wk = Math.floor(day / 7);
      return wk + ' week' + (wk === 1 ? '' : 's') + ' ago';
    }
    if (day < 365) {
      var mo = Math.floor(day / 30);
      return mo + ' month' + (mo === 1 ? '' : 's') + ' ago';
    }
    var yr = Math.floor(day / 365);
    return yr + ' year' + (yr === 1 ? '' : 's') + ' ago';
  }

  function renderRelativeTimestamps() {
    $$('[data-timestamp]').forEach(function (el) {
      var raw = el.getAttribute('data-timestamp');
      if (!raw) return;
      var ts = parseInt(raw, 10);
      if (!isFinite(ts) || ts <= 0) return;
      // Use a child span if one exists (git popover meta), else replace
      var target = el.querySelector('.git-time, .summer-git-popover__date') || el;
      if (target !== el && target.children.length > 0) return;
      if (!target.__renderedAt || (Date.now() - target.__renderedAt) > 60000) {
        target.textContent = formatRelative(ts);
        target.__renderedAt = Date.now();
      }
    });
  }

  // -------- Codeblocks -------------------------------------------------
  // docmd-main.js wraps every <pre> in <div class="code-wrapper"> and
  // appends a <button class="copy-code-button">. The parser also wraps
  // ```lang "title"``` in <div class="docmd-code-block-wrapper"> with a
  // header that holds the title. We turn the bottom-floating copy button
  // into a thin title bar at the top of the codeblock.
  //
  // Left side:
  //   - icon (always)
  //   - filename (only when the source had a title, e.g. ```js "file.js"```)
  //   - lang pill (always — shows the language, or "codeblock" if none)
  // Right side:
  //   - copy button
  function summerCodeblocks() {
    // 1. Codeblocks WITH a parser-rendered title wrapper.
    //    The header already exists with a <span class="docmd-code-block-title">.
    //    We add a lang pill next to it (or replace the header content
    //    with our own titlebar) and re-home the copy button.
    //
    //    Copy button location depends on how docmd-main.js wires it:
    //    - Parser title + no .code-wrapper sibling → button is appended
    //      directly into .docmd-code-block-wrapper
    //    - Parser title + .code-wrapper → button is inside .code-wrapper
    //    We handle both.
    $$('.docmd-code-block-wrapper').forEach(function (wrap) {
      if (wrap.dataset.summerCbWired === '1') return;
      wrap.dataset.summerCbWired = '1';

      var header = wrap.querySelector('.docmd-code-block-header');
      if (!header) return;
      var inner = wrap.querySelector('.code-wrapper');
      var copyBtn = wrap.querySelector('.copy-code-button');

      // Read language from the <code class="language-xxx">
      var lang = '';
      var pre = inner ? inner.querySelector('pre') : wrap.querySelector('pre');
      var code = pre ? pre.querySelector('code') : null;
      if (code) {
        var m = code.className.match(/language-([\w-]+)/);
        if (m) lang = m[1];
      }

      // Clear header and rebuild as our titlebar.
      // docmd-code-block-title already holds the filename (if set).
      var titleEl = header.querySelector('.docmd-code-block-title');
      var filename = titleEl ? titleEl.textContent : '';

      // Strip everything in the header and rebuild
      while (header.firstChild) header.removeChild(header.firstChild);
      header.classList.add('summer-cb__titlebar');

      // LEFT: icon + filename (if any) + lang pill
      var left = document.createElement('div');
      left.className = 'summer-cb__left';
      left.appendChild(makeFileIcon());
      if (filename) {
        var fname = document.createElement('span');
        fname.className = 'summer-cb__filename';
        fname.textContent = filename;
        left.appendChild(fname);
      }
      var pill = document.createElement('span');
      pill.className = 'summer-cb__lang';
      pill.textContent = lang || 'codeblock';
      left.appendChild(pill);
      header.appendChild(left);

      // RIGHT: copy button (re-home from inner wrapper)
      if (copyBtn) {
        copyBtn.classList.add('summer-cb__copy');
        header.appendChild(copyBtn);
      }
    });

    // 2. Codeblocks WITHOUT a parser title — build our own titlebar.
    $$('.code-wrapper').forEach(function (wrap) {
      if (wrap.dataset.summerCbWired === '1') return;
      // Skip ones already inside a parser wrapper (handled above).
      if (wrap.closest('.docmd-code-block-wrapper')) {
        wrap.dataset.summerCbWired = '1';
        return;
      }
      wrap.dataset.summerCbWired = '1';

      var pre = wrap.querySelector('pre');
      var copyBtn = wrap.querySelector('.copy-code-button');
      if (!pre) return;

      // Read language from <code class="language-xxx">
      var lang = '';
      var code = pre.querySelector('code');
      if (code) {
        var m = code.className.match(/language-([\w-]+)/);
        if (m) lang = m[1];
      }

      // Build header
      var header = document.createElement('div');
      header.className = 'summer-cb__titlebar';

      // LEFT: icon + lang pill (filename omitted — no source title).
      var left = document.createElement('div');
      left.className = 'summer-cb__left';
      left.appendChild(makeFileIcon());
      var pill = document.createElement('span');
      pill.className = 'summer-cb__lang';
      pill.textContent = lang || 'codeblock';
      left.appendChild(pill);
      header.appendChild(left);

      // RIGHT: copy button (re-home from wrapper bottom)
      if (copyBtn) {
        copyBtn.classList.add('summer-cb__copy');
        wrap.removeChild(copyBtn);
        header.appendChild(copyBtn);
      }

      // Insert header at the top of the wrapper
      wrap.insertBefore(header, wrap.firstChild);
      wrap.classList.add('summer-cb');
    });
  }

  // Build a small file-icon SVG (shared by both codeblock paths above).
  function makeFileIcon() {
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var icon = document.createElementNS(SVG_NS, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z');
    icon.appendChild(path);

    var polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('points', '14 2 14 8 20 8');
    icon.appendChild(polyline);

    return icon;
  }

  // -------- Init --------------------------------------------------------

  // Re-runnable body of init logic. Idempotent: every wire is guarded
  // with a data-attribute check so calling this twice is safe.
  //
  // Cross-cutting behaviour (theme toggle, sidebar drawer, version /
  // project / language switchers, code-block copy, page copy, banner
  // close, SPA router) is owned by packages/ui/assets/js/docmd-main.js,
  // already loaded by templates/layout.ejs. What stays here is the
  // summer-specific stuff: topbar search dropdown (re-homes the
  // docmd-search.js modal into the topbar), TOC scroll-spy, git commit
  // popover, scroll-to-top button, and relative-date rendering.
  function summerInit() {
    if (document.documentElement.dataset.summerWired !== '1') {
      // First run: bind document-level listeners + topbar/footer wires
      document.documentElement.dataset.summerWired = '1';
      wireDrawer();
      wireSearchToggle();
      wireScrollToTop();
      wireHeaderSearch();
    }
    // Per-page wires — always re-run after SPA nav (the page content
    // was swapped). The header search is also re-attempted on every
    // page so its polling can find a modal that didn't exist on the
    // first page (e.g. when docmd-search.js loads lazily).
    wireTocScrollSpy();
    wireTocSmoothScroll();
    summerCodeblocks();
    wireGitPopover();
    renderRelativeTimestamps();
  }

  ready(function () {
    // Mark HTML as ready (reveal the page even if docmd core is slow to set data-theme)
    document.documentElement.classList.add('summer-ready');
    summerInit();
    // Re-wire after SPA navigation (docmd core fires this on the document)
    document.addEventListener('docmd:page-mounted', summerInit);
  });
})();