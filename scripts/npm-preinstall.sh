#!/bin/bash

echo "nhc test"

echo "SKIP_COMPILE_PROTO = ${SKIP_COMPILE_PROTO}"

if [[ -z "${SKIP_COMPILE_PROTO}" ]]; then
  git submodule init
fi
