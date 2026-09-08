import '@shoelace-style/shoelace/dist/themes/light.css';
import './components/threads-app';

function init(): void {
  // Gracefully exit if no live dev server RPC bridge is present
  if (typeof (window as any).docmd === 'undefined') return;
  if (document.querySelector('threads-app')) return;
  const app = document.createElement('threads-app');
  document.body.appendChild(app);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
