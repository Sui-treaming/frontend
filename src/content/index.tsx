import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles/content.less';
import { getOverlayPosition, OVERLAY_POSITION_KEY, type OverlayPosition } from '../shared/storage';

const MOUNT_ID = 'twitch-zklogin-wallet-root';

function mountOverlay() {
    if (!/^www\.twitch\.tv$/i.test(window.location.hostname)) {
        return;
    }

    if (document.getElementById(MOUNT_ID)) {
        return;
    }

    const container = document.createElement('div');
    container.id = MOUNT_ID;
    document.body.appendChild(container);

    applyPosition(container);

    const root = createRoot(container);
    root.render(<App />);
}

function bootstrap() {
    mountOverlay();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes[OVERLAY_POSITION_KEY]) {
            const container = document.getElementById(MOUNT_ID) as HTMLDivElement | null;
            if (container) applyPosition(container);
        }
    });
}

async function applyPosition(container: HTMLDivElement) {
    const pos: OverlayPosition = await getOverlayPosition();
    container.style.top = '';
    container.style.right = '';
    container.style.bottom = '';
    container.style.left = '';
    switch (pos.corner) {
        case 'top-right':
            container.style.top = pos.offsetY + 'px';
            container.style.right = pos.offsetX + 'px';
            break;
        case 'top-left':
            container.style.top = pos.offsetY + 'px';
            container.style.left = pos.offsetX + 'px';
            break;
        case 'bottom-right':
            container.style.bottom = pos.offsetY + 'px';
            container.style.right = pos.offsetX + 'px';
            break;
        case 'bottom-left':
            container.style.bottom = pos.offsetY + 'px';
            container.style.left = pos.offsetX + 'px';
            break;
    }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bootstrap();
} else {
    document.addEventListener('DOMContentLoaded', bootstrap);
}
