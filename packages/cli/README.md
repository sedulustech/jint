# @jint/cli

jint doesn't need a JS runtime in your env to run: the binary ships the bun runtime inside it.
No node/bun is needed.

All code grammars are WASM and bundled.

The only runtime requirement is a C library (glibc on Linux). On Alpine (musl) Linux, use the musl build and install libstdc++ (`apk add libstdc++`).
