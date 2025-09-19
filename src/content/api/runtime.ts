import type { MessageRequest, MessageResponse } from '../../shared/messages';

type ResponseOf<T extends MessageRequest['type']> = Extract<MessageResponse, { type: T }>;

type Awaitable<T> = T extends Promise<infer U> ? U : T;

export async function sendMessage<T extends MessageRequest>(
    request: T,
): Promise<Awaitable<ResponseOf<T['type']>>> {
    return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(request, (response: MessageResponse | undefined) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!response) {
                reject(new Error('No response from background script.'));
                return;
            }
            if (response.type !== request.type) {
                reject(new Error(`Mismatched response type: ${response.type}`));
                return;
            }
            if (!response.ok) {
                reject(new Error(response.error ?? 'Background call failed.'));
                return;
            }
            resolve(response as ResponseOf<T['type']>);
        });
    });
}
