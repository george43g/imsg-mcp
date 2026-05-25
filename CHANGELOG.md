# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and follows [Semantic Versioning](https://semver.org/).

# 1.0.0 (2026-05-25)


### Bug Fixes

* bin consolidation to 'imsg', memory leak in TUI render loop, and headless e2e tests ([7d6f6d6](https://github.com/george43g/imsg-mcp/commit/7d6f6d61dc54563dc79fa4b78f16667146fcd0e4))
* **parser+limits:** preamble 0x95 variant, raised MCP limits, dev-proxy stdin buffer ([fa55671](https://github.com/george43g/imsg-mcp/commit/fa55671de9d45c71a333344de0587c28fa4d761e))
* **parser:** strip doubled-letter prefix artifacts from native path ([965493d](https://github.com/george43g/imsg-mcp/commit/965493dd92e90eb0fe9d28717d2fd63272c7e054))
* **screenshots:** regenerate with installed JetBrains Mono + add fontconfig guard ([2137b7b](https://github.com/george43g/imsg-mcp/commit/2137b7bfd893af8a8375ececa58e3c611bc11791))
* **test:** VCF contact compare uses env fixture paths on CI ([fc8ecfc](https://github.com/george43g/imsg-mcp/commit/fc8ecfcd1fc78fd6a53cb2a557c6673c382327fe))
* **tui:** always show reply indicator, brighten dim text, breathing room around date separators ([8a9ae6f](https://github.com/george43g/imsg-mcp/commit/8a9ae6fa83c37de75cea6b2f5e86b15b0b780976)), closes [#64646A](https://github.com/george43g/imsg-mcp/issues/64646A) [#9090A0](https://github.com/george43g/imsg-mcp/issues/9090A0) [#3C3C41](https://github.com/george43g/imsg-mcp/issues/3C3C41) [#646470](https://github.com/george43g/imsg-mcp/issues/646470) [#64646A](https://github.com/george43g/imsg-mcp/issues/64646A) [#505055](https://github.com/george43g/imsg-mcp/issues/505055) [#7878A0](https://github.com/george43g/imsg-mcp/issues/7878A0)
* **tui:** call withFullScreen.start() before waitUntilExit ([2598aa1](https://github.com/george43g/imsg-mcp/commit/2598aa1f84cf49c61cb8a91fed075022eb452801))
* **tui:** conversation row layout, sidebar auto-scroll, slower wheel ([eb428b8](https://github.com/george43g/imsg-mcp/commit/eb428b82c9298526eeacc968972875c1af0292bb))
* **tui:** debounce conversation switching to prevent freeze ([69fb9d2](https://github.com/george43g/imsg-mcp/commit/69fb9d219f5f7c79a9e436801c22b12a06182f21))
* **tui:** mouse-mode 1003 floods stdin and pins the event loop ([4ebbed1](https://github.com/george43g/imsg-mcp/commit/4ebbed1778ca5e75346700b90574f9f87f61d158))
* update CLI dynamic imports for new tui/ directory ([7876402](https://github.com/george43g/imsg-mcp/commit/7876402fef8ced9c377717454eb25e33dfc2012d))


### Features

* add CLI, TUI, and publish-ready packaging ([5d41aa7](https://github.com/george43g/imsg-mcp/commit/5d41aa71969c2bfa0fa4ca3c0150f14505aa8f12))
* **analytics:** chat_analytics tool with 6 priority types + SQLite cache ([087cc14](https://github.com/george43g/imsg-mcp/commit/087cc14f14e9dc21e23da08a3ffac4ad59c8e4fe))
* **attachments:** search_attachments + get_attachment with HEIC→PNG conversion ([0e3b3f5](https://github.com/george43g/imsg-mcp/commit/0e3b3f531b6ce821bec83f463ab270351675dac8))
* bounded message window, MCP pagination cursor, streaming export_messages ([654df66](https://github.com/george43g/imsg-mcp/commit/654df6616845f7975c9b5f1e18800273c810cd36))
* **cli:** imsg export subcommand + README restructure + screenshot automation ([0ce0647](https://github.com/george43g/imsg-mcp/commit/0ce0647002d57a03f87488cb56deef1dc817515c))
* **contacts:** contact:N disambiguation selector (carterlasalle parity) ([b74a453](https://github.com/george43g/imsg-mcp/commit/b74a453d0ff6f6fb5d12692aa95416a31cbfc715))
* gate dev-only MCP tools behind IMSG_DEV env flag ([53d758b](https://github.com/george43g/imsg-mcp/commit/53d758bec41ce03f4a7513a2c95ef1602c61cb5b))
* heap monitor, MCP output quality, and text artifact fix ([2ae842f](https://github.com/george43g/imsg-mcp/commit/2ae842fe15c5488424a0bc6a74d5215f514f1950))
* MCP I/O hardening (output schemas, pagination cursors, text sanitization) ([c5a97d0](https://github.com/george43g/imsg-mcp/commit/c5a97d08b059a46472786a9fa89fa2578d282bcd))
* **native:** add Rust acceleration module via napi-rs ([4cb8df9](https://github.com/george43g/imsg-mcp/commit/4cb8df9e1ac21409426044d500b259842ae2c9da))
* **packaging:** MCPB Desktop Extension manifest + pack:mcpb script (carterlasalle parity) ([91fed16](https://github.com/george43g/imsg-mcp/commit/91fed16fb3f4302f8f9f5b37d804fceb72563bad))
* **parser:** hook native Rust parseAttributedBody as fast path ([c9ef08b](https://github.com/george43g/imsg-mcp/commit/c9ef08b90e6392ad56668b489086e6ce332bb0a6))
* Phase 1 pre-publish hardening — send reliability, prompt-injection guardrails, _meta footer ([641feeb](https://github.com/george43g/imsg-mcp/commit/641feeba52fa12558e44bf506b243a585994a2fa))
* prepare v1.0.0 — refactor, AbortSignal cancellation, semantic-release pipeline ([34f8864](https://github.com/george43g/imsg-mcp/commit/34f8864e3f0709cf1c3a1895d7f2635a037f14de))
* process lifecycle reliability + parser hang fix ([c81b5c1](https://github.com/george43g/imsg-mcp/commit/c81b5c19623448b3badab4cc14d53880abef88d8))
* **resources:** MCP Resources for recent messages + contacts (marissamarym parity) ([a4d7e59](https://github.com/george43g/imsg-mcp/commit/a4d7e59833626945d0baf2fb3f69933e9e73e12e))
* **robustness:** self-healing watchdog, per-tool timeouts, unlimited limits, health_check ([0c4e104](https://github.com/george43g/imsg-mcp/commit/0c4e1047cb37bb8b24d84ae80b43f9a64f4be485))
* **search:** fuzzy mode + WRatio-style scorer with token-set + Levenshtein blend ([aa154d4](https://github.com/george43g/imsg-mcp/commit/aa154d4d933a8e617eb0a68dc90fda041be1d635))
* **send:** attachments[] in send_message (1-on-1 only, group not supported) ([faee412](https://github.com/george43g/imsg-mcp/commit/faee4120dbe2f41d885be838cf36d4e173f103cb))
* structured perf logger with file output and instrumented code paths ([2341317](https://github.com/george43g/imsg-mcp/commit/23413171e72972ed9d55486ff80727cc02b2493e))
* **test:** synthetic fixture generator + MCP stress harness ([8ea172a](https://github.com/george43g/imsg-mcp/commit/8ea172a413a940c1bda36c45c3a7ced5f8d72e36))
* theme system, TUI config file, imsg-cli setup, env vars audit ([61a011e](https://github.com/george43g/imsg-mcp/commit/61a011e2aeb0eda916aec3c7f17eddb9fc78aebe)), closes [#FF6B35](https://github.com/george43g/imsg-mcp/issues/FF6B35) [#FF4444](https://github.com/george43g/imsg-mcp/issues/FF4444) [#1982FC](https://github.com/george43g/imsg-mcp/issues/1982FC)
* ThreadPane bottom-anchor, contacts MCP tools, kill observability ([002275a](https://github.com/george43g/imsg-mcp/commit/002275a0dbaf2d01fb9522abd0153eadd1c180c9))
* TUI sweep — date picker, Quick Look preview, logger gate, watchdog sleep skew ([83f5127](https://github.com/george43g/imsg-mcp/commit/83f5127478f381c4d9044eb5b6f78c43ee04178a))
* **tui:** lazy-load conversations + older messages, smart cache ([344725b](https://github.com/george43g/imsg-mcp/commit/344725b4321b6f3660cf4025c32893893dd81703))
* **tui:** O / S keybinds for cross-app launch via URL schemes ([b396386](https://github.com/george43g/imsg-mcp/commit/b3963868b72e7c77e048317d46699bdf68df6099))
* **tui:** premium rewrite with true color, bubbles, and compose ([fb5e83a](https://github.com/george43g/imsg-mcp/commit/fb5e83a7251e1a1649ac1f4aa5287839df9aa5bd))
* **tui:** rewrite with Ink (React for CLI) + batch reactions fix ([aa9ecc8](https://github.com/george43g/imsg-mcp/commit/aa9ecc8ca90c801db76eeff067137175c3415ab3))
* **tui:** scannable layout, vim keybindings, dev stats, drawer ([53ee9a2](https://github.com/george43g/imsg-mcp/commit/53ee9a22d47d0f41e232d55925f05991a86709df))
* **tui:** show thread slug, members, and contact details ([6fefdc9](https://github.com/george43g/imsg-mcp/commit/6fefdc9423f6b6eb5d2a239f8ee777d6ebd61cdc))
* **tui:** visual selection + multi-format export, date-jump modal ([43d1ba4](https://github.com/george43g/imsg-mcp/commit/43d1ba4bdf90abe6c2546abd28eee46f30ef12db))
* use Commander for CLI argument parsing; add TUI resize handling ([1dae45f](https://github.com/george43g/imsg-mcp/commit/1dae45fb3789735f490ea27e8cf171b54e6205c1))


### Performance Improvements

* batch-fetch reactions per chat instead of per message ([1f9a028](https://github.com/george43g/imsg-mcp/commit/1f9a028133393dade6355db84de9ae6fbecea928))
* TTL cache, lazy slug sync, and batched message queries ([505f6e3](https://github.com/george43g/imsg-mcp/commit/505f6e3eabc56d1073ab5471527a50b49b219d81))
* two-pass listConversations with cached aggregate queries ([4c968d4](https://github.com/george43g/imsg-mcp/commit/4c968d49e6b34ee0669b902be2dafed2580d5e2f))

<!-- semantic-release populates entries above this line. -->
