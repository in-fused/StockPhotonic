"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_FIXTURE_PATH = path.join(
  "data",
  "crypto",
  "test-fixtures",
  "wallet-activity-response-d97.json"
);

const NOISE_ADDRESS_PREFIXES = [
  "computebudget111111111111111111111111111111",
  "tokenkegqfezyinwajbnbgkpfxcwubvf9ss623vq5da",
  "tokenzqdbnjbkpecb7cb21qvwxqvfkkcwfbzrg",
  "sysvar",
  "11111111111111111111111111111111",
  "addresslookuptab1e1111111111111111111111111",
  "bpfloader",
  "bpfloaderupgradeab1e11111111111111111111111",
  "vot111111111111111111111111111111111111111",
  "vote111111111111111111111111111111111111111",
  "stake11111111111111111111111111111111111111",
  "atokengpvbdgvxr1bv2hvzbswhbnequgkycwvdsxf",
  "memosq4gqxgabhysygxbdlqnysncmyzry2k69ydt4c",
  "metaqbxxuerdq28cj1rbawkyqm3ybzjb6a8bt518x1s",
];

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readFixture(fixturePath) {
  const absolutePath = path.resolve(process.cwd(), fixturePath);
  const allowedRoot = path.resolve(
    process.cwd(),
    "data",
    "crypto",
    "test-fixtures"
  );

  if (!absolutePath.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(
      `Fixture path must stay under data/crypto/test-fixtures: ${fixturePath}`
    );
  }

  return {
    absolutePath,
    fixture: JSON.parse(fs.readFileSync(absolutePath, "utf8")),
  };
}

function getDirection(source, target, trackedWallet) {
  const sourceAddress = normalizeAddress(source);
  const targetAddress = normalizeAddress(target);

  if (targetAddress === trackedWallet) return "inbound";
  if (sourceAddress === trackedWallet) return "outbound";
  return "mixed";
}

