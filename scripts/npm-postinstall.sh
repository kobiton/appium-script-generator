#!/bin/bash

if [[ -z "${SKIP_COMPILE_PROTO}" ]]; then
  git submodule update
  bash ./scripts/compile-protoc.sh
else
  echo "Skip compiling proto files..."
fi
