"use strict";

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
const NATIVE_SOL_DECIMALS = 9;
const MAX_LIMITATIONS = 12;

function normalizeProviderTransactions(providerTransactions = [], options = {}) {
  const wallet = safeString(options.wallet);
  const rows = [];
  providerTransactions.forEach((transaction, transactionIndex) => {
    const legs = extractTransferLegs(transaction, { wallet });
    const transferLegCount = legs.length;
    legs.forEach((leg, legIndex) => {
      rows.push(normalizeLeg(transaction, leg, {
        wallet,
        transactionIndex,
        legIndex,
        transferLegCount,
        cursorPresent: Boolean(options.cursor),
        nextCursorPresent: Boolean(options.nextCursor),
        pageNumber: normalizeInteger(options.pageNumber, 1),
      }));
    });
  });
  return rows;
}

function normalizeProviderTransactionsToEvents(providerTransactions = [], options = {}) {
  return normalizeProviderTransactions(providerTransactions, options).map((row) => normalizedRowToEvent(row, options));
}

function normalizedRowToEvent(row = {}, options = {}) {
  const ingestionSource = safeString(options.ingestionSource) || "helius_wallet_lookup";
  const tokenSymbol = row.token_symbol || (row.token_mint === NATIVE_SOL_MINT ? "SOL" : "TOKEN");
  const tokenDecimals = Number.isFinite(Number(row.decimals)) ? Number(row.decimals) : (tokenSymbol === "SOL" ? NATIVE_SOL_DECIMALS : null);
  const wallets = [];
  if (row.source_wallet) wallets.push({ address: row.source_wallet, role: "sender" });
  if (row.destination_wallet && row.destination_wallet !== row.source_wallet) wallets.push({ address: row.destination_wallet, role: "receiver" });
  const token = row.token_mint
    ? {
        mint: row.token_mint,
        symbol: tokenSymbol,
        decimals: tokenDecimals,
      }
    : null;
  const transfer = {
    from: row.source_wallet,
    to: row.destination_wallet,
    token_symbol: tokenSymbol,
    token_mint: row.token_mint,
    amount: row.amount,
    raw_amount: row.raw_amount,
    decimals: tokenDecimals,
    transfer_leg_index: row.transfer_leg_index,
    transfer_leg_count: row.transfer_leg_count,
  };

  return {
    id: `helius-${safeId(row.signature || "unknown")}-${row.transfer_leg_index || 0}`,
    chain: "solana",
    signature: row.signature || null,
    slot: row.slot ?? null,
    timestamp: row.timestamp || null,
    transaction_type: row.event_type || "token_transfer",
    event_type: row.event_type || "token_transfer",
    ingestion_source: ingestionSource,
    source: "helius_getTransactionsForAddress_sanitized",
    source_wallet: row.source_wallet,
    destination_wallet: row.destination_wallet,
    token_mint: row.token_mint,
    amount: row.amount,
    transfer_leg_index: row.transfer_leg_index,
    transfer_leg_count: row.transfer_leg_count,
    parser_confidence: row.parser_confidence,
    parser_confidence_reason: row.parser_confidence_reason,
    parser_limitations: row.parser_limitations,
    raw_reference: row.raw_reference,
    wallets,
    tokens: token ? [token] : [],
    transfers: row.source_wallet && row.destination_wallet ? [transfer] : [],
    metadata: {
      sanitized: true,
      sample: false,
      fixture: false,
      mock: false,
      placeholder: false,
      production_meaning: false,
      live_blockchain_fetching: false,
      wallet_identity_claimed: false,
      ownership_claimed: false,
      source_of_funds_claimed: false,
      risk_claimed: false,
      criminality_claimed: false,
      complete_history_claimed: false,
      liquidity_truth_claimed: false,
      parser_confidence: row.parser_confidence,
      parser_confidence_reason: row.parser_confidence_reason,
      parser_limitations: row.parser_limitations,
      raw_reference: row.raw_reference,
    },
  };
}

function extractTransferLegs(transaction = {}, options = {}) {
  const legs = [];
  addEnhancedTransferLegs(legs, transaction);
  addParsedInstructionLegs(legs, transaction);
  if (!legs.length) addTokenBalanceDeltaLegs(legs, transaction);
  return dedupeLegs(legs).filter((leg) => {
    return safeString(leg.source_wallet) || safeString(leg.destination_wallet) || safeString(leg.amount);
  });
}

