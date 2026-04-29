#!/usr/bin/env python3
"""
StockPhotonic Dataset Validator
Checks companies.json and connections.json for integrity.
Run: python scripts/validate_dataset.py
"""

import json
import sys
from collections import defaultdict

def validate():
    with open("data/companies.json") as f:
        companies = json.load(f)
    with open("data/connections.json") as f:
        connections = json.load(f)
    
    errors = []
    warnings = []
    
    # Build lookup
    company_ids = {c["id"] for c in companies}
    ticker_map = {c["ticker"]: c["id"] for c in companies}
    
    # Check companies
    if len(companies) < 50:
        warnings.append(f"Only {len(companies)} companies - target 80+ for v1.0")
    
    # Check connections
    for i, conn in enumerate(connections):
        if conn["source"] not in company_ids:
            errors.append(f"Connection {i}: source id {conn['source']} not in companies")
        if conn["target"] not in company_ids:
            errors.append(f"Connection {i}: target id {conn['target']} not in companies")
        if not (0 <= conn["strength"] <= 1):
            errors.append(f"Connection {i}: strength {conn['strength']} out of range")
        if conn["confidence"] < 1 or conn["confidence"] > 5:
            errors.append(f"Connection {i}: confidence {conn['confidence']} invalid")
    
    # Check for orphans
    connected_ids = set()
    for conn in connections:
        connected_ids.add(conn["source"])
        connected_ids.add(conn["target"])
    orphans = company_ids - connected_ids
    if orphans:
        warnings.append(f"{len(orphans)} orphan companies (no connections): {[c['ticker'] for c in companies if c['id'] in orphans][:5]}...")
    
    # Stats
    conn_types = defaultdict(int)
    for c in connections:
        conn_types[c["type"]] += 1
    
    print("=== Validation Report ===")
    print(f"Companies: {len(companies)}")
    print(f"Connections: {len(connections)}")
    print(f"Connection types: {dict(conn_types)}")
    print(f"Orphans: {len(orphans)}")
    
    if errors:
        print("\nERRORS:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\n✓ No critical errors found.")
    
    if warnings:
        print("\nWarnings:")
        for w in warnings:
            print(f"  - {w}")
    
    print("\n✓ Dataset ready for photonic visualizer.")

if __name__ == "__main__":
    validate()