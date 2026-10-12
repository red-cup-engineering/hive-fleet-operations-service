---
name: curating-hive-posts
description: "Run the fleet's Hive curation cycle: votes scheduled inside each curation account's mana budget and cast through the fleet signer."
closure-kind: process
requires-capabilities:
  - hive-curation-cycle
---

# Curating Hive posts

Run `hive-curation-cycle` on the clock's schedule. It reads the fleet config's curation block (accounts are data), schedules votes inside each account's mana budget and casts them through the fleet signer, which judges each vote against the house's rules.
