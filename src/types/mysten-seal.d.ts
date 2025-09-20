declare module '@mysten/seal' {
    export class SealClient {
        constructor(config: any);
        encrypt(params: { threshold: number; packageId: string; id: string; data: Uint8Array }): Promise<{ encryptedObject: Uint8Array }>;
        fetchKeys(params: { ids: string[]; txBytes: Uint8Array; sessionKey: SessionKey; threshold: number }): Promise<void>;
        decrypt(params: { data: Uint8Array; sessionKey: SessionKey; txBytes: Uint8Array }): Promise<Uint8Array>;
    }

    export class SessionKey {
        static create(params: { address: string; packageId: string; ttlMin: number; suiClient: any }): Promise<SessionKey>;
        getPersonalMessage(): Uint8Array;
        setPersonalMessageSignature(signature: string): Promise<void>;
    }

    export class NoAccessError extends Error {}

    export class EncryptedObject {
        static parse(data: Uint8Array): { id: string };
    }
}
