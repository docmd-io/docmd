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
 * @returns {Object} { headScriptsHtml, bodyScriptsHtml }
 */

import type { PluginDescriptor } from '@docmd/api';
import { scriptLiteral } from '@docmd/utils';

export const plugin: PluginDescriptor = {
  name: 'analytics',
  version: '0.9.5',
  capabilities: ['head', 'body']
};

// Phase 1.C (S-4 fix): format-validate the IDs before interpolation.
// GA4 measurementId is `G-XXXXXXXX` (uppercase letters and digits after the prefix).
// UA trackingId is `UA-XXXXXXX-Y`.
const GA4_ID_RE = /^G-[A-Z0-9]{6,12}$/;
const UA_ID_RE = /^UA-\d{6,12}-\d{1,3}$/;

export function generateScripts(config: any) {
  let headScriptsHtml = '';
  let bodyScriptsHtml = '';

  const analytics = config.plugins?.analytics || {};

  // Google Analytics 4
  if (analytics.googleV4?.measurementId) {
    const id = analytics.googleV4.measurementId;
    if (!GA4_ID_RE.test(id)) {
      console.error(`[analytics] Invalid googleV4.measurementId: ${JSON.stringify(id)}. Expected format G-XXXXXXXX. Analytics script skipped.`);
    } else {
      const idLiteral = scriptLiteral(id);
      headScriptsHtml += `
    <!-- GA4 -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${idLiteral}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', ${idLiteral});
    </script>\n`;
    }
  }

  // Legacy UA
  if (analytics.googleUA?.trackingId) {
    const id = analytics.googleUA.trackingId;
    if (!UA_ID_RE.test(id)) {
      console.error(`[analytics] Invalid googleUA.trackingId: ${JSON.stringify(id)}. Expected format UA-XXXXXXX-Y. Analytics script skipped.`);
    } else {
      const idLiteral = scriptLiteral(id);
      headScriptsHtml += `
    <!-- UA (Legacy) -->
    <script async src="https://www.google-analytics.com/analytics.js"></script>
    <script>
      window.ga=window.ga||function(){(ga.q=ga.q||[]).push(arguments)};ga.l=+new Date;
      ga('create', ${idLiteral}, 'auto');
      ga('send', 'pageview');
    </script>\n`;
    }
  }

  // Auto-event Tagging (V2)
  if (analytics.autoEvents !== false) {
    const trackSearch = analytics.trackSearch !== false;
    bodyScriptsHtml += `
    <script>
      (function() {
        var searchDebounceTimer;

        document.addEventListener('click', function(e) {
          var link = e.target.closest('a');
          if (!link || !window.gtag) return;
          
          var url = link.href;
          var hostname = window.location.hostname;
          var isExternal = link.hostname && link.hostname !== hostname;
          var isDownload = link.hasAttribute('download') || url.match(/\\.(pdf|zip|tar|gz|exe|pkg)$/i);
          
          if (isExternal) {
            gtag('event', 'click_external', { 'url': url, 'link_text': link.innerText.trim() });
          } else if (isDownload) {
            gtag('event', 'download', { 'file_name': url.split('/').pop(), 'url': url });
          }

          // TOC tracking
          if (link.classList.contains('toc-link')) {
            gtag('event', 'toc_click', { 'target_id': link.getAttribute('href'), 'title': link.innerText.trim() });
          }

          // Permalink tracking
          if (link.classList.contains('heading-anchor')) {
            gtag('event', 'permalink_click', { 'url': url });
          }
        });

        ${trackSearch ? `
        // Search Keyword Tracking
        document.addEventListener('input', function(e) {
          if (e.target.id === 'docmd-search-input' && window.gtag) {
            var query = e.target.value.trim();
            if (query.length < 3) return;
            
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(function() {
              gtag('event', 'search', { 'search_term': query });
            }, 1000);
          }
        });
        ` : ''}
      })();
    </script>\n`;
  }

  return { headScriptsHtml, bodyScriptsHtml };
}