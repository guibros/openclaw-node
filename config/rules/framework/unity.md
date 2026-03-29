---
id: unity
version: 1.0.0
tier: framework
paths: ["Assets/**", "**/*.cs", "Packages/**"]
detect: ["ProjectSettings/ProjectVersion.txt"]
priority: 70
tags: ["unity", "gamedev", "csharp"]
---

# Unity Standards

- Use delta time (`Time.deltaTime`) for all time-dependent calculations. Never assume fixed frame rate.
- Zero allocations in `Update()`, `FixedUpdate()`, and `LateUpdate()`. Cache references in `Awake()`/`Start()`.
- Use object pooling for frequently spawned/destroyed objects (projectiles, particles, UI elements).
- Never use `Find()`, `FindObjectOfType()`, or tag-based lookups in hot paths. Cache in `Awake()`.
- All gameplay values must come from ScriptableObjects or external config — never hardcoded in scripts.
- Use events/delegates for inter-system communication. No direct coupling between unrelated systems.
- Profile before and after optimization. Use Unity Profiler, not guesswork.
- Mobile: respect thermal state, target 30fps stable over 60fps with drops, batch draw calls.
- AR: all geospatial API calls must be async. Never block the main thread on location/anchor resolution.