function addEnhancedTransferLegs(legs, transaction) {
  asObjectList(transaction.tokenTransfers).forEach((transfer, index) => {
    legs.push({
      source_wallet: safeString(transfer.fromUserAccount || transfer.fromTokenAccount),
      destination_wallet: safeString(transfer.toUserAccount || transfer.toTokenAccount),
      source_token_account: safeString(transfer.fromTokenAccount),
      destination_token_account: safeString(transfer.toTokenAccount),
      token_mint: safeString(transfer.mint),
      amount: safeString(transfer.tokenAmount || displayAmountFromRaw(transfer.rawTokenAmount, transfer.decimals)),
      raw_amount: safeString(transfer.rawTokenAmount),
      decimals: normalizeInteger(transfer.decimals, null),
      token_symbol: "TOKEN",
      transfer_kind: "token",
      event_type: inferEventType(transaction, "token_transfer"),
      parser_source: "provider_normalized_transfer",
      parser_confidence: 0.74,
      parser_confidence_reason: "provider-normalized token transfer leg; review signature grouping",
      outer_instruction_index: null,
      inner_instruction_index: null,
      provider_transfer_index: normalizeInteger(transfer.provider_transfer_index, index),
    });
  });

  asObjectList(transaction.nativeTransfers).forEach((transfer, index) => {
    legs.push({
      source_wallet: safeString(transfer.fromUserAccount),
      destination_wallet: safeString(transfer.toUserAccount),
      token_mint: NATIVE_SOL_MINT,
      amount: displayAmountFromRaw(transfer.amount, NATIVE_SOL_DECIMALS),
      raw_amount: safeString(transfer.amount),
      decimals: NATIVE_SOL_DECIMALS,
      token_symbol: "SOL",
      transfer_kind: "native",
      event_type: inferEventType(transaction, "native_transfer"),
      parser_source: "provider_normalized_transfer",
      parser_confidence: 0.76,
      parser_confidence_reason: "provider-normalized native transfer leg; review fee and instruction context",
      outer_instruction_index: null,
      inner_instruction_index: null,
      provider_transfer_index: normalizeInteger(transfer.provider_transfer_index, index),
    });
  });
}

function addParsedInstructionLegs(legs, transaction) {
  const ownerByTokenAccount = buildTokenAccountOwnerMap(transaction);
  asObjectList(transaction.instructions).forEach((instruction, index) => {
    addInstructionLeg(legs, transaction, instruction, ownerByTokenAccount, index, null);
  });
  asObjectList(transaction.innerInstructions).forEach((group) => {
    asObjectList(group.instructions).forEach((instruction, innerIndex) => {
      addInstructionLeg(legs, transaction, instruction, ownerByTokenAccount, normalizeInteger(group.index, null), innerIndex);
    });
  });
}

function addInstructionLeg(legs, transaction, instruction, ownerByTokenAccount, outerIndex, innerIndex) {
  const program = safeString(instruction.program).toLowerCase();
  const type = safeString(instruction.type).toLowerCase();
  const info = instruction.info && typeof instruction.info === "object" ? instruction.info : {};
  if (program === "system" && type === "transfer") {
    legs.push({
      source_wallet: safeString(info.source),
      destination_wallet: safeString(info.destination),
      token_mint: NATIVE_SOL_MINT,
      amount: displayAmountFromRaw(info.lamports, NATIVE_SOL_DECIMALS),
      raw_amount: safeString(info.lamports),
      decimals: NATIVE_SOL_DECIMALS,
      token_symbol: "SOL",
      transfer_kind: "native",
      event_type: inferEventType(transaction, "native_transfer"),
      parser_source: "jsonParsed_instruction",
      parser_confidence: 0.7,
      parser_confidence_reason: "jsonParsed system transfer instruction; review full transaction context",
      outer_instruction_index: outerIndex,
      inner_instruction_index: innerIndex,
    });
    return;
  }

  if ((program === "spl-token" || program === "spl-token-2022") && (type === "transfer" || type === "transferchecked")) {
    const sourceAccount = safeString(info.source);
    const destinationAccount = safeString(info.destination);
    const tokenAmount = info.tokenAmount && typeof info.tokenAmount === "object" ? info.tokenAmount : {};
    const decimals = normalizeInteger(tokenAmount.decimals, null);
    const rawAmount = safeString(tokenAmount.amount || info.amount);
    legs.push({
      source_wallet: ownerByTokenAccount.get(sourceAccount) || safeString(info.authority) || sourceAccount,
      destination_wallet: ownerByTokenAccount.get(destinationAccount) || destinationAccount,
      source_token_account: sourceAccount,
      destination_token_account: destinationAccount,
      token_mint: safeString(info.mint),
      amount: decimals === null ? safeString(tokenAmount.uiAmountString || info.amount) : displayAmountFromRaw(rawAmount, decimals),
      raw_amount: rawAmount,
      decimals,
      token_symbol: "TOKEN",
      transfer_kind: "token",
      event_type: inferEventType(transaction, "token_transfer"),
      parser_source: "jsonParsed_instruction",
      parser_confidence: 0.66,
      parser_confidence_reason: "jsonParsed token transfer instruction; token-account owner mapping may be partial",
      outer_instruction_index: outerIndex,
      inner_instruction_index: innerIndex,
    });
  }
}

