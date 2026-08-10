# ADR 0004: Stitch screens are a contract, not runtime code

## Decision

The Stitch export is retained as a design reference. SchemaOps production UI
uses the same information architecture, tokens and state language through
Next.js components and API-backed data. Generated HTML, Tailwind CDN imports,
Google-hosted fonts/icons and mock timestamps are not copied into production.

## Consequences

- Design review can compare screens by stable contracts rather than generated
  implementation details.
- Empty/loading/error states are first-class and do not pretend that a target
  has executed migrations.
- Security and approval rules are enforced by Fastify/domain code, not by the
  visual warning shown for production targets.
