#!/bin/bash

if [[ -z "${SKIP_COMPILE_PROTO}" ]]; then
  git submodule init
fi
