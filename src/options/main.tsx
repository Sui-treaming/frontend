import { createRoot } from 'react-dom/client';
import { OptionsApp } from './ui/OptionsApp';
import './styles/options.less';

const container = document.getElementById('root');

if (!container) {
    throw new Error('Options root container missing');
}

createRoot(container).render(<OptionsApp />);
