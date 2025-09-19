let initialized = false;
let rafId = 0;

function computeScale(): void {
    if (typeof window === 'undefined') {
        return;
    }

    const width = window.innerWidth || document.documentElement.clientWidth || 1280;
    const height = window.innerHeight || document.documentElement.clientHeight || 720;

    const referenceArea = 1280 * 720; // baseline resolution
    const currentArea = width * height;
    const ratio = Math.sqrt(currentArea / referenceArea);

    const scale = Math.min(1.2, Math.max(1.03, ratio));
    document.documentElement.style.setProperty('--zklogin-widget-scale', scale.toFixed(3));
}

export function initWidgetScale(): void {
    if (initialized || typeof window === 'undefined') {
        return;
    }
    initialized = true;

    const scheduleUpdate = () => {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
            computeScale();
        });
    };

    computeScale();
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    window.addEventListener('orientationchange', scheduleUpdate, { passive: true });
}
