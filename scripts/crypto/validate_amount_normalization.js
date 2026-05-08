"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");

function loadBrowserModule(context, relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  vm.runInContext(fs.readFileSync(absolutePath, "utf8"), context, {
    filename: absolutePath,
  });
}

function assertClose(errors, label, actual, expected, tolerance = 1e-12) {
  if (Math.abs(Number(actual) - Number(expected)) > tolerance) {
    errors.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function createContext() {
  const context = {
    window: {},
    console,
  };
  context.window.CryptoPhotonic = {};
  vm.createContext(context);
  loadBrowserModule(context, "js/crypto/core.js");
  loadBrowserModule(context, "js/crypto/solanaAdapter.js");
  return context;
}

function createUiContext() {
  const context = {
    window: {},
    console,
    document: {},
  };
  context.window.CryptoPhotonic = {};
  vm.createContext(context);
  loadBrowserModule(context, "js/crypto/core.js");
  context.window.CryptoPhotonic.graph = {};
  context.window.CryptoPhotonic.layout = {};

  const uiPath = path.join(ROOT, "js/crypto/ui.js");
  const source = fs
    .readFileSync(uiPath, "utf8")
    .replace(
      "    namespace.ui = {",
      "    window.__d100NormalizeWorkerTransferAmount = normalizeWorkerTransferAmount;\n\n    namespace.ui = {"
    );
  vm.runInContext(source, context, { filename: uiPath });
  return context;
}

function validateSolanaAdapterAmounts(errors) {
  const context = createContext();
  const adapter = context.window.CryptoPhotonic.solanaAdapter;
  const transfers = adapter.extractSolanaTransfers([
    {
      signature: "d100-native-lamports",
      type: "TRANSFER",
      nativeTransfers: [
        {
          fromUserAccount: "source111111111111111111111111111111111",
          toUserAccount: "target111111111111111111111111111111111",
          amount: 9250000000,
        },
      ],
    },
    {
      signature: "d100-native-decimal",
      type: "TRANSFER",
      nativeTransfers: [
        {
          fromUserAccount: "source222222222222222222222222222222222",
          toUserAccount: "target222222222222222222222222222222222",
          amount: 2.5,
        },
      ],
    },
    {
      signature: "d100-token-transfer-readable",
      type: "TOKEN_TRANSFER",
      tokenTransfers: [
        {
          fromUserAccount: "source333333333333333333333333333333333",
          toUserAccount: "target333333333333333333333333333333333",
          mint: "mint3333333333333333333333333333333333333",
          tokenAmount: 74664154666,
          decimals: 9,
          symbol: "READABLE",
        },
      ],
    },
    {
      signature: "d100-event-swap-raw",
      type: "SWAP",
      events: {
        swap: {
          tokenInputs: [
            {
              fromUserAccount: "source444444444444444444444444444444444",
              toUserAccount: "target444444444444444444444444444444444",
              mint: "mint4444444444444444444444444444444444444",
              tokenAmount: 74664154666,
              decimals: 9,
              symbol: "RAW",
            },
          ],
        },
      },
    },
  ]);

  const byHash = new Map(transfers.map((transfer) => [transfer.transaction_hash, transfer]));
  assertClose(errors, "native lamports normalized to SOL", byHash.get("d100-native-lamports")?.amount, 9.25);
  assertClose(errors, "decimal SOL preserved", byHash.get("d100-native-decimal")?.amount, 2.5);
  assertClose(errors, "tokenTransfers.tokenAmount preserved", byHash.get("d100-token-transfer-readable")?.amount, 74664154666);
  assertClose(errors, "events.swap tokenAmount normalized by decimals", byHash.get("d100-event-swap-raw")?.amount, 74.664154666);
}

function validateWorkerUiAmounts(errors) {
  const context = createUiContext();
  const normalize = context.window.__d100NormalizeWorkerTransferAmount;

  const heliusSol = normalize(
    { token_symbol: "SOL", amount: "9250000000", amount_display: "9250000000" },
    { symbol: "SOL", event: { ingestion_source: "helius_wallet_lookup" } }
  );
  assertClose(errors, "Worker SOL lamports normalized", heliusSol.amount, 9.25);
  if (heliusSol.display.includes("9250000000")) {
    errors.push(`Worker SOL display kept raw lamports: ${heliusSol.display}`);
  }

  const decimalSol = normalize(
    { token_symbol: "SOL", amount: "2.5" },
    { symbol: "SOL", event: { ingestion_source: "local_test_event" } }
  );
  assertClose(errors, "Worker decimal SOL preserved", decimalSol.amount, 2.5);

  const rawSpl = normalize(
    { token_symbol: "USDC", rawTokenAmount: { tokenAmount: "1250000", decimals: 6 } },
    { symbol: "USDC", event: { ingestion_source: "local_test_event" } }
  );
  assertClose(errors, "Worker raw SPL normalized", rawSpl.amount, 1.25);

  const readableSpl = normalize(
    { token_symbol: "USDC", tokenAmount: "1250", decimals: 6 },
    { symbol: "USDC", event: { ingestion_source: "helius_wallet_lookup" } }
  );
  assertClose(errors, "Worker tokenAmount preserved", readableSpl.amount, 1250);
}

function main() {
  const errors = [];
  validateSolanaAdapterAmounts(errors);
  validateWorkerUiAmounts(errors);

  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log("D100 amount normalization validation passed.");
}

main();
