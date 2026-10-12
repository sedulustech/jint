# npm publish units

Five packages, because the registry delivers the same files to every machine and `os`/`cpu`
are per-package declarations. A directory here IS a registry package: name + version,
published as a tarball of its contents.

- `jint/` - the name users install. Carries the launcher shim (`bin/`) that finds whichever
  one platform package landed and execs its binary. Lists all four platform packages as
  `optionalDependencies`: optional means "install if the machine matches, skip silently if
  not" - as regular deps, every install would fail on the three non-matching platforms.
- `jint-<os>-<arch>/` x4 - one binary each, `os`/`cpu`-gated so a wrong-platform install is
  impossible, and each machine downloads only its own binary instead of all four.

Versions are placeholders (`0.0.0`); `scripts/pack-npm.ts` stamps the tag version and injects
the binaries at release time. How and when this publishes: RELEASING.md.