function isNoiseWalletAddress(address, trackedWallet) {
  const normalized = normalizeAddress(address);

  if (!normalized || normalized === trackedWallet) return false;
  return NOISE_ADDRESS_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function getCounterparty(leg, trackedWallet) {
  return normalizeAddress(leg.source_wallet) === trackedWallet
    ? leg.destination_wallet
    : leg.source_wallet;
}

function deriveRawLegs(fixture, trackedWallet) {
  return fixture.events.flatMap((event, eventIndex) => {
    const tokens = Array.isArray(event.tokens) ? event.tokens : [];
    const firstToken = tokens[0] || {};
    const transfers = Array.isArray(event.transfers) ? event.transfers : [];

    return transfers.map((transfer, transferIndex) => {
      const source =
        transfer.from || transfer.source_wallet || transfer.source || "";
      const target =
        transfer.to ||
        transfer.destination_wallet ||
        transfer.destination ||
        transfer.target ||
        "";

      return {
        id: `${event.id || eventIndex}:${transferIndex}`,
        source_wallet: source,
        destination_wallet: target,
        symbol: String(
          transfer.token_symbol || transfer.symbol || firstToken.symbol || ""
        ).trim(),
        amount: Number(transfer.amount) || 0,
        usd_value: Number(transfer.usd_value ?? event.usd_value) || 0,
        timestamp: event.timestamp || event.received_at || "",
        direction: getDirection(source, target, trackedWallet),
      };
    });
  });
}

function deriveVisibleLegs(rawLegs, trackedWallet) {
  return rawLegs.filter((leg) => {
    const source = normalizeAddress(leg.source_wallet);
    const target = normalizeAddress(leg.destination_wallet);

    if (!source || !target) return false;
    if (isNoiseWalletAddress(source, trackedWallet)) return false;
    if (isNoiseWalletAddress(target, trackedWallet)) return false;
    return source === trackedWallet || target === trackedWallet;
  });
}

function deriveTokenFlowSummary(visibleLegs) {
  const summary = visibleLegs.reduce((items, leg) => {
    const symbol = leg.symbol || "Token";
    const item = items.get(symbol) || {
      symbol,
      inbound: 0,
      outbound: 0,
      mixed: 0,
      count: 0,
      total_usd: 0,
    };

    if (leg.direction === "inbound") item.inbound += 1;
    else if (leg.direction === "outbound") item.outbound += 1;
    else item.mixed += 1;

    item.count += 1;
    item.total_usd += Math.max(0, leg.usd_value);
    items.set(symbol, item);

    return items;
  }, new Map());

  return [...summary.values()].sort(
    (a, b) =>
      b.total_usd - a.total_usd ||
      b.count - a.count ||
      a.symbol.localeCompare(b.symbol)
  );
}

function deriveTopToken(tokenSummary, direction) {
  const ranked = tokenSummary
    .filter((item) => item[direction] > 0)
    .sort(
      (a, b) =>
        b[direction] - a[direction] ||
        b.total_usd - a.total_usd ||
        a.symbol.localeCompare(b.symbol)
    );

  return ranked[0]?.symbol || "";
}

function deriveRepeatedCounterparty(visibleLegs, trackedWallet) {
  const counterparties = visibleLegs.reduce((items, leg) => {
    const counterparty = getCounterparty(leg, trackedWallet);
    const key = normalizeAddress(counterparty);
    const item = items.get(key) || {
      address: counterparty,
      inbound: 0,
      outbound: 0,
      mixed: 0,
      count: 0,
      total_usd: 0,
    };

    if (leg.direction === "inbound") item.inbound += 1;
    else if (leg.direction === "outbound") item.outbound += 1;
    else item.mixed += 1;

    item.count += 1;
    item.total_usd += Math.max(0, leg.usd_value);
    items.set(key, item);

    return items;
  }, new Map());

  return (
    [...counterparties.values()].sort(
      (a, b) => b.count - a.count || b.total_usd - a.total_usd
    )[0] || null
  );
}

function assertEqual(errors, label, actual, expected) {
  if (actual !== expected) {
    errors.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertAddressEqual(errors, label, actual, expected) {
  if (normalizeAddress(actual) !== normalizeAddress(expected)) {
    errors.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function validateShape(fixture, errors) {
  if (!isPlainObject(fixture.metadata)) {
    errors.push("metadata must exist and be an object");
  }

  if (!Array.isArray(fixture.events)) {
    errors.push("events array must exist");
  }

  if (!isPlainObject(fixture.expected_wallet_intelligence)) {
    errors.push("expected_wallet_intelligence must exist and be an object");
  }
}

function validateSyntheticIsolation(fixture, errors) {
  const metadata = fixture.metadata || {};

  assertEqual(errors, "metadata.sanitized", metadata.sanitized, true);
  assertEqual(errors, "metadata.fake", metadata.fake, true);
  assertEqual(errors, "metadata.production_meaning", metadata.production_meaning, false);
  assertEqual(
    errors,
    "metadata.live_blockchain_fetching",
    metadata.live_blockchain_fetching,
    false
  );
}

function validateExpectedIntelligence(fixture, errors) {
  const expected = fixture.expected_wallet_intelligence;
  const trackedWallet = normalizeAddress(
    fixture.metadata?.wallet || expected.tracked_wallet
  );
  const rawLegs = deriveRawLegs(fixture, trackedWallet);
  const visibleLegs = deriveVisibleLegs(rawLegs, trackedWallet);
  const filteredLegs = rawLegs.length - visibleLegs.length;
  const tokenSummary = deriveTokenFlowSummary(visibleLegs);
  const largestFlow =
    visibleLegs.slice().sort((a, b) => b.usd_value - a.usd_value)[0] || null;
  const repeatedCounterparty = deriveRepeatedCounterparty(
    visibleLegs,
    trackedWallet
  );

  if (!trackedWallet) {
    errors.push("expected tracked wallet must be present");
  }

  assertEqual(errors, "raw legs count", rawLegs.length, expected.raw_legs);
  assertEqual(
    errors,
    "visible legs count",
    visibleLegs.length,
    expected.visible_legs
  );
  assertEqual(errors, "filtered legs count", filteredLegs, expected.filtered_legs);
  assertEqual(
    errors,
    "top inbound token",
    deriveTopToken(tokenSummary, "inbound"),
    expected.top_inbound_token
  );
  assertEqual(
    errors,
    "top outbound token",
    deriveTopToken(tokenSummary, "outbound"),
    expected.top_outbound_token
  );

  assertEqual(
    errors,
    "largest flow symbol",
    largestFlow?.symbol,
    expected.largest_flow?.symbol
  );
  assertEqual(
    errors,
    "largest flow value",
    largestFlow?.usd_value,
    expected.largest_flow?.usd_value
  );
  assertEqual(
    errors,
    "largest flow direction",
    largestFlow?.direction,
    expected.largest_flow?.direction
  );
  assertAddressEqual(
    errors,
    "largest flow counterparty",
    getCounterparty(largestFlow || {}, trackedWallet),
    expected.largest_flow?.counterparty
  );

  assertAddressEqual(
    errors,
    "repeated counterparty address",
    repeatedCounterparty?.address,
    expected.repeated_counterparty?.address
  );
  assertEqual(
    errors,
    "repeated counterparty count",
    repeatedCounterparty?.count,
    expected.repeated_counterparty?.count
  );
  assertEqual(
    errors,
    "repeated counterparty inbound count",
    repeatedCounterparty?.inbound,
    expected.repeated_counterparty?.directions?.inbound
  );
  assertEqual(
    errors,
    "repeated counterparty outbound count",
    repeatedCounterparty?.outbound,
    expected.repeated_counterparty?.directions?.outbound
  );

  assertEqual(
    errors,
    "token flow summary count",
    tokenSummary.length,
    expected.token_flow_summary.length
  );

  for (const expectedToken of expected.token_flow_summary || []) {
    const actual = tokenSummary.find((item) => item.symbol === expectedToken.symbol);

    if (!actual) {
      errors.push(`token flow summary missing ${expectedToken.symbol}`);
      continue;
    }

    for (const key of ["inbound", "outbound", "mixed", "count", "total_usd"]) {
      assertEqual(
        errors,
        `${expectedToken.symbol} token flow ${key}`,
        actual[key],
        expectedToken[key]
      );
    }
  }

  for (const noiseCase of expected.noise_cases || []) {
    const rawHasNoise = rawLegs.some(
      (leg) =>
        normalizeAddress(leg.source_wallet) === normalizeAddress(noiseCase.address) ||
        normalizeAddress(leg.destination_wallet) === normalizeAddress(noiseCase.address)
    );
    const visibleHasNoise = visibleLegs.some(
      (leg) =>
        normalizeAddress(leg.source_wallet) === normalizeAddress(noiseCase.address) ||
        normalizeAddress(leg.destination_wallet) === normalizeAddress(noiseCase.address)
    );

    if (!rawHasNoise) errors.push(`raw legs missing noise case ${noiseCase.address}`);
    if (visibleHasNoise) {
      errors.push(`visible legs retained noise case ${noiseCase.address}`);
    }
  }

  return {
    rawLegs,
    visibleLegs,
    filteredLegs,
    tokenSummary,
  };
}

function main() {
  const fixturePath = process.argv[2] || DEFAULT_FIXTURE_PATH;
  const errors = [];
  const { absolutePath, fixture } = readFixture(fixturePath);

  validateShape(fixture, errors);

  if (errors.length === 0) {
    validateSyntheticIsolation(fixture, errors);
    var derived = validateExpectedIntelligence(fixture, errors);
  }

  if (errors.length > 0) {
    console.error(`Wallet intelligence fixture validation failed: ${fixturePath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(
    [
      "Wallet intelligence fixture validation passed",
      `fixture=${path.relative(process.cwd(), absolutePath)}`,
      `raw_legs=${derived.rawLegs.length}`,
      `visible_legs=${derived.visibleLegs.length}`,
      `filtered_legs=${derived.filteredLegs}`,
      `token_summaries=${derived.tokenSummary.length}`,
    ].join(" ")
  );
}

main();
