const MIRROR_KEY = 'calpos_mirror_mode';

export function isMirrorModeActive(): boolean {
  return localStorage.getItem(MIRROR_KEY) === 'true';
}

export function enableMirrorMode() {
  localStorage.setItem(MIRROR_KEY, 'true');
  document.body.setAttribute('data-mirror', 'true');
}

export function disableMirrorMode() {
  localStorage.removeItem(MIRROR_KEY);
  document.body.removeAttribute('data-mirror');
}

export function syncMirrorModeToBody() {
  if (isMirrorModeActive()) {
    document.body.setAttribute('data-mirror', 'true');
  } else {
    document.body.removeAttribute('data-mirror');
  }
}