function addTokenBalanceDeltaLegs(legs, transaction) {
  const deltas = buildTokenBalanceDeltas(transaction);
  const outgoingByMint = new Map();
  const incomingByMint = new Map();
  deltas.forEach((delta) => {
    const key = delta.mint || "";
    if (!key || delta.rawDelta === 0n) return;
    const target = delta.rawDelta < 0n ? outgoingByMint : incomingByMint;
    if (!target.has(key)) target.set(key, []);
    target.get(key).push({ ...delta, remaining: delta.rawDelta < 0n ? -delta.rawDelta : delta.rawDelta });
  });

  outgoingByMint.forEach((outgoing, mint) => {
    const incoming = incomingByMint.get(mint) || [];
    outgoing.forEach((source) => {
      incoming.forEach((destination) => {
        if (source.remaining <= 0n || destination.remaining <= 0n) return;
        const amountRaw = source.remaining < destination.remaining ? source.remaining : destination.remaining;
        source.remaining -= amountRaw;
        destination.remaining -= amountRaw;
        legs.push({
          source_wallet: source.owner || source.account,
          destination_wallet: destination.owner || destination.account,
          source_token_account: source.account,
          destination_token_account: destination.account,
          token_mint: mint,
          amount: displayAmountFromRaw(amountRaw.toString(), source.decimals),
          raw_amount: amountRaw.toString(),
          decimals: source.decimals,
          token_symbol: "TOKEN",
          transfer_kind: "token_balance_delta",
          event_type: inferEventType(transaction, "token_transfer"),
          parser_source: "token_balance_delta",
          parser_confidence: 0.48,
          parser_confidence_reason: "paired token balance delta; route is parser-limited and must be reviewed",
          outer_instruction_index: null,
          inner_instruction_index: null,
        });
      });
    });
  });
}

function normalizeLeg(transaction, leg, context = {}) {
  const signature = safeString(transaction.signature);
  const timestamp = safeString(transaction.timestamp) || timestampFromBlockTime(transaction.blockTime);
  const sourceWallet = safeString(leg.source_wallet);
  const destinationWallet = safeString(leg.destination_wallet);
  const tokenMint = safeString(leg.token_mint);
  const amount = safeString(leg.amount);
  const limitations = [
    "provider_payload_sanitized",
    "wallet_identity_not_claimed",
    "complete_history_not_claimed",
  ];
  if (!sourceWallet) limitations.push("source wallet unavailable");
  if (!destinationWallet) limitations.push("destination wallet unavailable");
  if (!tokenMint) limitations.push("token mint unavailable");
  if (!amount) limitations.push("amount unavailable");
  if (leg.parser_source === "token_balance_delta") limitations.push("balance-delta pairing is parser-limited");
  if (leg.event_type === "swap_like_flow") limitations.push("swap-like label is not a liquidity truth claim");

  const missingCount = [sourceWallet, destinationWallet, tokenMint, amount].filter((value) => !value).length;
  const confidence = clampConfidence(Number(leg.parser_confidence) - missingCount * 0.1);

  return {
    signature,
    signature_group_id: signature || null,
    signature_group_index: 1,
    signature_group_size: context.transferLegCount || 1,
    transfer_leg_index: context.legIndex + 1,
    transfer_leg_count: context.transferLegCount || 1,
    slot: normalizeInteger(transaction.slot, null),
    timestamp,
    source_wallet: sourceWallet,
    destination_wallet: destinationWallet,
    token_mint: tokenMint,
    token_symbol: safeString(leg.token_symbol) || (tokenMint === NATIVE_SOL_MINT ? "SOL" : "TOKEN"),
    decimals: normalizeInteger(leg.decimals, null),
    amount,
    raw_amount: safeString(leg.raw_amount),
    transfer_direction: inferTransferDirection(context.wallet, sourceWallet, destinationWallet),
    outer_instruction_index: normalizeInteger(leg.outer_instruction_index, null),
    inner_instruction_index: normalizeInteger(leg.inner_instruction_index, null),
    program_id: safeString(leg.program_id),
    event_type: safeString(leg.event_type) || "token_transfer",
    multi_leg_signature: (context.transferLegCount || 0) > 1,
    swap_leg_group: leg.event_type === "swap_like_flow" ? signature || null : null,
    balance_delta_summary: leg.parser_source === "token_balance_delta"
      ? {
          paired: true,
          provider_payload_sanitized: true,
        }
      : {},
    parser_confidence: confidence,
    parser_confidence_reason: safeString(leg.parser_confidence_reason) || "sanitized provider transfer leg; review parser limitations",
    parser_limitations: uniqueStrings(limitations).slice(0, MAX_LIMITATIONS),
    raw_reference: {
      provider: "helius",
      adapter_family: "helius_getTransactionsForAddress",
      provider_record_index: context.transactionIndex,
      provider_transfer_kind: safeString(leg.transfer_kind),
      parser_source: safeString(leg.parser_source),
      provider_page_number: context.pageNumber,
      page_number: context.pageNumber,
      cursor_present: Boolean(context.cursorPresent),
      next_cursor_present: Boolean(context.nextCursorPresent),
      raw_payload_stored: false,
      raw_payload_returned: false,
      request_url_stored: false,
      request_headers_stored: false,
      provider_key_stored: false,
      provider_key_returned: false,
    },
  };
}

