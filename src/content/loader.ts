(async () => {
    try {
        const entryUrl = chrome.runtime.getURL('assets/content.js');
        await import(entryUrl);
    } catch (error) {
        console.error('[content] Failed to load zkLogin content script module', error);
    }
})();
