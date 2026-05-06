---
id: tl-heavy
tab: tools
title: Heavy Load & Debug Mode
icon: Layers
---

## Heavy Load

Increases DynamoDB Stream batch size and window for high-throughput scenarios. Configurable from Settings, applies retroactively. A pulsating orange banner on History shows active batch insertions.

## Debug Mode

Runs Lambda with `-verbose:class -Xlog:exceptions=info` JVM flags for detailed class-loading and exception traces. Flags are automatically cleaned up after invoke.
