export function uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
