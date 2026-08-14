# Folio Agent Tools

This dependency-free adapter exposes Folio's bounded finance capabilities to a terminal Agent runtime. It is intentionally protocol-neutral so a Step AOS Skill, MCP server, App Intent, or staging BFF can map its own transport onto the same handlers.

The adapter never accepts raw microphone audio and never lets an Agent confirm finance changes in the background. Model-derived input can only create evidence-covered `pending_review` proposals. Confirmation requires a visible foreground session, recent reauthentication, an explicit user flag, selected item IDs, an expected version, and an idempotency key.
