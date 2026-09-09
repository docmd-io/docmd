/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/core (and ecosystem)
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

/**
 * --------------------------------------------------------------------
 * docmd : Client-Side Application Logic (SPA Router & UI)
 * --------------------------------------------------------------------
 */

/* global CSS */

(function () {

  // Idempotency guard. Some servers (e.g. `serve` with SPA fallback) can
  // request this same script twice — once at the page-relative URL, once
  // at the site root — and both copies execute. Without this guard, every
  // click handler (toggle, SPA nav, copy code, etc.) would bind twice and
  // every nav action would fire two times, silently breaking the sidebar.
  if (window.__docmdMainLoaded) return;
  window.__docmdMainLoaded = true;

  function findTargetElement(hash) {
    if (!hash) return null;
    const cleanHash = hash.substring(1);
    if (!cleanHash) return null;
    try {
      let target = document.getElementById(cleanHash) || document.querySelector(hash);
      if (target) return target;
      target = document.querySelector('[id$="-' + CSS.escape(cleanHash) + '"]');
      if (target) return target;
    } catch (_e) { /* ignore */ }
    return null;
  }

  // 1. EVENT DELEGATION
  document.addEventListener('click', (e) => {
    // Collapsible Navigation
    // - Chevron (.collapse-icon-wrapper) click: always toggle, preventDefault.
    // - Dummy <span class="nav-group"> section divider: toggle, preventDefault.
    // - Real <a class="nav-group"> label click: navigate via SPA. The new
    //   page's sidebar auto-expands the active group, so parents that are
    //   pages themselves (e.g. "Syntax" with children) open as pages,
    //   not as collapsed sections.
    const navTrigger = e.target.closest('span.nav-group, a.nav-group, .collapse-icon-wrapper');
    if (navTrigger) {
      const item = navTrigger.closest('li.collapsible');
      const isChevron = navTrigger.classList.contains('collapse-icon-wrapper');
      const isDummySpan = navTrigger.tagName === 'SPAN';

      const shouldToggle = (isChevron || isDummySpan) && item;

      if (shouldToggle) {
        e.preventDefault();
        const isExpanded = item.classList.contains('expanded');
        item.classList.toggle('expanded', !isExpanded);
        item.setAttribute('aria-expanded', !isExpanded);
        if (isChevron) return;
      }
      // Real <a class="nav-group">: fall through to the SPA handler.
    }

    // Toggles
    if (e.target.closest('.toc-menu-button, .toc-title')) {
      document.querySelector('.toc-container')?.classList.toggle('mobile-expanded');
    }
    if (e.target.closest('.sidebar-menu-button')) {
      document.querySelector('.sidebar')?.classList.toggle('mobile-expanded');
    }
    if (e.target.closest('#sidebar-toggle-button')) {
      document.body.classList.toggle('sidebar-collapsed');
      localStorage.setItem('docmd-sidebar-collapsed', document.body.classList.contains('sidebar-collapsed'));
    }

    // Tabs System
    const tabItem = e.target.closest('.docmd-tabs-nav-item');
    if (tabItem) {
      const tabsContainer = tabItem.closest('.docmd-tabs');
      const navItems = Array.from(tabsContainer.querySelectorAll('.docmd-tabs-nav-item'));
      const tabPanes = Array.from(tabsContainer.querySelectorAll('.docmd-tab-pane'));
      const index = navItems.indexOf(tabItem);

      navItems.forEach(item => item.classList.remove('active'));
      tabPanes.forEach(pane => pane.classList.remove('active'));

      tabItem.classList.add('active');
      if (tabPanes[index]) tabPanes[index].classList.add('active');
    }

    function positionDropdown(container) {
      if (!container) return;
      const menu = container.querySelector('.version-dropdown-menu, .language-switcher-menu, .project-switcher-menu');
      if (!menu) return;
      // All sidebar, header, options-menu and menubar dropdowns are cleanly positioned by CSS
      if (container.closest('.sidebar, .sidebar-top-group, .sidebar-bottom-group, .sidebar-project-switcher-wrapper, .sidebar-version-wrapper, .sidebar-language-wrapper, .docmd-options-menu, .header-right, .menubar-options, .menubar-right, .summer-topbar__right, .summer-subnav__right') ||
          container.classList.contains('project-compact') ||
          container.classList.contains('language-compact')) {
        return;
      }

      menu.style.left = '';
      menu.style.right = '';
      menu.style.top = '';
      menu.style.bottom = '';

      if (!container.classList.contains('open')) return;

      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const viewportW = window.innerWidth || document.documentElement.clientWidth;
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        const margin = 12;

        if (rect.right > viewportW - margin) {
          menu.style.left = 'auto';
          menu.style.right = '0';
        } else if (rect.left < margin) {
          menu.style.left = '0';
          menu.style.right = 'auto';
        }

        if (rect.bottom > viewportH - margin && containerRect.top > rect.height + margin) {
          menu.style.top = 'auto';
          menu.style.bottom = 'calc(100% + 6px)';
        }
      });
    }

    // Version Dropdown Toggle
    const versionToggle = e.target.closest('.version-dropdown-toggle');
    if (versionToggle) {
      e.preventDefault();
      e.stopPropagation();
      const dropdown = versionToggle.closest('.docmd-version-dropdown');
      dropdown.classList.toggle('open');
      versionToggle.setAttribute('aria-expanded', dropdown.classList.contains('open'));
      positionDropdown(dropdown);
      // Close other switchers when opening version dropdown
      document.querySelectorAll('.docmd-language-switcher.open, .docmd-project-switcher.open').forEach(d => {
        d.classList.remove('open');
        const t = d.querySelector('.language-switcher-toggle, .project-switcher-toggle');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
      return;
    }

    // Sticky Version Switching (Path Preservation)
    const versionLink = e.target.closest('.version-dropdown-item');
    if (versionLink) {
      if (window.location.protocol === 'file:') {
        return;
      }
      e.preventDefault(); // Prevent default link behavior immediately
      const targetRoot = versionLink.dataset.versionRoot;
      // Use global fallback if undefined (e.g. on 404 pages)
      let currentRoot = window.DOCMD_VERSION_ROOT || '/';

      if (targetRoot && window.location.pathname) {
        let currentPath = window.location.pathname;

        // Adjust currentRoot to include the runtime base path if it doesn't already
        const runtimeBase = (window.DOCMD_BASE || '/').replace(/\/$/, '') + '/';
        let adjustedBase = runtimeBase;
        if (runtimeBase !== '/' && !currentPath.startsWith(runtimeBase)) {
          const baseSegments = runtimeBase.split('/').filter(Boolean);
          if (baseSegments.length === 1) {
            adjustedBase = '/';
          } else {
            let suffix = '';
            for (let i = baseSegments.length - 1; i >= 0; i--) {
              const candidate = '/' + baseSegments.slice(i).join('/') + '/';
              if (currentPath.indexOf(candidate) !== -1) {
                suffix = candidate;
                break;
              }
            }
            if (suffix) {
              adjustedBase = suffix;
            }
          }
        }
        if (currentRoot.startsWith('/')) {
          currentRoot = adjustedBase + currentRoot.substring(1);
        }

        const normCurrentRoot = currentRoot.endsWith('/') ? currentRoot : currentRoot + '/';

        // Only try sticky if we are actually INSIDE the known version path
        if (currentPath.startsWith(normCurrentRoot)) {
          const suffix = currentPath.substring(normCurrentRoot.length);
          const normTargetRoot = targetRoot.endsWith('/') ? targetRoot : targetRoot + '/';
          let targetHref = normTargetRoot + suffix + window.location.hash;
          targetHref = targetHref.replace(/([^:])\/{2,}/g, '$1/'); // Prevent double slashes

          // Smart Switcher: Check if the exact page exists in the target version
          fetch(targetHref, { method: 'HEAD' })
            .then(response => {
              const finalHref = response.ok ? targetHref : normTargetRoot;
              if (typeof window.docmdNavigate === 'function' && document.body.dataset.spaEnabled === 'true' && window.location.protocol !== 'file:') {
                window.docmdNavigate(finalHref);
              } else {
                window.location.href = finalHref;
              }
            })
            .catch(() => {
              if (typeof window.docmdNavigate === 'function' && document.body.dataset.spaEnabled === 'true' && window.location.protocol !== 'file:') {
                window.docmdNavigate(normTargetRoot);
              } else {
                window.location.href = normTargetRoot;
              }
            });
          return;
        }
      }
      // If we are outside the root (or targetRoot is missing), just use the href defined in the link
      if (typeof window.docmdNavigate === 'function' && document.body.dataset.spaEnabled === 'true' && window.location.protocol !== 'file:') {
        window.docmdNavigate(versionLink.href);
      } else {
        window.location.href = versionLink.href;
      }
    }

    // Close Dropdown if clicked outside
    if (!e.target.closest('.docmd-version-dropdown')) {
      document.querySelectorAll('.docmd-version-dropdown.open').forEach(d => {
        d.classList.remove('open');
        d.querySelector('.version-dropdown-toggle').setAttribute('aria-expanded', 'false');
      });
    }
    if (!e.target.closest('.docmd-language-switcher')) {
      document.querySelectorAll('.docmd-language-switcher.open').forEach(d => {
        d.classList.remove('open');
        d.querySelector('.language-switcher-toggle').setAttribute('aria-expanded', 'false');
      });
    }
    if (!e.target.closest('.docmd-project-switcher')) {
      document.querySelectorAll('.docmd-project-switcher.open').forEach(d => {
        d.classList.remove('open');
        d.querySelector('.project-switcher-toggle').setAttribute('aria-expanded', 'false');
      });
    }
    const langToggle = e.target.closest('.language-switcher-toggle');
    if (langToggle) {
      e.preventDefault();
      e.stopPropagation();
      const dropdown = langToggle.closest('.docmd-language-switcher');
      dropdown.classList.toggle('open');
      langToggle.setAttribute('aria-expanded', dropdown.classList.contains('open'));
      positionDropdown(dropdown);
      // Close version dropdown when opening language switcher
      document.querySelectorAll('.docmd-version-dropdown.open, .docmd-project-switcher.open').forEach(d => {
        d.classList.remove('open');
        const t = d.querySelector('.version-dropdown-toggle, .project-switcher-toggle');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
      return;
    }

    const projectToggle = e.target.closest('.project-switcher-toggle');
    if (projectToggle) {
      e.preventDefault();
      e.stopPropagation();
      const dropdown = projectToggle.closest('.docmd-project-switcher');
      dropdown.classList.toggle('open');
      projectToggle.setAttribute('aria-expanded', dropdown.classList.contains('open'));
      positionDropdown(dropdown);
      // Close other dropdowns
      document.querySelectorAll('.docmd-version-dropdown.open, .docmd-language-switcher.open').forEach(d => {
        d.classList.remove('open');
        const t = d.querySelector('.version-dropdown-toggle, .language-switcher-toggle');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
      return;
    }

    // Language Switcher Navigation (dynamic URL like version switching)
    const langLink = e.target.closest('.language-switcher-item');
    if (langLink) {
      if (window.location.protocol === 'file:') {
        return;
      }
      e.preventDefault();

      // Skip disabled locales (no content available)
      if (langLink.classList.contains('disabled') || langLink.getAttribute('aria-disabled') === 'true') {
        return;
      }

      var localeId = langLink.dataset.localeId;
      if (localeId) {
        try { localStorage.setItem('docmd-locale', localeId); } catch { /* storage unavailable */ }
      }

      // Compute target URL preserving current page path
      var base = (window.DOCMD_BASE || '/').replace(/\/$/, '') + '/';
      var currentLocale = window.DOCMD_LOCALE || '';
      var defaultLocale = window.DOCMD_DEFAULT_LOCALE || '';
      var currentPath = window.location.pathname;

      // Adjust base for local preview server / dev server if workspace base is missing
      if (base !== '/' && !currentPath.startsWith(base)) {
        const baseSegments = base.split('/').filter(Boolean);
        if (baseSegments.length === 1) {
          base = '/';
        } else {
          let suffix = '';
          for (let i = baseSegments.length - 1; i >= 0; i--) {
            const candidate = '/' + baseSegments.slice(i).join('/') + '/';
            if (currentPath.indexOf(candidate) !== -1) {
              suffix = candidate;
              break;
            }
          }
          if (suffix) {
            base = suffix;
          }
        }
      }

      // Strip base from current path
      if (base !== '/' && currentPath.startsWith(base)) {
        currentPath = currentPath.substring(base.length);
      } else if (currentPath.startsWith('/')) {
        currentPath = currentPath.substring(1);
      }

      // Strip current locale prefix from path (ensuring we handle the leading slash)
      var pathWithoutBase = currentPath;
      if (currentLocale && currentLocale !== defaultLocale) {
        var localePrefix = currentLocale + '/';
        if (pathWithoutBase.startsWith(localePrefix)) {
          pathWithoutBase = pathWithoutBase.substring(localePrefix.length);
        }
      }
      currentPath = pathWithoutBase;

      // Build new path with target locale prefix
      var targetLocPrefix = (localeId && localeId !== defaultLocale) ? localeId + '/' : '';
      var targetHref = base + targetLocPrefix + currentPath;

      // Optional manifest-based UX: if the build-time manifest is loaded AND
      // it knows about this specific page, redirect to the locale root when
      // the page isn't translated. This is only an optimisation — the target
      // page is still the canonical answer and the server will return 404 if
      // the page genuinely doesn't exist there.
      var manifest = window.DOCMD_LOCALE_PAGES;
      if (manifest && manifest[localeId] && Array.isArray(manifest[localeId]) && manifest[localeId].length > 0) {
        var lookupPath = '/' + currentPath.replace(/\/$/, '').replace(/\/index\.html$/, '');
        if (lookupPath === '/') lookupPath = '/';
        if (manifest[localeId].indexOf(lookupPath) === -1) {
          // Page is not translated — fall back to the locale root. For the
          // default locale the "locale root" IS the site root, so this
          // naturally sends the user to the homepage, which is the
          // expected behaviour when switching to the default.
          targetHref = base + targetLocPrefix;
        }
      }

      const finalHref = targetHref + window.location.hash;
      if (typeof window.docmdNavigate === 'function' && document.body.dataset.spaEnabled === 'true' && window.location.protocol !== 'file:') {
        window.docmdNavigate(finalHref);
      } else {
        window.location.href = finalHref;
      }
      return;
    }

    // Copy Code Button
    // Copy Code Button
    const copyBtn = e.target.closest('.copy-code-button');
    if (copyBtn) {
      // Look for the associated <code> in the immediate .code-wrapper,
      // or in the nearest codeblock-shaped wrapper. Templates like
      // `summer` re-home the copy button into a title bar that lives
      // outside .code-wrapper (e.g. inside .docmd-code-block-wrapper
      // for ```lang "title"``` blocks) — fall back to that parent
      // wrapper's <pre><code> in that case.
      const code = copyBtn.closest('.code-wrapper')?.querySelector('code')
        || copyBtn.closest('.docmd-code-block-wrapper, .summer-cb, .summer-codeblock')?.querySelector('pre code');
      if (code) {
        navigator.clipboard.writeText(code.innerText).then(() => {
          copyBtn.classList.add('copied');
          // Update icon to checkmark
          copyBtn.innerHTML = ''; // Safe to clear
          const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          checkSvg.setAttribute('width', '16');
          checkSvg.setAttribute('height', '16');
          checkSvg.setAttribute('viewBox', '0 0 24 24');
          checkSvg.setAttribute('fill', 'none');
          checkSvg.setAttribute('stroke', 'currentColor');
          checkSvg.setAttribute('stroke-width', '2');
          checkSvg.setAttribute('stroke-linecap', 'round');
          checkSvg.setAttribute('stroke-linejoin', 'round');
          checkSvg.classList.add('lucide', 'lucide-check');
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          polyline.setAttribute('points', '20 6 9 17 4 12');
          checkSvg.appendChild(polyline);
          copyBtn.appendChild(checkSvg);

          setTimeout(() => {
            copyBtn.classList.remove('copied');
            // Revert icon to copy
            copyBtn.innerHTML = ''; 
            copyBtn.appendChild(createCopySvg());
          }, 2000);
        });
      }
    }

    function parseFrontmatter(markdown) {
      const trimmed = markdown.trim();
      const meta = {};
      let body = trimmed;
      if (trimmed.startsWith('---')) {
        const nextSeparator = trimmed.indexOf('---', 3);
        if (nextSeparator !== -1) {
          const fmText = trimmed.substring(3, nextSeparator);
          body = trimmed.substring(nextSeparator + 3).trim();
          const lines = fmText.split('\n');
          for (const line of lines) {
            const colonIdx = line.indexOf(':');
            if (colonIdx !== -1) {
              const key = line.substring(0, colonIdx).trim();
              let val = line.substring(colonIdx + 1).trim();
              if (val.startsWith('"') && val.endsWith('"')) {
                val = val.substring(1, val.length - 1);
              } else if (val.startsWith("'") && val.endsWith("'")) {
                val = val.substring(1, val.length - 1);
              }
              meta[key] = val;
            }
          }
        }
      }
      return { meta, body };
    }

    // Copy Raw Markdown Button
    const rawCopyBtn = e.target.closest('.docmd-copy-raw-btn');
    if (rawCopyBtn) {
      const rawEl = document.getElementById('docmd-raw-markdown');
      if (rawEl) {
        const rawContent = decodeURIComponent(rawEl.getAttribute('data-content') || '');
        const { body } = parseFrontmatter(rawContent);
        navigator.clipboard.writeText(body).then(() => {
          const btnText = rawCopyBtn.querySelector('.docmd-btn-text');
          const originalText = btnText ? btnText.textContent : 'Copy Markdown';
          const copiedText = rawCopyBtn.getAttribute('data-copied') || 'Copied!';
          if (btnText) btnText.textContent = copiedText;
          rawCopyBtn.classList.add('copied');
          setTimeout(() => {
            if (btnText) btnText.textContent = originalText;
            rawCopyBtn.classList.remove('copied');
          }, 2000);
        });
      }
    }

    // Copy Context Button
    const contextCopyBtn = e.target.closest('.docmd-copy-context-btn');
    if (contextCopyBtn) {
      const rawEl = document.getElementById('docmd-raw-markdown');
      if (rawEl) {
        const rawContent = decodeURIComponent(rawEl.getAttribute('data-content') || '');
        const { meta, body } = parseFrontmatter(rawContent);
        const title = document.title || '';
        const descMeta = document.querySelector('meta[name="description"]');
        const desc = descMeta ? descMeta.getAttribute('content') || '' : '';
        
        let contextStr = `Source URL: ${window.location.href}\nTitle: ${title}\n`;
        if (desc) {
          contextStr += `Description: ${desc}\n`;
        }
        if (Object.keys(meta).length > 0) {
          contextStr += `\nMetadata:\n`;
          for (const [k, v] of Object.entries(meta)) {
            contextStr += `- ${k}: ${v}\n`;
          }
        }
        contextStr += `\n---\n\n${body}`;

        navigator.clipboard.writeText(contextStr).then(() => {
          const btnText = contextCopyBtn.querySelector('.docmd-btn-text');
          const originalText = btnText ? btnText.textContent : 'Copy Context';
          const copiedText = contextCopyBtn.getAttribute('data-copied') || 'Copied!';
          if (btnText) btnText.textContent = copiedText;
          contextCopyBtn.classList.add('copied');
          setTimeout(() => {
            if (btnText) btnText.textContent = originalText;
            contextCopyBtn.classList.remove('copied');
          }, 2000);
        });
      }
    }

    // Hero Slider
    const sliderBtn = e.target.closest('.hero-slider-btn, .hero-slider-dot');
    if (sliderBtn) {
      const hero = sliderBtn.closest('.docmd-hero.hero-slider');
      if (!hero) return;
      const track = hero.querySelector('.hero-slider-track');
      const slides = hero.querySelectorAll('.hero-slide');
      const dots = hero.querySelectorAll('.hero-slider-dot');
      if (!track || !slides.length) return;

      const slideWidth = slides[0].offsetWidth;
      const currentIndex = Math.round(track.scrollLeft / slideWidth);
      let targetIndex = currentIndex;

      if (sliderBtn.classList.contains('hero-slider-prev')) {
        targetIndex = (currentIndex - 1 + slides.length) % slides.length;
      } else if (sliderBtn.classList.contains('hero-slider-next')) {
        targetIndex = (currentIndex + 1) % slides.length;
      } else if (sliderBtn.classList.contains('hero-slider-dot')) {
        targetIndex = parseInt(sliderBtn.dataset.slide, 10);
      }

      track.scrollTo({ left: targetIndex * slideWidth, behavior: 'smooth' });
      dots.forEach((d, i) => d.classList.toggle('active', i === targetIndex));
    }

  });

  function createCopySvg() {
    const copySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    copySvg.setAttribute('width', '16');
    copySvg.setAttribute('height', '16');
    copySvg.setAttribute('viewBox', '0 0 24 24');
    copySvg.setAttribute('fill', 'none');
    copySvg.setAttribute('stroke', 'currentColor');
    copySvg.setAttribute('stroke-width', '2');
    copySvg.setAttribute('stroke-linecap', 'round');
    copySvg.setAttribute('stroke-linejoin', 'round');
    copySvg.classList.add('lucide', 'lucide-copy');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '14');
    rect.setAttribute('height', '14');
    rect.setAttribute('x', '8');
    rect.setAttribute('y', '8');
    rect.setAttribute('rx', '2');
    rect.setAttribute('ry', '2');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2');
    copySvg.appendChild(rect);
    copySvg.appendChild(path);
    return copySvg;
  }

  // 2. COMPONENT INITIALIZERS
  function injectCopyButtons() {
    if (document.body.dataset.copyCodeEnabled !== 'true') return;

    document.querySelectorAll('pre').forEach(preElement => {
      const outerWrapper = preElement.closest('.docmd-code-block-wrapper');
      if (outerWrapper && outerWrapper.querySelector(':scope > .copy-code-button, :scope > .docmd-code-block-header > .copy-code-button')) return;

      // Choose a host that gives the absolutely-positioned button a
      // sensible anchor. The CSS positions the button at top: .85rem;
      // right: .5rem of its containing positioned element.
      //
      // Titled case (```lang "title"```): the <pre> sits inside a
      // .docmd-code-block-wrapper that also contains a header strip.
      // Anchoring the button to the wrapper would land it on top of
      // the header — wrong place. Anchor to the header instead: the
      // header is `display: flex` with the title on the left, and a
      // button appended to it lands cleanly on the right.
      //
      // Untitled case: the <pre> has no positioned ancestor. Wrap
      // it in a `.code-wrapper` that we then position:relative so
      // the button anchors inside the code area.
      let host = null;
      if (outerWrapper) {
        const header = outerWrapper.querySelector(':scope > .docmd-code-block-header');
        if (header) {
          header.classList.add('has-copy-button');
          host = header;
        }
      }
      if (!host) {
        const wrapper = document.createElement('div');
        wrapper.className = 'code-wrapper';
        wrapper.style.position = 'relative';
        preElement.parentNode.insertBefore(wrapper, preElement);
        wrapper.appendChild(preElement);
        host = wrapper;
      }
      if (host.querySelector(':scope > .copy-code-button')) return;

      const copyButton = document.createElement('button');
      copyButton.className = 'copy-code-button';
      copyButton.appendChild(createCopySvg());
      copyButton.title = "Copy code";
      host.appendChild(copyButton);
    });
  }

  function initializeHeroSliders() {
    document.querySelectorAll('.docmd-hero.hero-slider').forEach(hero => {
      const track = hero.querySelector('.hero-slider-track');
      const dots = hero.querySelectorAll('.hero-slider-dot');
      if (!track || !dots.length) return;

      // Sync dots on scroll (handles touch/swipe)
      track.addEventListener('scroll', () => {
        const slides = hero.querySelectorAll('.hero-slide');
        if (!slides.length) return;
        const idx = Math.round(track.scrollLeft / slides[0].offsetWidth);
        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
      }, { passive: true });
    });
  }

  let scrollObserver = null;
  let lastActiveId = null;
  let scrollTimeout = null;
  
  function initializeScrollSpy() {
    if (scrollObserver) scrollObserver.disconnect();
    const tocLinks = document.querySelectorAll('.toc-link');
    const headings = document.querySelectorAll('.main-content h1, .main-content h2, .main-content h3, .main-content h4');
    const tocContainer = document.querySelector('.toc-sidebar');

    if (tocLinks.length === 0 || headings.length === 0) return;

    scrollObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          
          // Skip if this is already the active item
          if (id === lastActiveId) return;
          lastActiveId = id;
          
          tocLinks.forEach(link => link.classList.remove('active'));
          const activeLink = document.querySelector(`.toc-link[href="#${id}"]`);

          if (activeLink) {
            activeLink.classList.add('active');
            if (tocContainer) {
              // Debounce scroll to prevent jittery behavior
              if (scrollTimeout) clearTimeout(scrollTimeout);
              scrollTimeout = setTimeout(() => {
                const linkRect = activeLink.getBoundingClientRect();
                const containerRect = tocContainer.getBoundingClientRect();
                const scrollTop = activeLink.offsetTop - (containerRect.height / 2) + (linkRect.height / 2);
                tocContainer.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
              }, 100);
            }
          }
        }
      });
    }, { rootMargin: '-15% 0px -80% 0px', threshold: 0 });

    headings.forEach(h => scrollObserver.observe(h));
  }

  function updateTocClass() {
    const hasToc = document.querySelector('.toc-link, .summer-toc__link') !== null;
    if (hasToc) {
      document.body.classList.remove('no-toc');
    } else {
      document.body.classList.add('no-toc');
    }
  }


  function executeScripts(container) {
    container.querySelectorAll('script').forEach(oldScript => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.text = oldScript.innerHTML;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }

  // 3. TARGETED SPA ROUTER
  function initializeSPA() {
    if (location.protocol === 'file:') return;
    if (document.body.dataset.spaEnabled !== 'true') return;

    // Convert all initial relative assets in head to absolute URLs to prevent
    // dynamic base resolution issues during SPA pushState / popstate updates.
    // Use the DOM `href` property (already resolved against any <base href>) —
    // NOT getAttribute('href') which returns the raw unresolved string and
    // would re-resolve against window.location.href, dropping the deploy path
    // for nested pages (e.g. /beta-test/guide/ → strips /beta-test/ prefix).
    const assetSelectors = 'link[rel="stylesheet"], link[rel="icon"], link[rel="shortcut icon"]';
    document.querySelectorAll(assetSelectors).forEach(asset => {
      const resolved = asset.href;
      if (resolved && resolved !== asset.getAttribute('href')) {
        asset.setAttribute('href', resolved);
      }
    });

    let currentPath = window.location.pathname;
    const pageCache = new Map();
    let prefetchTimer = null;

    // Intent-based Hover Prefetching
    document.addEventListener('mouseover', (e) => {
      const link = e.target.closest('.sidebar-nav a, .page-navigation a, .page-footer a, .main-content a');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

      const url = new URL(link.href).href;
      if (new URL(url).origin !== location.origin) return;
      if (pageCache.has(url)) return;

      // Wait 65ms to ensure the user actually intends to click
      clearTimeout(prefetchTimer);
      prefetchTimer = setTimeout(() => {
        // Prefetch using hash-stripped URL - the fragment is never sent to the server
        const prefetchUrl = new URL(link.href);
        const prefetchFetchUrl = prefetchUrl.origin + prefetchUrl.pathname + prefetchUrl.search;
        if (pageCache.has(prefetchFetchUrl)) return;
        pageCache.set(prefetchFetchUrl, fetch(prefetchFetchUrl).then(res => {
          if (!res.ok) throw new Error('Prefetch failed');
          return { html: res.text(), finalUrl: res.url };
        }).catch(() => pageCache.delete(prefetchFetchUrl)));
      }, 65);
    });

    // Cancel prefetch if the mouse leaves before the 65ms "intent" delay
    document.addEventListener('mouseout', () => clearTimeout(prefetchTimer));

    document.addEventListener('click', async (e) => {
      if (e.target.closest('.collapse-icon-wrapper')) return;

      if (e.target.closest('[data-spa-ignore], .language-switcher-item, .version-dropdown-item')) return;

      const link = e.target.closest('.sidebar-nav a, .page-navigation a, .page-footer a, .main-content a');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

      // Real <a class="nav-group"> links navigate normally via SPA. The
      // toggle handler above only prevents default for dummy <span>s and
      // chevron clicks, so this branch is safe to fall through.

      const url = new URL(link.href);
      if (url.origin !== location.origin) return;

      // Same-page hash navigation: scroll to the target element smoothly
      // without a full SPA fetch. The browser's native behaviour doesn't
      // fire reliably after a previous pushState, so we handle it manually.
      if (url.pathname === window.location.pathname && url.hash) {
        e.preventDefault();
        history.pushState({}, '', url.href);
        const target = findTargetElement(url.hash);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
        return;
      }

      e.preventDefault();
      await navigateTo(url.href);
    });

    window.addEventListener('popstate', () => {
      // Same-page hash change via browser back/forward
      if (window.location.pathname === currentPath) {
        const hash = window.location.hash;
        if (hash) {
          const target = findTargetElement(hash);
          if (target) target.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }
      navigateTo(window.location.href, false);
    });

    async function navigateTo(url, pushHistory = true) {
      const layout = document.querySelector('.content-layout');

      try {
        if (layout) layout.style.minHeight = layout.getBoundingClientRect().height + 'px';

        // Separate hash from the fetch URL - servers don't receive fragments,
        // and res.url (finalUrl) will never contain the hash. We preserve it
        // manually so pushState and the scroll both use the correct value.
        const parsedUrl = new URL(url);
        const requestedHash = parsedUrl.hash; // e.g. "#configuration"
        const fetchUrl = parsedUrl.origin + parsedUrl.pathname + parsedUrl.search;

        let data;
        if (pageCache.has(fetchUrl)) {
          data = await pageCache.get(fetchUrl);
          data.html = await data.html;
        } else {
          const res = await fetch(fetchUrl);
          if (!res.ok) throw new Error('Fetch failed');
          data = { html: await res.text(), finalUrl: res.url };
          pageCache.set(fetchUrl, Promise.resolve(data));
        }

        const finalUrl = data.finalUrl + requestedHash;
        const html = data.html;

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // If target page is not SPA-compatible (e.g. noStyle), do a full redirect
        if (doc.body.dataset.spaEnabled === 'false') {
          window.location.assign(url);
          return;
        }

        if (pushHistory) history.pushState({}, '', finalUrl);
        currentPath = new URL(finalUrl).pathname;
        document.title = doc.title;

        // Sync head inline scripts to update DOCMD_ROOT, DOCMD_BASE, etc.
        const inlineScripts = doc.head.querySelectorAll('script:not([src])');
        inlineScripts.forEach(script => {
          if (script.textContent && script.textContent.includes('window.DOCMD_')) {
            const fn = new Function(script.textContent);
            try { fn(); } catch(e) { console.error(e); }
          }
        });

        // Re-resolve and apply theme based on new page configuration and user localStorage preference
        const localValue = localStorage.getItem('docmd-theme');
        const configValue = window.DOCMD_APPEARANCE || 'light';
        let theme = (localValue === 'light' || localValue === 'dark') ? localValue : configValue;
        if (theme === 'system') {
          theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', theme);
        document.body.setAttribute('data-theme', theme);

        const lightLink = document.getElementById('hljs-light');
        const darkLink = document.getElementById('hljs-dark');
        if (lightLink && darkLink) {
          lightLink.disabled = theme === 'dark';
          darkLink.disabled = theme === 'light';
        }

        // Sync Search Modal Attributes to preserve DOM event listeners but sync settings/locale strings
        const oldModal = document.getElementById('docmd-search-modal');
        const newModal = doc.getElementById('docmd-search-modal');
        if (oldModal && newModal) {
          Array.from(newModal.attributes).forEach(attr => {
            oldModal.setAttribute(attr.name, attr.value);
          });
        }

        // Sync Assets (CSS/Icons). The new page's <base href> already
        // resolved each new asset's URL when the browser parsed the fetched
        // HTML, so `newAsset.href` is already an absolute URL we can clone
        // verbatim. Re-resolving against finalUrl would strip the deploy
        // base path on nested pages.
        const assetSelectors = 'link[rel="stylesheet"], link[rel="icon"], link[rel="shortcut icon"]';
        const newAssets = Array.from(doc.head.querySelectorAll(assetSelectors));

        // Resolve absolute URLs for all new assets
        const newAssetHrefs = new Set();
        newAssets.forEach(newAsset => {
          const rawHref = newAsset.getAttribute('href');
          const newHref = rawHref ? new URL(rawHref, data.finalUrl).href : newAsset.href;
          newAssetHrefs.add(newHref);
        });

        // Drop any old assets that are not present in the new set
        Array.from(document.head.querySelectorAll(assetSelectors)).forEach(oldAsset => {
          if (!newAssetHrefs.has(oldAsset.href)) {
            oldAsset.remove();
          }
        });

        // Add new assets that are not already present
        newAssets.forEach((newAsset) => {
          const rawHref = newAsset.getAttribute('href');
          const newHref = rawHref ? new URL(rawHref, data.finalUrl).href : newAsset.href;
          const alreadyPresent = Array.from(document.head.querySelectorAll(assetSelectors)).some(oldAsset => {
            return oldAsset.href === newHref;
          });

          if (!alreadyPresent) {
            const cloned = newAsset.cloneNode(true);
            cloned.setAttribute('href', newHref);
            document.head.appendChild(cloned);
          }
        });

        Array.from(doc.querySelectorAll('body > script[src]')).forEach(newScript => {
          const src = newScript.getAttribute('src');
          if (!src) return;
          const newSrc = new URL(src, data.finalUrl).href;
          const alreadyPresent = Array.from(document.body.querySelectorAll('script[src]')).some(s => {
            const oldSrc = s.getAttribute('src');
            return oldSrc && new URL(oldSrc, window.location.href).href === newSrc;
          });
          if (alreadyPresent) return;
          const fresh = document.createElement('script');
          for (const attr of Array.from(newScript.attributes)) {
            if (attr.name === 'src') continue;
            fresh.setAttribute(attr.name, attr.value);
          }
          fresh.src = newSrc;
          document.body.appendChild(fresh);
        });

        // Sync Root Attributes (Theme, Classes)
        document.documentElement.className = doc.documentElement.className;
        document.body.className = doc.body.className;
        Array.from(doc.documentElement.attributes).forEach(attr => {
          if (attr.name !== 'class') document.documentElement.setAttribute(attr.name, attr.value);
        });
        Array.from(doc.body.attributes).forEach(attr => {
          if (attr.name !== 'class') document.body.setAttribute(attr.name, attr.value);
        });

        // Sync Sidebar State
        const oldLis = Array.from(document.querySelectorAll('.sidebar-nav li'));
        const newLis = Array.from(doc.querySelectorAll('.sidebar-nav li'));

        oldLis.forEach((oldLi, i) => {
          const newLi = newLis[i];
          if (newLi) {
            oldLi.classList.toggle('active', newLi.classList.contains('active'));
            oldLi.classList.toggle('active-parent', newLi.classList.contains('active-parent'));

            if (newLi.classList.contains('expanded')) {
              oldLi.classList.add('expanded');
              oldLi.setAttribute('aria-expanded', 'true');
            }

            const oldA = oldLi.querySelector('a');
            const newA = newLi.querySelector('a');
            if (oldA && newA) {
              // Resolve new href to absolute URL to prevent relative path nesting issues
              // But preserve external URLs (http/https, mailto:, tel:, etc.) as-is
              const newHref = newA.getAttribute('href');
              if (newHref !== null && newHref !== undefined && newHref !== '#') {
                try {
                  // Check if this is an external URL or special protocol - preserve as-is
                  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(newHref)) {
                    oldA.setAttribute('href', newHref);
                  } else {
                    // Internal link: resolve relative to the fetched page's URL
                    const absoluteUrl = new URL(newHref, data.finalUrl || window.location.href);
                    oldA.setAttribute('href', absoluteUrl.pathname + absoluteUrl.hash);
                  }
                } catch {
                  oldA.setAttribute('href', newHref);
                }
              } else {
                oldA.setAttribute('href', newHref !== null ? newHref : '#');
              }
              oldA.classList.toggle('active', newA.classList.contains('active'));
            }
          }
        });

        const selectorsToSwap = [
          '.content-layout',
          '.docmd-breadcrumbs',
          '.docmd-menubar',
          '.docmd-banner',
          '.docmd-cookie-banner',
          '.page-header .header-title',
          '.page-footer',
          '.footer-complete',
          '.page-footer-actions',
          '.docmd-language-switcher',
          '.docmd-version-dropdown',
          '.docmd-project-switcher',
          // Summer template selectors (no-op in classic — they only
          // exist when the active template is `summer`).
          '.summer-content',
          '.summer-toc',
          '.summer-pageheader',
          '.summer-pagenav',
          '.summer-pagefooter',
          '#docmd-raw-markdown',
          '.summer-sidebar nav'
        ];

        const swappedNodes = new Set();
        selectorsToSwap.forEach(selector => {
          const oldEls = document.querySelectorAll(selector);
          const newEls = doc.querySelectorAll(selector);
          oldEls.forEach((oldEl, idx) => {
            const newEl = newEls[idx];
            if (oldEl && newEl) {
              let parent = oldEl.parentElement;
              let parentSwapped = false;
              while (parent) {
                if (swappedNodes.has(parent)) {
                  parentSwapped = true;
                  break;
                }
                parent = parent.parentElement;
              }
              if (parentSwapped) return;

              swappedNodes.add(oldEl);
              oldEl.replaceChildren(...Array.from(newEl.childNodes));
            }
          });
        });

        // Scroll after the browser has painted the new content.
        // requestAnimationFrame ensures the swapped innerHTML is in the layout.
        requestAnimationFrame(() => {
          if (requestedHash) {
            try {
              const target = findTargetElement(requestedHash);
              if (target) target.scrollIntoView({ behavior: 'smooth' });
            } catch { /* invalid selector - ignore */ }
          } else {
            window.scrollTo(0, 0);
          }
        });

        injectCopyButtons();
        initializeScrollSpy();
        updateTocClass();
        initializeHeroSliders();
        const newMainContent = document.querySelector('.main-content');
        if (newMainContent) executeScripts(newMainContent);

        document.dispatchEvent(new CustomEvent('docmd:page-mounted', { detail: { url: finalUrl } }));

        setTimeout(() => {
          const newLayout = document.querySelector('.content-layout');
          if (newLayout) newLayout.style.minHeight = '';
        }, 100);

      } catch {
        window.location.assign(url);
      }
    }
    window.docmdNavigate = navigateTo;
  }

  // ---------------------------------------------------------------------------
  // Focus Mode (Zen Reading Experience - docmd v0.9.6)
  // ---------------------------------------------------------------------------
  function initializeFocusMode() {
    function setFocusMode(enabled) {
      if (enabled) {
        document.body.classList.add('focus-mode');
        try { localStorage.setItem('docmd-focus-mode', 'true'); } catch (_) { }
      } else {
        document.body.classList.remove('focus-mode');
        try { localStorage.setItem('docmd-focus-mode', 'false'); } catch (_) { }
      }
      try {
        window.dispatchEvent(new CustomEvent('docmd:focus-mode', { detail: { enabled } }));
      } catch (_) { }
    }

    function toggleFocusMode() {
      const isCurrentlyFocus = document.body.classList.contains('focus-mode');
      setFocusMode(!isCurrentlyFocus);
    }

    // Restore focus mode state if previously enabled
    try {
      if (localStorage.getItem('docmd-focus-mode') === 'true') {
        document.body.classList.add('focus-mode');
      }
    } catch (_) { }

    // Wire focus mode and print buttons via event delegation
    document.addEventListener('click', (e) => {
      const focusBtn = e.target.closest('.focus-mode-toggle-button');
      if (focusBtn) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      const printBtn = e.target.closest('.print-button');
      if (printBtn) {
        e.preventDefault();
        window.print();
        return;
      }
    });

    // Keyboard shortcuts: Alt+F to toggle focus mode, Escape to exit focus mode
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const isInput = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);

      if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        if (!isInput) {
          e.preventDefault();
          toggleFocusMode();
        }
      } else if (e.key === 'Escape') {
        const searchOpen = document.querySelector('.docmd-search-modal, .summer-search-dropdown:not([style*="display: none"])');
        if (!searchOpen && document.body.classList.contains('focus-mode')) {
          e.preventDefault();
          setFocusMode(false);
        }
      }
    });
  }

  // 4. BOOTSTRAP
  function bootstrap() {
    if (document.body.dataset.bootstrapped === 'true') return;
    document.body.dataset.bootstrapped = 'true';

    if (localStorage.getItem('docmd-sidebar-collapsed') === 'true') {
      document.body.classList.add('sidebar-collapsed');
    }

    document.querySelectorAll('.theme-toggle-button').forEach(btn => {
      btn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const nextTheme = currentTheme === 'light' ? 'dark' : 'light';

        document.documentElement.setAttribute('data-theme', nextTheme);
        document.body.setAttribute('data-theme', nextTheme);
        localStorage.setItem('docmd-theme', nextTheme);

        const lightLink = document.getElementById('hljs-light');
        const darkLink = document.getElementById('hljs-dark');
        if (lightLink && darkLink) {
          lightLink.disabled = nextTheme === 'dark';
          darkLink.disabled = nextTheme === 'light';
        }
      });
    });

    injectCopyButtons();
    initializeScrollSpy();
    updateTocClass();
    initializeHeroSliders();
    initializeSPA();
    initBanner();
    initCookieConsent();
    initializeFocusMode();

    setTimeout(() => {
      // PWA Unregistration Safety Net:
      // If the PWA plugin is removed from docmd.config.js, the <link rel="manifest"> disappears.
      // We explicitly unregister all ghost service workers to safely kill the offline cache.
      if (window.location.protocol !== 'file:' && 'serviceWorker' in navigator && !document.querySelector('link[rel="manifest"]')) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          registrations.forEach(reg => reg.unregister().catch(() => { }));
        });
      }

      const activeNav = document.querySelector('.sidebar-nav a.active');
      const sidebarNav = document.querySelector('.sidebar-nav');
      if (activeNav && sidebarNav) {
        sidebarNav.scrollTo({ top: activeNav.offsetTop - (sidebarNav.clientHeight / 2), behavior: 'instant' });
      }
      if (window.location.hash) {
        try {
          const target = findTargetElement(window.location.hash);
          if (target) target.scrollIntoView({ behavior: 'smooth' });
        } catch { /* ignore */ }
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
// ---------------------------------------------------------------------------
// Banner (new in 0.8.7)
// Per-session dismissable announcement bar. Stored in sessionStorage so a
// fresh visit re-shows the banner.
/* global sessionStorage */
// ---------------------------------------------------------------------------
function initBanner() {
  const banner = document.querySelector('[data-docmd-banner]');
  if (!banner) return;
  try {
    if (sessionStorage.getItem('docmd-banner-dismissed') === '1') {
      banner.remove();
      document.body.classList.remove('has-banner');
      return;
    }
  } catch (_) { /* sessionStorage blocked — leave visible */ }
  const closeBtn = banner.querySelector('[data-docmd-banner-dismiss]');
  if (!closeBtn) return;
  closeBtn.addEventListener('click', () => {
    banner.style.transition = 'opacity 0.15s ease, max-height 0.25s ease, padding 0.25s ease, margin 0.25s ease';
    banner.style.overflow = 'hidden';
    banner.style.maxHeight = banner.offsetHeight + 'px';
    // Force reflow before collapsing
    void banner.offsetHeight;
    banner.style.opacity = '0';
    banner.style.maxHeight = '0';
    banner.style.padding = '0';
    banner.style.margin = '0';
    setTimeout(() => {
      banner.remove();
      document.body.classList.remove('has-banner');
      try { sessionStorage.setItem('docmd-banner-dismissed', '1'); } catch (_) { /* ignore */ }
    }, 260);
  });
}

// ---------------------------------------------------------------------------
// Cookie consent (new in 0.8.7)
// Opt-in. Shows a banner unless a previous choice is stored in
// localStorage. 'accept' / 'decline' values are persisted.
// ---------------------------------------------------------------------------
function initCookieConsent() {
  const banner = document.querySelector('[data-cookie-consent]');
  if (!banner) return;
  const STORAGE_KEY = 'docmd-cookie-consent';
  const expiryDays = parseInt(banner.getAttribute('data-cookie-expiry') || '180', 10);

  function readChoice() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.value || !parsed.expires) return null;
      if (Date.now() > parsed.expires) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed.value;
    } catch (_) { return null; }
  }

  function writeChoice(value) {
    try {
      const expires = Date.now() + (expiryDays * 24 * 60 * 60 * 1000);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ value, expires, ts: Date.now() }));
    } catch (_) { /* storage blocked — UI still works for this session */ }
  }

  if (readChoice()) return; // already chosen

  banner.hidden = false;

  banner.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cookie-accept], [data-cookie-decline], [data-cookie-dismiss]');
    if (!t) return;
    if (t.hasAttribute('data-cookie-accept')) writeChoice('accept');
    else if (t.hasAttribute('data-cookie-decline')) writeChoice('decline');
    // dismiss counts as decline-but-silent
    else if (t.hasAttribute('data-cookie-dismiss')) writeChoice('dismissed');
    banner.hidden = true;
    // Fire a CustomEvent so themes/plugins can hook in.
    try {
      window.dispatchEvent(new CustomEvent('docmd:cookie-consent', { detail: { value: readChoice() || 'dismissed' } }));
    } catch (_) { /* ignore */ }
  });
}