.PHONY: build check

build:
	lake build

check: build
	lake env lean scripts/Audit.lean
