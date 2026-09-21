# Third-party notices

[简体中文](THIRD_PARTY_NOTICES.zh-CN.md) · English

The repository's direct JavaScript dependencies are installed from npm and
their exact versions are recorded in `ui/package-lock.json`.

| Dependency | Use | License information |
| --- | --- | --- |
| `@fontsource-variable/ibm-plex-sans` | Bundled UI font | OFL-1.1; see the package license and font metadata |
| `playwright` | Local browser and layout tests | Apache-2.0; see the package license and notice files |

Transitive dependencies retain their own licenses. Run `npm --prefix ui ci`
from a clean checkout to reproduce the locked dependency tree, and consult
the installed package notices before redistributing bundled artifacts.
