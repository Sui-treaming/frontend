import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';

export interface CreateServiceParams {
    packageId: string;
    priceMist: bigint;
    ttlMinutes: bigint;
    name: string;
    sender: string;
    gasBudget?: bigint;
}

export function buildCreateServiceTransaction(params: CreateServiceParams): Transaction {
    const { packageId, priceMist, ttlMinutes, name, sender, gasBudget = 10_000_000n } = params;
    const tx = new Transaction();
    tx.setSender(sender);
    tx.setGasBudget(gasBudget);
    tx.moveCall({
        target: `${packageId}::subscription::create_service_entry`,
        arguments: [
            tx.pure.u64(priceMist),
            tx.pure.u64(ttlMinutes * 60n * 1000n),
            tx.pure.string(name),
        ],
    });
    return tx;
}

export interface PublishSecretParams {
    packageId: string;
    serviceId: string;
    capId: string;
    blobId: string;
    sender: string;
    gasBudget?: bigint;
}

export function buildPublishSecretTransaction(params: PublishSecretParams): Transaction {
    const { packageId, serviceId, capId, blobId, sender, gasBudget = 10_000_000n } = params;
    const tx = new Transaction();
    tx.setSender(sender);
    tx.setGasBudget(gasBudget);
    tx.moveCall({
        target: `${packageId}::subscription::publish`,
        arguments: [
            tx.object(serviceId),
            tx.object(capId),
            tx.pure.string(blobId),
        ],
    });
    return tx;
}

export interface SubscribeParams {
    packageId: string;
    serviceId: string;
    feeMist: bigint;
    sender: string;
    gasBudget?: bigint;
}

export function buildSubscribeTransaction(params: SubscribeParams): Transaction {
    const { packageId, serviceId, feeMist, sender, gasBudget = 10_000_000n } = params;
    const tx = new Transaction();
    tx.setSender(sender);
    tx.setGasBudget(gasBudget);
    const paymentCoin = coinWithBalance({ balance: feeMist });
    const subscription = tx.moveCall({
        target: `${packageId}::subscription::subscribe`,
        arguments: [paymentCoin, tx.object(serviceId), tx.object(SUI_CLOCK_OBJECT_ID)],
    });
    tx.moveCall({
        target: `${packageId}::subscription::transfer`,
        arguments: [tx.object(subscription), tx.pure.address(sender)],
    });
    return tx;
}
