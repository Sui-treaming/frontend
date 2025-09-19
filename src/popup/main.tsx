import { createRoot } from 'react-dom/client';
import { PopupApp } from './ui/PopupApp';
import './styles/popup.less';

const container = document.getElementById('root');

if (!container) {
    throw new Error('Popup root container missing');
}

createRoot(container).render(<PopupApp />);
