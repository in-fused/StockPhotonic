export const FIXTURE_EVENTS = [
  {
    id: "fixture-sol-transfer-001",
    chain: "solana-dev-synthetic",
    signature: "synthetic_signature_001",
    timestamp: "2026-05-06T00:00:00.000Z",
    transaction_type: "token_transfer",
    source: "synthetic-fixture",
    wallets: [
      {
        address: "SyntheticWalletAlpha111111111111111111111111",
        role: "sender",
      },
      {
        address: "SyntheticWalletBeta2222222222222222222222222",
        role: "receiver",
      },
    ],
    tokens: [
      {
        symbol: "CPHOTON",
        mint: "SyntheticMint111111111111111111111111111111",
        decimals: 6,
      },
    ],
    transfers: [
      {
        token_symbol: "CPHOTON",
        amount: "42.000000",
        from: "SyntheticWalletAlpha111111111111111111111111",
        to: "SyntheticWalletBeta2222222222222222222222222",
      },
    ],
    metadata: {
      sanitized: true,
      production_meaning: false,
      live_blockchain_fetching: false,
      fixture: true,
    },
  },
  {
    id: "fixture-liquidity-signal-001",
    chain: "solana-dev-synthetic",
    signature: "synthetic_signature_002",
    timestamp: "2026-05-06T00:05:00.000Z",
    transaction_type: "liquidity_observation",
    source: "synthetic-fixture",
    wallets: [
      {
        address: "SyntheticPoolObserver3333333333333333333333",
        role: "observer",
      },
    ],
    tokens: [
      {
        symbol: "SOL",
        mint: "SyntheticWrappedSolMint1111111111111111111111",
        decimals: 9,
      },
      {
        symbol: "USDC",
        mint: "SyntheticUsdcMint2222222222222222222222222",
        decimals: 6,
      },
    ],
    transfers: [],
    metadata: {
      sanitized: true,
      production_meaning: false,
      live_blockchain_fetching: false,
      fixture: true,
    },
  },
];
