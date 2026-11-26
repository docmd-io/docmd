/**
 * The lazy any-emoji picker entry. Importing it registers `threads-emoji-picker` (the vendored,
 * adapted emoji-picker-element). It builds to dist/client/emoji-picker.js, is served as
 * assets/js/threads-emoji-picker.js with no script tag, and `threads-reactions` `import()`s it on the
 * first + click. `threads.js` never imports it.
 */
import PickerElement from './vendor/emoji-picker/picker.js';

export { PickerElement };
