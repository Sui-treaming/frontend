export type NftUploadState = {
    file?: File;
    uploading: boolean;
    error?: string;
    successMessage?: string;
    resetCounter: number;
};
