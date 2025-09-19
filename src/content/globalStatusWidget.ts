import { getWidgetState, subscribeToWidgetState, type WidgetState } from './channelPointsWidget';
import { getGlobalWidgetPosition, setGlobalWidgetPosition, type OverlayPosition } from '../shared/storage';
import { initWidgetScale } from './responsive';

const GLOBAL_WIDGET_ID = 'zklogin-global-status-widget';
const BLOCKED_PROTOCOLS = new Set(['about:', 'chrome:', 'chrome-extension:']);
const BLOCKED_HOSTS = new Set(['id.twitch.tv']);
const BLOCKED_HOST_SUFFIXES = ['chromiumapp.org'];

let initialized = false;
let container: HTMLDivElement | null = null;
let drag: {
    pointerId: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
} | null = null;
let unsubscribe: (() => void) | null = null;

function isBlockedEnvironment(): boolean {
    if (typeof window === 'undefined') {
        return true;
    }

    const { protocol, hostname, href } = window.location;

    if (href === 'about:blank') {
        return true;
    }

    if (BLOCKED_PROTOCOLS.has(protocol)) {
        return true;
    }

    if (BLOCKED_HOSTS.has(hostname)) {
        return true;
    }

    if (BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
        return true;
    }

    return false;
}

function ensureContainer(): HTMLDivElement {
    if (container) {
        return container;
    }
    const element = document.createElement('div');
    element.id = GLOBAL_WIDGET_ID;
    element.className = 'zklogin-global-widget';
    element.innerHTML = '<div class="zklogin-global-widget__title">Stream-to-Sui (loading…)</div>';
    document.body.appendChild(element);
    container = element;
    // 초기 위치 적용
    applyPosition(element).catch(() => void 0);
    // 드래그 핸들러 등록
    bindDragHandlers(element);
    return element;
}

function formatAddress(address?: string): string {
    if (!address) {
        return 'Not linked';
    }
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatMintSummary(state: WidgetState): string {
    const label = state.mintedCount === 1 ? 'mint' : 'mints';
    return `${state.mintedCount} ${label}`;
}

function formatTimestamp(value?: string): string {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function render(state: WidgetState): void {
    const host = ensureContainer();
    const walletSummary = state.hasAccount ? formatAddress(state.primaryAddress) : 'Connect Twitch';

    host.innerHTML = `
        <div class="zklogin-global-widget__title">Stream-to-Sui (mock)</div>
        <div class="zklogin-global-widget__row">
            <span class="zklogin-global-widget__label">Wallet</span>
            <strong class="zklogin-global-widget__value">${walletSummary}</strong>
        </div>
        <div class="zklogin-global-widget__row">
            <span class="zklogin-global-widget__label">Mock NFT mints</span>
            <strong class="zklogin-global-widget__value">${formatMintSummary(state)}</strong>
        </div>
        <div class="zklogin-global-widget__row">
            <span class="zklogin-global-widget__label">Last reward</span>
            <strong class="zklogin-global-widget__value">${formatTimestamp(state.lastClaim)}</strong>
        </div>
    `;
}

export function initGlobalStatusWidget(): void {
    if (typeof window === 'undefined' || initialized || isBlockedEnvironment()) {
        return;
    }
    initialized = true;

    initWidgetScale();

    render(getWidgetState());

    unsubscribe = subscribeToWidgetState(render);

    window.addEventListener('beforeunload', () => {
        unsubscribe?.();
        unsubscribe = null;
    });
}

async function applyPosition(el: HTMLDivElement): Promise<void> {
    const pos: OverlayPosition = await getGlobalWidgetPosition();
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.left = '';
    switch (pos.corner) {
        case 'top-right':
            el.style.top = pos.offsetY + 'px';
            el.style.right = pos.offsetX + 'px';
            break;
        case 'top-left':
            el.style.top = pos.offsetY + 'px';
            el.style.left = pos.offsetX + 'px';
            break;
        case 'bottom-right':
            el.style.bottom = pos.offsetY + 'px';
            el.style.right = pos.offsetX + 'px';
            break;
        case 'bottom-left':
            el.style.bottom = pos.offsetY + 'px';
            el.style.left = pos.offsetX + 'px';
            break;
    }
}

function bindDragHandlers(el: HTMLDivElement): void {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('a,button,input,select,textarea')) return;
        const rect = el.getBoundingClientRect();
        drag = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            width: rect.width,
            height: rect.height,
        };
        el.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    el.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const maxLeft = Math.max(8, window.innerWidth - drag.width - 8);
        const maxTop = Math.max(8, window.innerHeight - drag.height - 8);
        const newLeft = clamp(event.clientX - drag.offsetX, 8, maxLeft);
        const newTop = clamp(event.clientY - drag.offsetY, 8, maxTop);
        el.style.top = `${Math.round(newTop)}px`;
        el.style.left = `${Math.round(newLeft)}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    });

    function clear(id: number) {
        if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
        drag = null;
    }

    el.addEventListener('pointerup', async (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        await persistPosition(el);
        clear(event.pointerId);
    });
    el.addEventListener('pointercancel', (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        clear(event.pointerId);
    });
}

async function persistPosition(el: HTMLDivElement): Promise<void> {
    const rect = el.getBoundingClientRect();
    const pos: OverlayPosition = { corner: 'top-left', offsetX: Math.round(rect.left), offsetY: Math.round(rect.top) };
    await setGlobalWidgetPosition(pos);
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(Math.max(v, min), max);
}
