import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles/content.less';

const MOUNT_ID = 'twitch-zklogin-wallet-root';

function mountOverlay() {
    if (document.getElementById(MOUNT_ID)) {
        return;
    }

    const container = document.createElement('div');
    container.id = MOUNT_ID;
    document.body.appendChild(container);

    const root = createRoot(container);
    root.render(<App />);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    mountOverlay();
} else {
    document.addEventListener('DOMContentLoaded', mountOverlay);
}
