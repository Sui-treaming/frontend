import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles/content.less';
import { initChannelPointsWidget } from './channelPointsWidget';
import { initGlobalStatusWidget } from './globalStatusWidget';

const MOUNT_ID = 'twitch-zklogin-wallet-root';

function mountOverlay() {
    if (!/(^|\.)twitch\.tv$/i.test(window.location.hostname)) {
        return;
    }

    if (document.getElementById(MOUNT_ID)) {
        return;
    }

    const container = document.createElement('div');
    container.id = MOUNT_ID;
    document.body.appendChild(container);

    const root = createRoot(container);
    root.render(<App />);
}

function bootstrap() {
    mountOverlay();
    initChannelPointsWidget();
    initGlobalStatusWidget();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bootstrap();
} else {
    document.addEventListener('DOMContentLoaded', bootstrap);
}
