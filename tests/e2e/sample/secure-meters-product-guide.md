# Secure Meters - e2e regression knowledge fixture
#
# This document is the regression fixture used to seed the e2e knowledge
# bank (see tests/e2e/run_e2e.py). It deliberately describes the same
# products that appear in the sample sales call
# (samples/audio_files_samples/sales-call-secure.mp3) so the real
# trie/entity pipeline can detect ProductMentioned events for them.

## Secure Meters product portfolio

### Prodigy
Three-phase CT-operated smart meter with built-in current transformers.
Thread-through connections - no external CTs or accessories. Accuracy
classes 0.2S and 0.5S. Designed for distribution transformer level and
bulk consumer points.

### Apex 100
High-end precision meter for transmission and bulk power transfer points.
Full four-quadrant import/export metering with total harmonic distortion
measurement. Class 0.2S by default, ICS DLMS open protocol.

### Sprint 210
Three-phase modular meter for mixed residential and small commercial
feeders. Pluggable GPRS and mesh radio modules, fully DLMS COSEM
compliant. Modules are slide-out/slide-in replaceable in the field with
no recalibration needed.

### i-Credit 510
Single-phase smart meter sharing the modular communication design.
Supports remote firmware upgrades and load control relays.

### Liberty+
Single-phase token-less prepaid smart meter with encrypted vend codes
and multi-rate tariffs with friendly credit periods.

### ECD 210 / ECD 310
Communication modems handling GSM/GPRS data transfer from meters to the
central station. Auto-trigger SMS alerts on tamper events.

## Competition

Landis+Gyr (including the E650 three-phase CT-operated units) is the
incumbent vendor the customer is standardizing on. Elster meters are
considered for the commercial segment.
