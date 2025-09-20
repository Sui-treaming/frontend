export interface WalrusServiceConfig {
    id: string;
    name: string;
    publisherUrl: string;
    aggregatorUrl: string;
}

export const DEFAULT_SEAL_SERVER_IDS = [
    '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
    '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
] as const;

export const DEFAULT_WALRUS_SERVICES: WalrusServiceConfig[] = [
    {
        id: 'walrus-space',
        name: 'walrus.space',
        publisherUrl: 'https://publisher.walrus-testnet.walrus.space',
        aggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
    },
    {
        id: 'staketab',
        name: 'staketab.org',
        publisherUrl: 'https://wal-publisher-testnet.staketab.org',
        aggregatorUrl: 'https://wal-aggregator-testnet.staketab.org',
    },
    {
        id: 'redundex',
        name: 'redundex.com',
        publisherUrl: 'https://walrus-testnet-publisher.redundex.com',
        aggregatorUrl: 'https://walrus-testnet-aggregator.redundex.com',
    },
    {
        id: 'nodes-guru',
        name: 'nodes.guru',
        publisherUrl: 'https://walrus-testnet-publisher.nodes.guru',
        aggregatorUrl: 'https://walrus-testnet-aggregator.nodes.guru',
    },
    {
        id: 'banansen',
        name: 'banansen.dev',
        publisherUrl: 'https://publisher.walrus.banansen.dev',
        aggregatorUrl: 'https://aggregator.walrus.banansen.dev',
    },
    {
        id: 'everstake',
        name: 'everstake.one',
        publisherUrl: 'https://walrus-testnet-publisher.everstake.one',
        aggregatorUrl: 'https://walrus-testnet-aggregator.everstake.one',
    },
];

export const WALRUS_DEFAULT_EPOCHS = 1;
export const SESSION_TTL_MINUTES = 10;