function inferEventType(transaction, fallback) {
  const rawType = safeString(transaction.type).toLowerCase();
  if (rawType.includes("swap")) return "swap_like_flow";
  if (fallback === "native_transfer") return "native_transfer";
  if (fallback === "token_transfer") return "token_transfer";
  return "direct_transfer";
}

function inferTransferDirection(wallet, source, destination) {
  const tracked = normalizeAddress(wallet);
  if (!tracked) return "unknown";
  if (normalizeAddress(source) === tracked && normalizeAddress(destination) === tracked) return "internal_mixed";
  if (normalizeAddress(source) === tracked) return "outbound";
  if (normalizeAddress(destination) === tracked) return "inbound";
  return "counterparty";
}

function buildTokenAccountOwnerMap(transaction) {
  const owners = new Map();
  asObjectList(transaction.preTokenBalances).concat(asObjectList(transaction.postTokenBalances)).forEach((balance) => {
    const account = safeString(balance.account);
    const owner = safeString(balance.owner);
    if (account && owner) owners.set(account, owner);
  });
  return owners;
}

function buildTokenBalanceDeltas(transaction) {
  const balances = new Map();
  asObjectList(transaction.preTokenBalances).forEach((balance) => mergeTokenBalance(balances, balance, "pre"));
  asObjectList(transaction.postTokenBalances).forEach((balance) => mergeTokenBalance(balances, balance, "post"));
  const deltas = [];
  balances.forEach((balance) => {
    const rawDelta = balance.postRaw - balance.preRaw;
    deltas.push({
      account: balance.account,
      owner: balance.owner,
      mint: balance.mint,
      decimals: balance.decimals,
      rawDelta,
    });
  });
  return deltas;
}

function mergeTokenBalance(balances, balance, side) {
  const account = safeString(balance.account);
  const mint = safeString(balance.mint);
  const key = `${account}:${mint}`;
  if (!account || !mint) return;
  const current = balances.get(key) || {
    account,
    owner: safeString(balance.owner),
    mint,
    decimals: normalizeInteger(balance.uiTokenAmount?.decimals, 0),
    preRaw: 0n,
    postRaw: 0n,
  };
  const raw = safeBigInt(balance.uiTokenAmount?.amount);
  if (side === "pre") current.preRaw = raw;
  if (side === "post") current.postRaw = raw;
  if (!current.owner) current.owner = safeString(balance.owner);
  balances.set(key, current);
}

function displayAmountFromRaw(rawValue, decimalsValue) {
  const rawText = safeString(rawValue);
  if (!rawText) return "";
  const decimals = normalizeInteger(decimalsValue, 0);
  const negative = rawText.startsWith("-");
  const digits = rawText.replace(/^-/, "").replace(/^0+(?=\d)/, "") || "0";
  if (!decimals) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function dedupeLegs(legs) {
  const seen = new Set();
  const output = [];
  legs.forEach((leg) => {
    const key = [
      normalizeAddress(leg.source_wallet),
      normalizeAddress(leg.destination_wallet),
      normalizeAddress(leg.token_mint),
      safeString(leg.amount),
      safeString(leg.raw_amount),
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    output.push(leg);
  });
  return output;
}

function timestampFromBlockTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return new Date(number * 1000).toISOString();
}

function safeBigInt(value) {
  const text = safeString(value).replace(/[^\d-]/g, "");
  if (!text || text === "-") return 0n;
  try {
    return BigInt(text);
  } catch (error) {
    return 0n;
  }
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0.1, Math.min(0.95, Math.round(number * 100) / 100));
}

function safeId(value) {
  return safeString(value, 120).replace(/[^A-Za-z0-9._:-]/g, "_") || "event";
}

function normalizeAddress(value) {
  return safeString(value).toLowerCase();
}

function normalizeInteger(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(number);
}

function asObjectList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
}

function safeString(value, limit = 256) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.slice(0, limit);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => safeString(value)).filter(Boolean))];
}

module.exports = {
  NATIVE_SOL_MINT,
  normalizeProviderTransactions,
  normalizeProviderTransactionsToEvents,
  normalizedRowToEvent,
};
