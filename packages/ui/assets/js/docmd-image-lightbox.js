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

/* 
 * A simple lightbox implementation for gallery images
 */

document.addEventListener('DOMContentLoaded', function () {
  // Create lightbox elements
  const lightbox = document.createElement('div');
  lightbox.className = 'docmd-lightbox';
  const content = document.createElement('div');
  content.className = 'docmd-lightbox-content';
  const img = document.createElement('img');
  img.src = '';
  img.alt = '';
  const caption = document.createElement('div');
  caption.className = 'docmd-lightbox-caption';
  content.appendChild(img);
  content.appendChild(caption);

  const close = document.createElement('button');
  close.className = 'docmd-lightbox-close';
  close.setAttribute('aria-label', 'Close lightbox');
  close.innerHTML = '&times;'; // Hardcoded entity is safe

  // Place close button inside content so it positions relative to the image box
  content.appendChild(close);
  lightbox.appendChild(content);
  document.body.appendChild(lightbox);

  const lightboxImg = lightbox.querySelector('img');
  const lightboxCaption = lightbox.querySelector('.docmd-lightbox-caption');
  const lightboxClose = lightbox.querySelector('.docmd-lightbox-close');

  // Apply zoom-in cursor to all current lightbox images
  function applyLightboxCursor() {
    document.querySelectorAll('img.lightbox, .image-gallery img').forEach(function (img) {
      img.style.cursor = 'zoom-in';
    });
  }

  // Apply cursor on initial load and after each SPA navigation
  applyLightboxCursor();
  document.addEventListener('docmd:page-mounted', applyLightboxCursor);

  // Use event delegation so lightbox works after SPA navigation without re-binding
  document.addEventListener('click', function (e) {
    const img = e.target.closest('img.lightbox, .image-gallery img');
    if (!img) return;

    // Get the image source and caption
    const src = img.getAttribute('src');
    let caption = img.getAttribute('alt') || '';

    // If image is inside a figure with figcaption, use that caption
    const figure = img.closest('figure');
    if (figure) {
      const figcaption = figure.querySelector('figcaption');
      if (figcaption) {
        caption = figcaption.textContent;
      }
    }

    // Delegate to Universal Modal if available
    if (window.docmd && window.docmd.modal) {
      const modalImg = document.createElement('img');
      modalImg.src = src;
      modalImg.alt = caption;
      window.docmd.modal.open({
        content: modalImg,
        icon: 'image',
        title: caption,
        type: 'image'
      });
      return;
    }

    // Set the lightbox content
    lightboxImg.setAttribute('src', src);
    lightboxCaption.textContent = caption;

    // Show the lightbox
    lightbox.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Prevent scrolling
  });

  // Close lightbox when clicking the close button or outside the image
  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });

  // Close lightbox when pressing Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lightbox.style.display === 'flex') {
      closeLightbox();
    }
  });

  function closeLightbox() {
    lightbox.style.display = 'none';
    document.body.style.overflow = ''; // Restore scrolling
  }
}); 
