---
id: typescript
version: 1.0.0
tier: framework
paths: ["**/*.ts", "**/*.tsx", "src/**"]
detect: ["tsconfig.json"]
priority: 70
tags: ["typescript", "javascript"]
---

# TypeScript Standards

- Enable strict mode. Never set `strict: false` in tsconfig.
- Avoid `any` — use `unknown` for truly unknown types, then narrow with type guards.
- Prefer interfaces over type aliases for object shapes (interfaces are extensible, produce better errors).
- Use explicit return types on exported functions. Inferred types are fine for internal/private functions.
- Never use `@ts-ignore` without a comment explaining why and a tracking issue.
- Use discriminated unions over optional fields for variant types.
- Prefer `readonly` for properties that shouldn't change after construction.
- Handle all promise rejections — no unhandled promises. Use try/catch or `.catch()`.
- Prefer named exports over default exports (better refactoring, better tree-shaking).
